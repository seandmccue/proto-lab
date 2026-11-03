import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { backup, DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const tar = promisify(execFile);
const archiveName = 'checkpoint.tar.gz';
const databaseName = 'protolab.sqlite';
const maxArchiveBytes = 90 * 1024 * 1024;

export class CloudCheckpoint {
  private pending = Promise.resolve();

  constructor(private url: string, private token: string, private dataDir: string) {}

  static fromEnv(dataDir: string) {
    const { PROTOLAB_CHECKPOINT_URL: url, PROTOLAB_CHECKPOINT_TOKEN: token } = process.env;
    if (!url && !token) return null;
    if (!url || !token) throw new Error('Both Cloudflare checkpoint settings are required.');
    return new CloudCheckpoint(url, token, dataDir);
  }

  async restore() {
    await mkdir(this.dataDir, { recursive: true });
    const temp = await mkdtemp(join(this.dataDir, '.restore-'));
    try {
      const response = await fetch(this.url, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(60_000),
      });
      const bytes = Number(response.headers.get('content-length'));
      if (!response.ok || !response.body || bytes < 1 || bytes > maxArchiveBytes) {
        throw new Error(`Cloudflare checkpoint unavailable (HTTP ${response.status}).`);
      }
      const archive = join(temp, archiveName);
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(archive));
      if ((await stat(archive)).size !== bytes) throw new Error('Cloudflare checkpoint download was incomplete.');
      await tar('tar', ['-xzf', archive, '-C', temp, databaseName, 'store']);
      const restored = new DatabaseSync(join(temp, databaseName), { readOnly: true });
      try {
        const result = restored.prepare('PRAGMA quick_check').get();
        if (result?.quick_check !== 'ok') throw new Error('Cloudflare checkpoint SQLite integrity check failed.');
        const manifests = restored.prepare('SELECT manifest_key FROM versions').all();
        for (const { manifest_key: key } of manifests) {
          if (typeof key !== 'string' || !/^versions\/[a-z0-9_-]+\.json$/i.test(key) || !existsSync(join(temp, 'store', key))) {
            throw new Error('Cloudflare checkpoint is missing a saved version manifest.');
          }
        }
      } finally {
        restored.close();
      }
      for (const name of ['store', databaseName, `${databaseName}-wal`, `${databaseName}-shm`]) {
        await rm(join(this.dataDir, name), { force: true, recursive: name === 'store' });
      }
      await rename(join(temp, 'store'), join(this.dataDir, 'store'));
      await rename(join(temp, databaseName), join(this.dataDir, databaseName));
      console.log('[storage] restored the private Cloudflare R2 checkpoint');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  save(db: DatabaseSync) {
    // One writer per production container. A failed upload leaves the previous R2 object intact.
    const task = this.pending.then(() => this.upload(db));
    this.pending = task.catch(() => {});
    return task;
  }

  private async upload(db: DatabaseSync) {
    const temp = await mkdtemp(join(tmpdir(), 'protolab-checkpoint-'));
    try {
      const archive = join(temp, archiveName);
      await backup(db, join(temp, databaseName));
      await tar('tar', ['-czf', archive, '-C', temp, databaseName, '-C', this.dataDir, 'store']);
      const { size } = await stat(archive);
      if (size > maxArchiveBytes) throw new Error('Checkpoint exceeds the Cloudflare upload budget.');
      const response = await fetch(this.url, {
        method: 'PUT',
        headers: { authorization: `Bearer ${this.token}`, 'content-length': String(size), 'content-type': 'application/gzip' },
        body: Readable.toWeb(createReadStream(archive)),
        duplex: 'half',
        signal: AbortSignal.timeout(60_000),
      } as RequestInit & { duplex: 'half' });
      if (!response.ok) throw new Error(`Cloudflare checkpoint upload failed (HTTP ${response.status}).`);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}

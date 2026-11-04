import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, cpSync, createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { createGzip } from 'node:zlib';

const tar = promisify(execFile);
const archiveName = 'checkpoint.tar.gz';
const databaseName = 'protolab.sqlite';
const singleUploadBytes = 90 * 1024 * 1024;
const maxArchiveBytes = 512 * 1024 * 1024;
const partBytes = 16 * 1024 * 1024;

export async function compressCheckpoint(rawArchive: string, archive: string, maxBytes = singleUploadBytes): Promise<number> {
  for (const level of [3, 6]) {
    await pipeline(createReadStream(rawArchive), createGzip({ level }), createWriteStream(archive, { mode: 0o600 }));
    const { size } = await stat(archive);
    if (size <= maxBytes) return size;
  }
  throw new Error('Checkpoint exceeds the Cloudflare upload budget.');
}

function multipartUrl(url: string, action: string, parameters: Record<string, string> = {}) {
  const target = new URL(url);
  target.searchParams.set('action', action);
  for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
  return target.toString();
}

/** Upload the same complete archive; R2 multipart completion atomically replaces the last checkpoint.
 * https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/ */
export async function uploadCheckpointArchive(url: string, token: string, archive: string): Promise<void> {
  const { size } = await stat(archive);
  if (!Number.isSafeInteger(size) || size < 1 || size > maxArchiveBytes) throw new Error('Checkpoint exceeds the Cloudflare upload budget.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const checkpointId = randomUUID();
  const headers = { authorization: `Bearer ${token}` };
  const matchingCompletedCheckpoint = async () => {
    try {
      const response = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(15_000) });
      return response.ok && Number(response.headers.get('content-length')) === size
        && response.headers.get('x-checkpoint-id') === checkpointId && response.headers.get('x-checkpoint-sha256') === sha256;
    } catch { return false; }
  };
  const uploadStream = async (target: string, start: number, length: number, extraHeaders: Record<string, string> = {}) => {
    const stream = createReadStream(archive, { start, end: start + length - 1 });
    try {
      return await fetch(target, {
        method: 'PUT', headers: { ...headers, 'content-length': String(length), 'content-type': 'application/gzip', ...extraHeaders },
        body: Readable.toWeb(stream), duplex: 'half', signal: AbortSignal.timeout(60_000),
      } as RequestInit & { duplex: 'half' });
    } finally { stream.destroy(); }
  };
  if (size <= singleUploadBytes) {
    try {
      const response = await uploadStream(url, 0, size, { 'x-checkpoint-id': checkpointId, 'x-checkpoint-sha256': sha256 });
      if (!response.ok) throw new Error(`Cloudflare checkpoint upload failed (HTTP ${response.status}).`);
    } catch (error) {
      // A response can be lost after the object was committed. Only this exact archive counts as success.
      if (!await matchingCompletedCheckpoint()) throw error;
    }
    return;
  }

  let uploadId: string | undefined;
  let completing = false;
  try {
    const created = await fetch(multipartUrl(url, 'multipart-create'), {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ size, checkpointId, sha256 }), signal: AbortSignal.timeout(30_000),
    });
    if (!created.ok) throw new Error(`Cloudflare checkpoint multipart creation failed (HTTP ${created.status}).`);
    const info = await created.json() as { uploadId?: unknown };
    if (typeof info.uploadId !== 'string' || !info.uploadId.trim() || info.uploadId.length > 1024 || /[\x00-\x1f\x7f]/.test(info.uploadId)) {
      throw new Error('Cloudflare checkpoint returned an invalid multipart upload ID.');
    }
    uploadId = info.uploadId;
    const parts: { partNumber: number; etag: string }[] = [];
    for (let start = 0, partNumber = 1; start < size; start += partBytes, partNumber++) {
      const length = Math.min(partBytes, size - start);
      const response = await uploadStream(multipartUrl(url, 'multipart-part', {
        uploadId, partNumber: String(partNumber), size: String(size),
      }), start, length);
      if (!response.ok) throw new Error(`Cloudflare checkpoint part ${partNumber} upload failed (HTTP ${response.status}).`);
      const part = await response.json() as { partNumber?: unknown; etag?: unknown };
      if (part.partNumber !== partNumber || typeof part.etag !== 'string' || !part.etag.trim() || part.etag.length > 256) {
        throw new Error(`Cloudflare checkpoint part ${partNumber} returned an invalid receipt.`);
      }
      parts.push({ partNumber, etag: part.etag });
    }
    completing = true;
    const completed = await fetch(multipartUrl(url, 'multipart-complete'), {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId, size, checkpointId, sha256, parts }), signal: AbortSignal.timeout(60_000),
    });
    if (!completed.ok) throw new Error(`Cloudflare checkpoint multipart completion failed (HTTP ${completed.status}).`);
  } catch (error) {
    if (completing && await matchingCompletedCheckpoint()) return;
    if (uploadId) {
      try {
        await fetch(multipartUrl(url, 'multipart-abort', { uploadId }), {
          method: 'DELETE', headers, signal: AbortSignal.timeout(15_000),
        });
      } catch { /* Preserve the upload failure; R2 also expires abandoned multipart uploads. */ }
    }
    throw error;
  }
}

export class CloudCheckpoint {
  private saving = false;
  private pending: { db: DatabaseSync; waiters: { resolve: () => void; reject: (error: unknown) => void }[] }[] = [];

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
        signal: AbortSignal.timeout(300_000),
      });
      const bytes = Number(response.headers.get('content-length'));
      const expectedHash = response.headers.get('x-checkpoint-sha256');
      if (!response.ok || !response.body || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxArchiveBytes
        || (expectedHash !== null && !/^[a-f0-9]{64}$/i.test(expectedHash))) {
        await response.body?.cancel();
        throw new Error(`Cloudflare checkpoint unavailable (HTTP ${response.status}).`);
      }
      const archive = join(temp, archiveName);
      let received = 0;
      const hash = createHash('sha256');
      const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > bytes || received > maxArchiveBytes) { callback(new Error('Cloudflare checkpoint download exceeded its declared size.')); return; }
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), verify, createWriteStream(archive, { mode: 0o600 }));
      if ((await stat(archive)).size !== bytes) throw new Error('Cloudflare checkpoint download was incomplete.');
      if (expectedHash && hash.digest('hex') !== expectedHash.toLowerCase()) throw new Error('Cloudflare checkpoint checksum verification failed.');
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

  save(db: DatabaseSync): Promise<void> {
    const task = new Promise<void>((resolve, reject) => {
      const queued = this.pending.at(-1);
      if (queued?.db === db) queued.waiters.push({ resolve, reject });
      else this.pending.push({ db, waiters: [{ resolve, reject }] });
    });
    if (!this.saving) {
      this.saving = true;
      void this.flushPending();
    }
    return task;
  }

  private async flushPending() {
    try {
      while (this.pending.length) {
        // Detach before capture: requests arriving during this upload need a later snapshot.
        // One queued capture covers all mutations requested while the preceding upload runs.
        const batch = this.pending.shift()!;
        try {
          await this.upload(batch.db);
          for (const waiter of batch.waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of batch.waiters) waiter.reject(error);
          // A failed batch must not poison the queue or reject callers awaiting the next capture.
        }
      }
    } finally { this.saving = false; }
  }

  private async upload(db: DatabaseSync) {
    const temp = await mkdtemp(join(tmpdir(), 'protolab-checkpoint-'));
    try {
      const archive = join(temp, archiveName);
      // Jobs and routes write the database and object store on this thread. Capture both
      // before yielding so a saved row and its manifest always come from the same revision.
      db.prepare('VACUUM INTO ?').run(join(temp, databaseName));
      cpSync(join(this.dataDir, 'store'), join(temp, 'store'), {
        recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true,
      });
      const rawArchive = join(temp, 'checkpoint.tar');
      await tar('tar', ['-cf', rawArchive, '-C', temp, databaseName, 'store']);
      // Multipart handles larger fast-compressed archives; use level 6 only if the full cap requires it.
      await compressCheckpoint(rawArchive, archive, maxArchiveBytes);
      await uploadCheckpointArchive(this.url, this.token, archive);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}

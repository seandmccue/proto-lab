import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { openDb } from '../src/db.ts';
import { CloudCheckpoint, compressCheckpoint } from '../src/persistence.ts';
import { ObjectStore } from '../src/store.ts';

test('checkpoint compression retries with level 6 when level 3 exceeds the budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-compression-test-'));
  try {
    const rawArchive = join(root, 'checkpoint.tar');
    const archive = join(root, 'checkpoint.tar.gz');
    const fixture = Array.from({ length: 128 }, (_, revision) => ({
      revision,
      instances: Array.from({ length: 5 }, (_, index) => ({
        id: `component-${index + revision % 7}`,
        position: [revision % 3, index, revision % 5],
        anchored: index === 0,
      })),
      result: { passed: revision % 3 === 0, metrics: { travel: revision % 13 / 10 } },
    }));
    await writeFile(join(root, 'fixture.json'), fixture.map((row) => JSON.stringify(row)).join('\n'));
    execFileSync('tar', ['-cf', rawArchive, '-C', root, 'fixture.json']);
    const raw = await readFile(rawArchive);
    const fast = gzipSync(raw, { level: 3 });
    const compact = gzipSync(raw, { level: 6 });
    assert.ok(compact.length < fast.length, 'fixture must exercise the fallback');

    assert.equal(await compressCheckpoint(rawArchive, archive, fast.length), fast.length);
    assert.deepEqual(await readFile(archive), fast);
    assert.equal(await compressCheckpoint(rawArchive, archive, compact.length), compact.length);
    const compressed = await readFile(archive);
    assert.deepEqual(compressed, compact);
    assert.deepEqual(gunzipSync(compressed), raw);
    await assert.rejects(compressCheckpoint(rawArchive, archive, compact.length - 1), /exceeds the Cloudflare upload budget/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent version and preview writes cannot change an in-flight checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-persistence-test-'));
  const data = join(root, 'data');
  const bin = join(root, 'bin');
  const ready = join(root, 'tar-ready');
  const release = join(root, 'tar-release');
  const db = openDb(data);
  const store = new ObjectStore(join(data, 'store'));
  const uploads: Buffer[] = [];
  let restoreIndex = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      uploads.push(Buffer.concat(chunks));
      res.writeHead(204).end();
    } else {
      const bytes = uploads[restoreIndex];
      res.writeHead(200, { 'content-length': bytes.length }).end(bytes);
    }
  });
  const originalPath = process.env.PATH;
  const token = 'local-test-token';
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  try {
    // Block tar immediately after capture, then mutate the real store.
    const realTar = execFileSync('which', ['tar'], { encoding: 'utf8' }).trim();
    await mkdir(bin);
    await writeFile(join(bin, 'tar'), `#!/bin/sh
if [ "$1" = "-cf" ] && [ ! -f '${ready}' ]; then
  touch '${ready}'
  while [ ! -f '${release}' ]; do sleep 0.02; done
fi
exec '${realTar}' "$@"
`, { mode: 0o700 });
    process.env.PATH = `${bin}${delimiter}${originalPath ?? ''}`;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const checkpoint = new CloudCheckpoint(url, token, data);
    const record = db.prepare('INSERT OR REPLACE INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const writeVersion = (id: string, revision: number) => {
      const key = `versions/${id}.json`;
      store.putJson(key, { id, revision });
      record.run(id, 'inv_test', null, 1, 'fixture', '{}', key, JSON.stringify({ revision }), 'test', 'passed', '2026-01-01');
    };
    writeVersion('ver_shared', 1);
    store.putBytes('previews/inv_test.png', Buffer.from('preview 1'));
    first = checkpoint.save(db);
    void first.catch(() => {});
    for (let i = 0; i < 100 && !existsSync(ready); i++) await delay(20);
    assert.ok(existsSync(ready), 'checkpoint entered tar staging');

    writeVersion('ver_shared', 2);
    writeVersion('ver_added', 2);
    store.putBytes('previews/inv_test.png', Buffer.from('preview 2'));
    second = checkpoint.save(db);
    await writeFile(release, '');
    await Promise.all([first, second]);
    assert.equal(uploads.length, 2);

    for (const revision of [1, 2]) {
      restoreIndex = revision - 1;
      const restoredDir = join(root, `restored-${revision}`);
      await new CloudCheckpoint(url, token, restoredDir).restore();
      const restored = openDb(restoredDir);
      try {
        const rows = restored.prepare('SELECT id, metrics_json FROM versions ORDER BY id').all();
        const restoredStore = new ObjectStore(join(restoredDir, 'store'));
        assert.deepEqual(rows.map(({ id }) => id), revision === 1 ? ['ver_shared'] : ['ver_added', 'ver_shared']);
        for (const row of rows) {
          assert.equal(row.metrics_json, JSON.stringify({ revision }));
          assert.deepEqual(restoredStore.getJson(`versions/${row.id}.json`), { id: row.id, revision });
        }
        assert.equal(restoredStore.has('versions/ver_added.json'), revision === 2);
        assert.equal(restoredStore.getBytes('previews/inv_test.png')?.toString(), `preview ${revision}`);
      } finally { restored.close(); }
    }
  } finally {
    await writeFile(release, '');
    await Promise.allSettled([first, second]);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    server.closeAllConnections();
    server.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

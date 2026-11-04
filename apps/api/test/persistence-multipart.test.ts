import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { CloudCheckpoint, uploadCheckpointArchive } from '../src/persistence.ts';
import { ObjectStore } from '../src/store.ts';

const MiB = 1024 * 1024;
const digest = async (path: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};

test('multipart streams a real archive above 90 MiB, restores every byte, and preserves the prior checkpoint on failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-multipart-'));
  const data = join(root, 'source');
  const db = openDb(data);
  const store = new ObjectStore(join(data, 'store'));
  const token = 'local-multipart-test-token';
  type Upload = { size: number; checkpointId: string; sha256: string; parts: Map<number, { path: string; etag: string; size: number }> };
  const uploads = new Map<string, Upload>();
  let current: { path: string; size: number; checkpointId: string; sha256: string } | undefined;
  let serial = 0, aborts = 0, heads = 0;
  let failPart = 0, wrongReceipt = false, loseComplete = false, loseWithoutCommit = false;
  const completedPartSizes: number[][] = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url!, 'http://local');
      const action = url.searchParams.get('action');
      if (!action && (request.method === 'GET' || request.method === 'HEAD')) {
        if (request.method === 'HEAD') heads++;
        assert.ok(current);
        response.writeHead(200, { 'content-length': current.size, 'x-checkpoint-id': current.checkpointId, 'x-checkpoint-sha256': current.sha256 });
        if (request.method === 'HEAD') response.end();
        else await pipeline(createReadStream(current.path), response);
        return;
      }
      if (action === 'multipart-part') {
        const id = url.searchParams.get('uploadId')!;
        const upload = uploads.get(id)!;
        assert.ok(upload);
        const number = Number(url.searchParams.get('partNumber'));
        assert.equal(Number(url.searchParams.get('size')), upload.size);
        const path = join(root, `${id}-${number}`);
        await pipeline(request, createWriteStream(path));
        const size = (await stat(path)).size;
        assert.equal(size, Number(request.headers['content-length']));
        assert.equal(size, Math.min(16 * MiB, upload.size - (number - 1) * 16 * MiB));
        const etag = await digest(path);
        upload.parts.set(number, { path, size, etag });
        if (number === failPart) { response.writeHead(503).end(); return; }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ partNumber: number, etag: wrongReceipt ? '' : etag }));
        return;
      }
      if (action === 'multipart-abort') {
        aborts++;
        const id = url.searchParams.get('uploadId')!;
        const upload = uploads.get(id);
        for (const part of upload?.parts.values() ?? []) await rm(part.path, { force: true });
        uploads.delete(id);
        response.writeHead(204).end(); return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (action === 'multipart-create') {
        assert.ok(body.size > 90 * MiB && body.size <= 512 * MiB);
        assert.match(body.sha256, /^[a-f0-9]{64}$/);
        const uploadId = `upload-${++serial}`;
        uploads.set(uploadId, { ...body, parts: new Map() });
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ uploadId }));
      } else if (action === 'multipart-complete') {
        const upload = uploads.get(body.uploadId)!;
        assert.ok(upload);
        assert.equal(body.size, upload.size);
        assert.equal(body.checkpointId, upload.checkpointId);
        assert.equal(body.sha256, upload.sha256);
        assert.equal(body.parts.length, Math.ceil(upload.size / (16 * MiB)));
        for (const [index, part] of body.parts.entries()) {
          assert.equal(part.partNumber, index + 1);
          assert.equal(part.etag, upload.parts.get(part.partNumber)?.etag);
        }
        if (loseWithoutCommit) { response.destroy(); return; }
        const path = join(root, `completed-${body.uploadId}.tar.gz`);
        await pipeline(Readable.from((async function* () {
          for (const part of body.parts) yield* createReadStream(upload.parts.get(part.partNumber)!.path);
        })()), createWriteStream(path));
        assert.equal((await stat(path)).size, upload.size);
        assert.equal(await digest(path), upload.sha256);
        current = { path, size: upload.size, checkpointId: upload.checkpointId, sha256: upload.sha256 };
        completedPartSizes.push(body.parts.map((part: { partNumber: number }) => upload.parts.get(part.partNumber)!.size));
        for (const part of upload.parts.values()) await rm(part.path, { force: true });
        uploads.delete(body.uploadId);
        if (loseComplete) response.destroy();
        else response.writeHead(204).end();
      } else response.writeHead(400).end();
    } catch (error) { response.writeHead(500).end((error as Error).message); }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/_internal/checkpoint`;
    const record = db.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const id of ['ver_first', 'ver_second']) {
      const manifest = { id, tests: [{ trace: { dt: 0.02, frames: [{ t: 0, bodies: {} }] } }] };
      store.putJson(`versions/${id}.json`, manifest);
      record.run(id, 'inv_test', null, 1, 'fixture', '{}', `versions/${id}.json`, '{}', 'test', 'passed', '2026-01-01');
    }
    const historyPath = join(data, 'store', 'preserved-history.bin');
    const noise = randomBytes(MiB);
    await pipeline(Readable.from((async function* () {
      for (let i = 0; i < 91; i++) yield noise;
      yield noise.subarray(0, 123);
    })()), createWriteStream(historyPath));
    const historyHash = await digest(historyPath);
    await new CloudCheckpoint(url, token, data).save(db);
    assert.ok(current && current.size > 90 * MiB, 'exercise real multipart, not a reduced test threshold');
    const first = current;
    assert.deepEqual(completedPartSizes[0].slice(0, -1), [16 * MiB, 16 * MiB, 16 * MiB, 16 * MiB, 16 * MiB]);
    assert.equal(completedPartSizes[0].at(-1), first.size - 80 * MiB);

    await t.test('full restore retains SQLite rows, both manifests, traces and binary history exactly', async () => {
      const restoredDir = join(root, 'restored');
      await new CloudCheckpoint(url, token, restoredDir).restore();
      const restored = openDb(restoredDir);
      try {
        assert.deepEqual(restored.prepare('SELECT id FROM versions ORDER BY id').all().map(({ id }) => id), ['ver_first', 'ver_second']);
        for (const id of ['ver_first', 'ver_second']) assert.deepEqual(
          await readFile(join(restoredDir, 'store', 'versions', `${id}.json`)), await readFile(join(data, 'store', 'versions', `${id}.json`)),
        );
        assert.equal(await digest(join(restoredDir, 'store', 'preserved-history.bin')), historyHash);
      } finally { restored.close(); }
    });

    await t.test('failed part upload aborts and leaves the old complete checkpoint intact', async () => {
      failPart = 2;
      await assert.rejects(uploadCheckpointArchive(url, token, first.path), /part 2 upload failed/);
      failPart = 0;
      assert.equal(aborts, 1);
      assert.equal(uploads.size, 0);
      assert.deepEqual(current, first);
      assert.equal(await digest(first.path), first.sha256);
    });

    await t.test('a malformed part receipt aborts before completion', async () => {
      wrongReceipt = true;
      await assert.rejects(uploadCheckpointArchive(url, token, first.path), /invalid receipt/);
      wrongReceipt = false;
      assert.equal(aborts, 2);
      assert.equal(uploads.size, 0);
      assert.deepEqual(current, first);
    });

    await t.test('lost completion response is accepted only when HEAD proves the exact newly committed object', async () => {
      loseComplete = true;
      await uploadCheckpointArchive(url, token, first.path);
      loseComplete = false;
      assert.equal(heads, 1);
      assert.notEqual(current!.checkpointId, first.checkpointId);
      assert.equal(current!.sha256, first.sha256);
      assert.equal(aborts, 2);
      assert.equal(uploads.size, 0);
    });

    await t.test('an old checkpoint with identical bytes cannot masquerade as a successful new completion', async () => {
      const before = current;
      loseWithoutCommit = true;
      await assert.rejects(uploadCheckpointArchive(url, token, first.path));
      loseWithoutCommit = false;
      assert.equal(heads, 2);
      assert.deepEqual(current, before);
      assert.equal(aborts, 3);
      assert.equal(uploads.size, 0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('restore rejects misleading lengths, oversized archives and mismatched checksums before replacing local data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-restore-limits-'));
  try {
    await mkdir(join(root, 'store'), { recursive: true });
    const sentinel = join(root, 'store', 'preserved.txt');
    await writeFile(sentinel, 'keep existing creations');
    const responses = [
      new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '1' } }),
      new Response(new Uint8Array([1]), { headers: { 'content-length': String(512 * MiB + 1) } }),
      new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '2', 'x-checkpoint-sha256': '0'.repeat(64) } }),
    ];
    t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
    const checkpoint = new CloudCheckpoint('http://local/checkpoint', 'test', root);
    await assert.rejects(checkpoint.restore(), /exceeded its declared size/);
    await assert.rejects(checkpoint.restore(), /checkpoint unavailable/);
    await assert.rejects(checkpoint.restore(), /checksum verification failed/);
    assert.equal(await readFile(sentinel, 'utf8'), 'keep existing creations');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('empty or oversized upload files are rejected before any request', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-upload-limits-'));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected request'); });
  try {
    const path = join(root, 'checkpoint.tar.gz');
    await writeFile(path, '');
    await assert.rejects(uploadCheckpointArchive('http://local/checkpoint', 'test', path), /upload budget/);
    await truncate(path, 512 * MiB + 1);
    await assert.rejects(uploadCheckpointArchive('http://local/checkpoint', 'test', path), /upload budget/);
    assert.equal(requests, 0);
    assert.ok(existsSync(path));
  } finally { await rm(root, { recursive: true, force: true }); }
});

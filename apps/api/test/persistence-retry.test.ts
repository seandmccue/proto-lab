import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { uploadCheckpointArchive } from '../src/persistence.ts';

const MiB = 1024 * 1024;
const partBytes = 16 * MiB;
const token = 'local-checkpoint-retry-test';
type Metadata = { size: number; checkpointId: string; sha256: string };
type Part = { partNumber: number; etag: string };
type Attempt = {
  action: 'create' | 'part' | 'complete' | 'abort' | 'put' | 'head';
  number: number;
  uploadId?: string;
  partNumber?: number;
  replacesStoredPart?: boolean;
  bytes?: number;
  sha256?: string;
  metadata?: Metadata;
  parts?: Part[];
};
type Fault = number | 'disconnect' | 'commit-disconnect' | 'bad-receipt' | undefined;
type Archive = { path: string; size: number; sha256: string; partHashes: string[] };

async function fileHash(path: string, start?: number, end?: number) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { start, end })) hash.update(chunk);
  return hash.digest('hex');
}

async function archiveFixture(root: string): Promise<Archive> {
  const path = join(root, 'checkpoint.tar.gz');
  const size = 90 * MiB + 123;
  const file = await open(path, 'w', 0o600);
  try {
    await file.truncate(size);
    // Sparse storage keeps the fixture small, but every real 16 MiB range has
    // different bytes at both ends so wrong offsets and reused streams are visible.
    for (let start = 0; start < size; start += partBytes) {
      const end = Math.min(size, start + partBytes);
      await file.write(randomBytes(4096), 0, 4096, start);
      await file.write(randomBytes(4096), 0, 4096, end - 4096);
    }
  } finally { await file.close(); }
  const partHashes: string[] = [];
  for (let start = 0; start < size; start += partBytes) {
    partHashes.push(await fileHash(path, start, Math.min(size, start + partBytes) - 1));
  }
  return { path, size, sha256: await fileHash(path), partHashes };
}

async function endpoint(archive: Archive, fault: (attempt: Attempt) => Fault = () => undefined) {
  const attempts: Attempt[] = [];
  const errors: unknown[] = [];
  const previous: Metadata = { size: archive.size, sha256: archive.sha256, checkpointId: 'previous-checkpoint-id' };
  let current = previous;
  let serial = 0;
  const uploads = new Map<string, Metadata & { parts: Map<number, string> }>();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const url = new URL(request.url!, 'http://local');
      const rawAction = url.searchParams.get('action');
      const action = (rawAction?.replace('multipart-', '') ?? (request.method === 'HEAD' ? 'head' : 'put')) as Attempt['action'];
      const uploadId = url.searchParams.get('uploadId') ?? undefined;
      const partNumber = url.searchParams.has('partNumber') ? Number(url.searchParams.get('partNumber')) : undefined;
      const attempt: Attempt = {
        action, uploadId, partNumber,
        number: attempts.filter((item) => item.action === action && item.partNumber === partNumber).length + 1,
      };
      if (action === 'part' || action === 'put') {
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; hash.update(chunk); }
        attempt.bytes = bytes;
        attempt.sha256 = hash.digest('hex');
        assert.equal(bytes, Number(request.headers['content-length']));
        if (action === 'part') {
          assert.ok(uploadId && uploads.has(uploadId));
          assert.ok(partNumber && partNumber <= archive.partHashes.length);
          attempt.replacesStoredPart = uploads.get(uploadId)!.parts.has(partNumber);
          assert.equal(Number(url.searchParams.get('size')), archive.size);
          assert.equal(bytes, Math.min(partBytes, archive.size - (partNumber - 1) * partBytes));
          assert.equal(attempt.sha256, archive.partHashes[partNumber - 1]);
        } else {
          assert.equal(attempt.sha256, archive.sha256);
          attempt.metadata = {
            size: bytes, checkpointId: String(request.headers['x-checkpoint-id']), sha256: String(request.headers['x-checkpoint-sha256']),
          };
          assert.equal(attempt.metadata.sha256, archive.sha256);
        }
      } else if (action === 'create' || action === 'complete') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Metadata & { uploadId: string; parts: Part[] };
        attempt.metadata = { size: body.size, checkpointId: body.checkpointId, sha256: body.sha256 };
        assert.equal(body.size, archive.size);
        assert.equal(body.sha256, archive.sha256);
        assert.notEqual(body.checkpointId, previous.checkpointId);
        if (action === 'complete') {
          attempt.uploadId = body.uploadId;
          attempt.parts = body.parts;
          const upload = uploads.get(body.uploadId);
          assert.ok(upload, 'completion must retain the upload created for these parts');
          assert.deepEqual(attempt.metadata, { size: upload.size, checkpointId: upload.checkpointId, sha256: upload.sha256 });
          assert.deepEqual(body.parts, archive.partHashes.map((etag, index) => ({ partNumber: index + 1, etag })));
          assert.equal(upload.parts.size, archive.partHashes.length, 'completion cannot run before every part succeeds');
        }
      }
      attempts.push(attempt);
      const failure = fault(attempt);
      if (typeof failure === 'number') { response.writeHead(failure).end(); return; }
      if (failure === 'disconnect') { response.destroy(); return; }
      if (failure === 'bad-receipt') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ partNumber, etag: '' }));
        return;
      }
      if (action === 'head') {
        response.writeHead(200, { 'content-length': current.size, 'x-checkpoint-id': current.checkpointId, 'x-checkpoint-sha256': current.sha256 }).end();
      } else if (action === 'create') {
        const id = `retry-upload-${++serial}`;
        uploads.set(id, { ...attempt.metadata!, parts: new Map() });
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ uploadId: id }));
      } else if (action === 'part') {
        uploads.get(uploadId!)!.parts.set(partNumber!, attempt.sha256!);
        if (failure === 'commit-disconnect') response.destroy();
        else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ partNumber, etag: attempt.sha256 }));
      } else if (action === 'complete' || action === 'put') {
        current = attempt.metadata!;
        if (action === 'complete') uploads.delete(attempt.uploadId!);
        if (failure === 'commit-disconnect') response.destroy();
        else response.writeHead(204).end();
      } else if (action === 'abort') {
        uploads.delete(uploadId!);
        response.writeHead(204).end();
      } else throw new Error(`Unexpected request action ${action}`);
    } catch (error) {
      errors.push(error);
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/_internal/checkpoint`;
  return {
    attempts, errors, uploads, previous,
    get current() { return current; },
    upload: () => uploadCheckpointArchive(url, token, archive.path),
    calls: (action: Attempt['action']) => attempts.filter((item) => item.action === action),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      assert.deepEqual(errors, [], 'the HTTP fixture must receive valid complete byte streams');
    },
  };
}

test('checkpoint retries replay bounded requests without losing or prematurely replacing the saved object', { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'protolab-checkpoint-retry-'));
  try {
    const archive = await archiveFixture(root);
    await t.test('transient creation, HTTP part failure and a lost part response all retry the same content', async () => {
      const f = await endpoint(archive, (a) => a.action === 'create' && a.number === 1 ? 500
        : a.action === 'part' && a.partNumber === 2 && a.number === 1 ? 503
        : a.action === 'part' && a.partNumber === 3 && a.number === 1 ? 'commit-disconnect' : undefined);
      try {
        await f.upload();
        assert.equal(f.calls('create').length, 2);
        assert.deepEqual(f.calls('create')[0].metadata, f.calls('create')[1].metadata);
        assert.deepEqual(f.calls('part').map(({ partNumber }) => partNumber), [1, 2, 2, 3, 3, 4, 5, 6]);
        for (const number of [2, 3]) {
          const [first, retry] = f.calls('part').filter(({ partNumber }) => partNumber === number);
          assert.equal(retry.uploadId, first.uploadId);
          assert.equal(retry.bytes, first.bytes);
          assert.equal(retry.sha256, first.sha256);
          assert.equal(retry.replacesStoredPart, number === 3, 'a lost successful receipt must replay over the already stored part');
        }
        assert.equal(f.calls('complete').length, 1);
        assert.equal(f.calls('abort').length, 0);
        assert.notEqual(f.current.checkpointId, f.previous.checkpointId);
        assert.equal(f.current.sha256, archive.sha256);
      } finally { await f.close(); }
    });

    await t.test('three failed part attempts abort the known upload and retain the prior object', async () => {
      const f = await endpoint(archive, (a) => a.action === 'part' && a.partNumber === 2 ? 503 : undefined);
      try {
        await assert.rejects(f.upload(), /part 2 upload failed.*503/);
        assert.deepEqual(f.calls('part').map(({ partNumber }) => partNumber), [1, 2, 2, 2]);
        assert.equal(new Set(f.calls('part').map(({ uploadId }) => uploadId)).size, 1);
        assert.equal(f.calls('complete').length, 0);
        assert.equal(f.calls('abort').length, 1);
        assert.equal(f.uploads.size, 0);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });

    await t.test('creation has three total attempts for 408, 429 and 500, with no unknown upload to abort', async () => {
      const f = await endpoint(archive, (a) => a.action === 'create' ? [408, 429, 500][a.number - 1] : undefined);
      try {
        await assert.rejects(f.upload(), /multipart creation failed.*500/);
        assert.equal(f.calls('create').length, 3);
        assert.ok(f.calls('create').every(({ metadata }) => JSON.stringify(metadata) === JSON.stringify(f.calls('create')[0].metadata)));
        assert.equal(f.calls('part').length, 0);
        assert.equal(f.calls('abort').length, 0);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });

    for (const status of [400, 401]) await t.test(`permanent HTTP ${status} creation failure is not retried`, async () => {
      const f = await endpoint(archive, (a) => a.action === 'create' ? status : undefined);
      try {
        await assert.rejects(f.upload(), new RegExp(`HTTP ${status}`));
        assert.equal(f.calls('create').length, 1);
        assert.equal(f.calls('part').length, 0);
        assert.equal(f.calls('abort').length, 0);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });

    for (const failure of [400, 'bad-receipt'] as const) await t.test(`permanent part failure ${failure} aborts without replay`, async () => {
      const f = await endpoint(archive, (a) => a.action === 'part' ? failure : undefined);
      try {
        await assert.rejects(f.upload(), failure === 400 ? /HTTP 400/ : /invalid receipt/);
        assert.equal(f.calls('part').length, 1);
        assert.equal(f.calls('complete').length, 0);
        assert.equal(f.calls('abort').length, 1);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });

    await t.test('ambiguous completion checks HEAD, retries transient HEAD, then retries completion unchanged', async () => {
      const f = await endpoint(archive, (a) => a.action === 'complete' && a.number === 1 ? 500
        : a.action === 'head' && a.number === 1 ? 503 : undefined);
      try {
        await f.upload();
        assert.deepEqual(f.attempts.filter(({ action }) => ['complete', 'head'].includes(action)).map(({ action }) => action), ['complete', 'head', 'head', 'complete']);
        const [first, retry] = f.calls('complete');
        assert.equal(first.uploadId, retry.uploadId);
        assert.deepEqual(first.metadata, retry.metadata);
        assert.deepEqual(first.parts, retry.parts);
        assert.equal(f.calls('part').length, 6);
        assert.equal(f.calls('abort').length, 0);
        assert.deepEqual(f.current, retry.metadata);
      } finally { await f.close(); }
    });

    await t.test('lost successful completion is acknowledged only by exact HEAD without repeating completion', async () => {
      const f = await endpoint(archive, (a) => a.action === 'complete' ? 'commit-disconnect'
        : a.action === 'head' && a.number === 1 ? 503 : undefined);
      try {
        await f.upload();
        assert.equal(f.calls('complete').length, 1);
        assert.equal(f.calls('head').length, 2);
        assert.equal(f.calls('abort').length, 0);
        assert.deepEqual(f.current, f.calls('complete')[0].metadata);
        assert.equal(f.uploads.size, 0);
      } finally { await f.close(); }
    });

    await t.test('an older object with identical size and hash cannot satisfy any of three lost completions', async () => {
      const f = await endpoint(archive, (a) => a.action === 'complete' ? 'disconnect' : undefined);
      try {
        await assert.rejects(f.upload());
        assert.equal(f.calls('complete').length, 3);
        assert.equal(f.calls('head').length, 3);
        assert.equal(f.calls('abort').length, 1);
        assert.equal(f.uploads.size, 0);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });

    const bytes = randomBytes(128 * 1024 + 123);
    const small: Archive = { path: join(root, 'small.tar.gz'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), partHashes: [] };
    await writeFile(small.path, bytes, { mode: 0o600 });
    await t.test('single PUT recreates its consumed stream for HTTP and transport retries', async () => {
      const f = await endpoint(small, (a) => a.action === 'put' ? a.number === 1 ? 500 : a.number === 2 ? 'disconnect' : undefined : undefined);
      try {
        await f.upload();
        assert.equal(f.calls('put').length, 3);
        for (const attempt of f.calls('put')) {
          assert.equal(attempt.bytes, small.size);
          assert.equal(attempt.sha256, small.sha256);
          assert.deepEqual(attempt.metadata, f.calls('put')[0].metadata);
        }
        assert.deepEqual(f.current, f.calls('put')[2].metadata);
      } finally { await f.close(); }
    });
    for (const status of [400, 401]) await t.test(`single PUT permanent HTTP ${status} is not retried`, async () => {
      const f = await endpoint(small, (a) => a.action === 'put' ? status : undefined);
      try {
        await assert.rejects(f.upload(), new RegExp(`HTTP ${status}`));
        assert.equal(f.calls('put').length, 1);
        assert.deepEqual(f.current, f.previous);
      } finally { await f.close(); }
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

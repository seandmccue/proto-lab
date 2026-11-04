import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// Import the real Worker handler, replacing only the Cloudflare-only Container base class.
const stubDir = await mkdtemp(join(tmpdir(), 'protolab-worker-test-'));
const containerStub = pathToFileURL(join(stubDir, 'container.mjs')).href;
await writeFile(new URL(containerStub), 'export class Container {}', { mode: 0o600 });
after(() => rm(stubDir, { recursive: true, force: true }));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@cloudflare/containers') return { url: containerStub, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { checkpoint } = await import('../../../deploy/cloudflare/worker.js');
hooks.deregister();
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
if (!subtle.timingSafeEqual) {
  Object.defineProperty(subtle, 'timingSafeEqual', { value: timingSafeEqual, configurable: true });
  after(() => { delete subtle.timingSafeEqual; });
}

const MiB = 1024 * 1024;
const PART_BYTES = 16 * MiB;
const SIZE = 90 * MiB + 123;
const TOKEN = 'local-checkpoint-test-token';
const ID = 'b17b57b4-a613-4dfc-a2d0-ea467a2d06f9';
const SHA = 'a'.repeat(64);
const KEY = 'checkpoints/current.tar.gz';
type Metadata = { checkpointId?: string; sha256?: string; archiveBytes?: string };
type Part = { partNumber: number; etag: string };

class Bucket {
  current: { size: number; bytes: Uint8Array; customMetadata: Metadata } | null = { size: 3, bytes: new Uint8Array([1, 2, 3]), customMetadata: {} };
  uploads = new Map<string, { options: { customMetadata: Metadata }; parts: Map<number, Part> }>();
  calls: { method: string; key: string; args?: unknown }[] = [];
  lastBody?: ReadableStream;
  failPart = false;
  failComplete = false;
  async head(key: string) { this.calls.push({ method: 'head', key }); return this.current; }
  async get(key: string) { this.calls.push({ method: 'get', key }); return this.current && { ...this.current, body: this.current.bytes }; }
  async put(key: string, body: ReadableStream, options: { customMetadata?: Metadata }) {
    this.calls.push({ method: 'put', key, args: options }); this.lastBody = body;
    this.current = { size: Number(options.customMetadata?.archiveBytes ?? 3), bytes: new Uint8Array([4, 5, 6]), customMetadata: options.customMetadata ?? {} };
    return this.current;
  }
  async createMultipartUpload(key: string, options: { customMetadata: Metadata }) {
    this.calls.push({ method: 'create', key, args: options });
    const uploadId = `opaque/upload+${this.uploads.size + 1}==`;
    this.uploads.set(uploadId, { options, parts: new Map() });
    return { uploadId };
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const upload = () => { const value = this.uploads.get(uploadId); if (!value) throw new Error('NoSuchUpload'); return value; };
    return {
      uploadPart: async (partNumber: number, body: ReadableStream) => {
        this.calls.push({ method: 'part', key, args: { uploadId, partNumber } }); this.lastBody = body;
        if (this.failPart) throw new Error('private R2 failure details');
        const part = { partNumber, etag: partNumber.toString(16).padStart(32, '0') };
        upload().parts.set(partNumber, part); return part;
      },
      complete: async (parts: Part[]) => {
        this.calls.push({ method: 'complete', key, args: parts });
        const state = upload();
        if (this.failComplete || parts.some((part) => state.parts.get(part.partNumber)?.etag !== part.etag)) throw new Error('InvalidPart');
        this.current = { size: Number(state.options.customMetadata.archiveBytes), bytes: new Uint8Array([7, 8, 9]), customMetadata: state.options.customMetadata };
        this.uploads.delete(uploadId); return this.current;
      },
      abort: async () => { this.calls.push({ method: 'abort', key, args: { uploadId } }); upload(); this.uploads.delete(uploadId); },
    };
  }
}

function request(method: string, query: Record<string, string | number> = {}, options: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}`, ...options.headers });
  let body = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set('content-type', 'application/json');
    if (!headers.has('content-length')) headers.set('content-length', String(Buffer.byteLength(body)));
  }
  const url = new URL('https://checkpoint.test/_internal/checkpoint');
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  return new Request(url, { method, headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit);
}

const handle = (req: Request, bucket: Bucket) => checkpoint(req, { PROTOLAB_CHECKPOINT_TOKEN: TOKEN, PROTOLAB_DATA: bucket });
const metadata = (size = SIZE) => ({ size, checkpointId: ID, sha256: SHA });
async function create(bucket: Bucket, size = SIZE) {
  const response = await handle(request('POST', { action: 'multipart-create' }, { json: metadata(size) }), bucket);
  assert.equal(response.status, 200);
  return (await response.json() as { uploadId: string }).uploadId;
}
function partRequest(uploadId: string, partNumber: number, size = SIZE, length = Math.min(PART_BYTES, size - (partNumber - 1) * PART_BYTES)) {
  // The transport mock inspects declared lengths without allocating a >90 MiB blob; stream integration is tested separately.
  return request('PUT', { action: 'multipart-part', uploadId, partNumber, size }, { body: new Uint8Array([1]), headers: { 'content-length': String(length) } });
}

test('all checkpoint operations require authentication before reaching R2', async () => {
  const bucket = new Bucket();
  for (const [method, action] of [['GET', ''], ['HEAD', ''], ['PUT', ''], ['POST', 'multipart-create'], ['PUT', 'multipart-part'], ['POST', 'multipart-complete'], ['DELETE', 'multipart-abort']]) {
    assert.equal((await handle(request(method, action ? { action } : {}, { headers: { authorization: `Bearer ${'x'.repeat(TOKEN.length)}` } }), bucket)).status, 404);
  }
  assert.equal(bucket.calls.length, 0);
});

test('legacy GET/PUT remain compatible and HEAD exposes optional checkpoint identity/hash', async () => {
  const bucket = new Bucket();
  const download = await handle(request('GET'), bucket);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(download.headers.get('x-checkpoint-id'), null);
  const upload = request('PUT', {}, { body: new Uint8Array([4, 5, 6]), headers: { 'content-length': '3' } });
  assert.equal((await handle(upload, bucket)).status, 204);
  assert.equal(bucket.lastBody, upload.body, 'legacy archive is streamed directly to R2');
  assert.deepEqual(bucket.calls.at(-1)?.args, { httpMetadata: { contentType: 'application/gzip' } });

  const checked = request('PUT', {}, { body: new Uint8Array([4, 5, 6]), headers: { 'content-length': '3', 'x-checkpoint-id': ID, 'x-checkpoint-sha256': SHA.toUpperCase() } });
  assert.equal((await handle(checked, bucket)).status, 204);
  assert.deepEqual(bucket.calls.at(-1)?.args, { httpMetadata: { contentType: 'application/gzip' }, sha256: SHA, customMetadata: { checkpointId: ID, sha256: SHA, archiveBytes: '3' } });
  for (const method of ['HEAD', 'GET']) {
    const response = await handle(request(method), bucket);
    assert.equal(response.headers.get('x-checkpoint-id'), ID);
    assert.equal(response.headers.get('x-checkpoint-sha256'), SHA);
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (method === 'HEAD') assert.equal(response.body, null);
  }
  assert.ok(bucket.calls.every(({ key }) => key === KEY));
  bucket.current = null;
  assert.equal((await handle(request('HEAD'), bucket)).status, 404);
  assert.equal((await handle(request('GET'), bucket)).status, 404);
});

test('multipart streams exact-size parts and only replaces current checkpoint after complete', async () => {
  const bucket = new Bucket();
  const previous = bucket.current;
  const uploadId = await create(bucket);
  assert.deepEqual(bucket.calls[0].args, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { checkpointId: ID, sha256: SHA, archiveBytes: String(SIZE) } });
  const parts: Part[] = [];
  for (let partNumber = 1; partNumber <= Math.ceil(SIZE / PART_BYTES); partNumber++) {
    const req = partRequest(uploadId, partNumber);
    const response = await handle(req, bucket);
    assert.equal(response.status, 200);
    parts.push(await response.json() as Part);
    assert.equal(bucket.lastBody, req.body, 'do not buffer archive data in the Worker');
    assert.equal(bucket.current, previous, 'unfinished upload leaves the previous object available');
  }
  const complete = await handle(request('POST', { action: 'multipart-complete' }, { json: { ...metadata(), uploadId, parts } }), bucket);
  assert.equal(complete.status, 204);
  assert.notEqual(bucket.current, previous);
  assert.equal(bucket.current?.size, SIZE);
  assert.equal(bucket.uploads.size, 0);
  const head = await handle(request('HEAD'), bucket);
  assert.equal(head.headers.get('content-length'), String(SIZE));
  assert.equal(head.headers.get('x-checkpoint-id'), ID);
  assert.equal((await handle(request('GET'), bucket)).status, 200, 'restore download accepts archives above the old 90 MiB cap');
  assert.ok(bucket.calls.every(({ key }) => key === KEY));
});

test('multipart size and identity bounds reject invalid control requests without creating uploads', async () => {
  const bucket = new Bucket();
  for (const value of [
    metadata(90 * MiB), metadata(512 * MiB + 1), metadata(12.5), { ...metadata(), size: String(SIZE) },
    { ...metadata(), checkpointId: 'short' }, { ...metadata(), checkpointId: 'a/b/../../other' },
    { ...metadata(), sha256: 'x'.repeat(64) }, { ...metadata(), sha256: SHA + '0' }, { ...metadata(), key: 'other/object' },
  ]) assert.equal((await handle(request('POST', { action: 'multipart-create' }, { json: value }), bucket)).status, 400);
  assert.equal(bucket.calls.length, 0);
  await create(bucket, 512 * MiB);
  assert.equal(bucket.uploads.size, 1, 'the explicit archive maximum is supported');
});

test('part lengths and numbers must match the uniform chunk plan including the final remainder', async () => {
  const bucket = new Bucket();
  const uploadId = await create(bucket);
  for (const req of [
    partRequest(uploadId, 1, SIZE, PART_BYTES - 1), partRequest(uploadId, 6, SIZE, PART_BYTES),
    partRequest(uploadId, 0), partRequest(uploadId, 7), partRequest(uploadId, 1, 512 * MiB + 1),
    partRequest('x'.repeat(1025), 1), partRequest(uploadId, 1, SIZE, 0),
  ]) assert.ok([400, 413].includes((await handle(req, bucket)).status));
  assert.equal(bucket.calls.filter(({ method }) => method === 'part').length, 0);
  assert.equal((await handle(partRequest(uploadId, 6), bucket)).status, 200);
  const maxId = await create(bucket, 512 * MiB);
  assert.equal((await handle(partRequest(maxId, 32, 512 * MiB), bucket)).status, 200);
});

test('completion requires an exact contiguous bounded part list', async () => {
  const bucket = new Bucket();
  const uploadId = await create(bucket);
  const parts = Array.from({ length: 6 }, (_, index) => ({ partNumber: index + 1, etag: 'a'.repeat(32) }));
  const invalid = [parts.slice(1), [...parts, parts[0]], [...parts].reverse(), parts.map((part) => ({ ...part, partNumber: 1 })),
    parts.map((part) => ({ ...part, etag: 'a'.repeat(129) })), parts.map((part) => ({ ...part, extra: true })), [null, ...parts.slice(1)]];
  for (const list of invalid) assert.equal((await handle(request('POST', { action: 'multipart-complete' }, { json: { ...metadata(), uploadId, parts: list } }), bucket)).status, 400);
  assert.equal(bucket.calls.filter(({ method }) => method === 'complete').length, 0);
  assert.equal((await handle(request('POST', { action: 'multipart-complete' }, { json: { ...metadata(), uploadId, parts } }), bucket)).status, 500, 'R2 rejects missing uploaded parts');
  assert.equal(bucket.current?.size, 3);
});

test('failed uploads and completion retain previous object; abort cleans incomplete state', async () => {
  const bucket = new Bucket();
  const previous = bucket.current;
  const uploadId = await create(bucket);
  bucket.failPart = true;
  const failure = await handle(partRequest(uploadId, 1), bucket);
  assert.equal(failure.status, 500);
  assert.equal(await failure.text(), 'Checkpoint storage failed');
  bucket.failPart = false;
  const parts: Part[] = [];
  for (let part = 1; part <= 6; part++) parts.push(await (await handle(partRequest(uploadId, part), bucket)).json() as Part);
  bucket.failComplete = true;
  assert.equal((await handle(request('POST', { action: 'multipart-complete' }, { json: { ...metadata(), uploadId, parts } }), bucket)).status, 500);
  assert.equal(bucket.current, previous);
  assert.equal((await handle(request('DELETE', { action: 'multipart-abort', uploadId }), bucket)).status, 204);
  assert.equal(bucket.uploads.size, 0);
  assert.equal(bucket.current, previous);
});

test('completion checks returned object size and the identity/hash captured at initiation', async () => {
  for (const tamper of ['checkpointId', 'sha256', 'archiveBytes', 'size']) {
    const bucket = new Bucket();
    const uploadId = await create(bucket);
    const parts: Part[] = [];
    for (let part = 1; part <= 6; part++) parts.push(await (await handle(partRequest(uploadId, part), bucket)).json() as Part);
    const resume = bucket.resumeMultipartUpload.bind(bucket);
    bucket.resumeMultipartUpload = (key, id) => {
      const upload = resume(key, id);
      return { ...upload, complete: async (completedParts) => {
        const object = await upload.complete(completedParts);
        if (tamper === 'size') return { ...object, size: object.size + 1 };
        return { ...object, customMetadata: { ...object.customMetadata, [tamper]: 'mismatch' } };
      } };
    };
    assert.equal((await handle(request('POST', { action: 'multipart-complete' }, { json: { ...metadata(), uploadId, parts } }), bucket)).status, 500);
  }
});

test('bounded JSON reads reject malformed, over-advertised and streamed oversized control bodies', async () => {
  const bucket = new Bucket();
  assert.equal((await handle(request('POST', { action: 'multipart-create' }, { body: '{oops' }), bucket)).status, 400);
  assert.equal((await handle(request('POST', { action: 'multipart-create' }, { body: '{}', headers: { 'content-length': '8193' } }), bucket)).status, 413);
  assert.equal((await handle(request('POST', { action: 'multipart-create' }, { body: '{}', headers: { 'content-length': '3' } }), bucket)).status, 400);
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); controller.close(); } });
  assert.equal((await handle(request('POST', { action: 'multipart-create' }, { body: tooLarge }), bucket)).status, 413);
  assert.equal(bucket.calls.length, 0);
});

test('single PUT size cap and optional hash/identity pair cannot be bypassed', async () => {
  const bucket = new Bucket();
  for (const headers of [
    { 'content-length': String(90 * MiB + 1) }, { 'content-length': '0' }, { 'content-length': '1e3' },
    { 'content-length': '3', 'x-checkpoint-id': ID }, { 'content-length': '3', 'x-checkpoint-sha256': SHA },
    { 'content-length': '3', 'x-checkpoint-id': ID, 'x-checkpoint-sha256': 'invalid' },
  ]) assert.ok([400, 413].includes((await handle(request('PUT', {}, { body: new Uint8Array([1]), headers }), bucket)).status));
  assert.equal(bucket.calls.length, 0);
});

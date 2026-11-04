import { Container } from '@cloudflare/containers';

const checkpointPath = '/_internal/checkpoint';
const maxBytes = 90 * 1024 * 1024;
const maxArchiveBytes = 512 * 1024 * 1024;
const checkpointPartBytes = 16 * 1024 * 1024;
const maxCheckpointJsonBytes = 8 * 1024;
const demoKey = 'public/judge-demo.mp4';

export class ProtoLabContainer extends Container {
  defaultPort = 8787;
  sleepAfter = '15m';
  pingEndpoint = 'localhost/api/load';
  envVars = {
    MODEL_API_KEY: this.env.MODEL_API_KEY,
    // Set MODEL_TRANSPORT=chat to restore Chat for both models, or override Wonder independently.
    MODEL_TRANSPORT: this.env.MODEL_TRANSPORT ?? 'responses-encrypted',
    MODEL_RESPONSES_REASONING_EFFORT: this.env.MODEL_RESPONSES_REASONING_EFFORT ?? 'low',
    MODEL_SPECIALIST_TRANSPORT: this.env.MODEL_SPECIALIST_TRANSPORT ?? '',
    MODEL_SPECIALIST_REASONING_EFFORT: this.env.MODEL_SPECIALIST_REASONING_EFFORT ?? 'high',
    PROTOLAB_CHECKPOINT_TOKEN: this.env.PROTOLAB_CHECKPOINT_TOKEN,
    PROTOLAB_CHECKPOINT_URL: this.env.PROTOLAB_CHECKPOINT_URL,
    JOB_CONCURRENCY: '2',
    JOB_MAX_QUEUED: '6',
  };
}

class CheckpointInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const positiveInteger = (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const validUploadId = (value) => typeof value === 'string' && /^[\x21-\x7e]{1,1024}$/.test(value);
const validCheckpointId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(value);
const validSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const validPartEtag = (value) => typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value);
const validMultipartSize = (size) => Number.isSafeInteger(size) && size > maxBytes && size <= maxArchiveBytes;

async function checkpointJson(request) {
  const advertised = request.headers.get('content-length');
  if (advertised !== null && (positiveInteger(advertised) === null || Number(advertised) > maxCheckpointJsonBytes)) {
    throw new CheckpointInputError('Invalid checkpoint control length', 413);
  }
  if (!request.body) throw new CheckpointInputError('Missing checkpoint control body');
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxCheckpointJsonBytes) {
        await reader.cancel();
        throw new CheckpointInputError('Checkpoint control body too large', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (advertised !== null && length !== Number(advertised)) throw new CheckpointInputError('Incomplete checkpoint control body');
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new CheckpointInputError('Invalid checkpoint control JSON'); }
}

function validateMultipartMetadata(value, keys) {
  if (Object.keys(value).some((key) => !keys.includes(key)) || !validMultipartSize(value.size)
    || !validCheckpointId(value.checkpointId) || !validSha256(value.sha256)) {
    throw new CheckpointInputError('Invalid multipart checkpoint metadata');
  }
  return { checkpointId: value.checkpointId, sha256: value.sha256.toLowerCase(), archiveBytes: String(value.size) };
}

export async function checkpoint(request, env) {
  const expected = env.PROTOLAB_CHECKPOINT_TOKEN;
  const supplied = request.headers.get('authorization')?.slice(7) ?? '';
  if (!expected || request.headers.get('authorization')?.slice(0, 7) !== 'Bearer ' || supplied.length !== expected.length) {
    return new Response('Not found', { status: 404 });
  }
  const encoder = new TextEncoder();
  const suppliedBytes = encoder.encode(supplied);
  const expectedBytes = encoder.encode(expected);
  if (suppliedBytes.length !== expectedBytes.length || !crypto.subtle.timingSafeEqual(suppliedBytes, expectedBytes)) {
    return new Response('Not found', { status: 404 });
  }
  const key = 'checkpoints/current.tar.gz';
  const headers = { 'cache-control': 'no-store' };
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    if (!action && (request.method === 'GET' || request.method === 'HEAD')) {
      const object = request.method === 'HEAD' ? await env.PROTOLAB_DATA.head(key) : await env.PROTOLAB_DATA.get(key);
      if (!object) return new Response('Checkpoint missing', { status: 404, headers });
      if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > maxArchiveBytes) throw new Error('Invalid stored archive size');
      const metadata = object.customMetadata ?? {};
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
        ...headers, 'content-type': 'application/gzip', 'content-length': String(object.size),
        ...(validCheckpointId(metadata.checkpointId) ? { 'x-checkpoint-id': metadata.checkpointId } : {}),
        ...(validSha256(metadata.sha256) ? { 'x-checkpoint-sha256': metadata.sha256.toLowerCase() } : {}),
      } });
    }
    if (!action && request.method === 'PUT') {
      const size = positiveInteger(request.headers.get('content-length'));
      if (!request.body || size === null || size > maxBytes) throw new CheckpointInputError('Invalid checkpoint length', 413);
      const checkpointId = request.headers.get('x-checkpoint-id');
      const sha256 = request.headers.get('x-checkpoint-sha256');
      const hasMetadata = checkpointId !== null || sha256 !== null;
      if (hasMetadata && (!validCheckpointId(checkpointId) || !validSha256(sha256))) throw new CheckpointInputError('Invalid checkpoint metadata');
      await env.PROTOLAB_DATA.put(key, request.body, {
        httpMetadata: { contentType: 'application/gzip' },
        ...(hasMetadata ? { sha256: sha256.toLowerCase(), customMetadata: { checkpointId, sha256: sha256.toLowerCase(), archiveBytes: String(size) } } : {}),
      });
      return new Response(null, { status: 204, headers });
    }
    if (action === 'multipart-create' && request.method === 'POST') {
      const value = await checkpointJson(request);
      const customMetadata = validateMultipartMetadata(value, ['size', 'checkpointId', 'sha256']);
      const upload = await env.PROTOLAB_DATA.createMultipartUpload(key, { httpMetadata: { contentType: 'application/gzip' }, customMetadata });
      return Response.json({ uploadId: upload.uploadId }, { headers });
    }
    if (action === 'multipart-part' && request.method === 'PUT') {
      const uploadId = url.searchParams.get('uploadId');
      const partNumber = positiveInteger(url.searchParams.get('partNumber'));
      const size = positiveInteger(url.searchParams.get('size'));
      if (!validUploadId(uploadId) || !validMultipartSize(size) || partNumber === null || partNumber > Math.ceil(size / checkpointPartBytes)) {
        throw new CheckpointInputError('Invalid multipart part');
      }
      const length = Math.min(checkpointPartBytes, size - (partNumber - 1) * checkpointPartBytes);
      if (!request.body || positiveInteger(request.headers.get('content-length')) !== length) throw new CheckpointInputError('Invalid multipart part length', 413);
      // Each request stays below the Worker request limit; the blob is never buffered in this Worker.
      // https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
      const part = await env.PROTOLAB_DATA.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
      return Response.json({ partNumber: part.partNumber, etag: part.etag }, { headers });
    }
    if (action === 'multipart-complete' && request.method === 'POST') {
      const value = await checkpointJson(request);
      const expectedMetadata = validateMultipartMetadata(value, ['uploadId', 'size', 'checkpointId', 'sha256', 'parts']);
      if (!validUploadId(value.uploadId) || !Array.isArray(value.parts) || value.parts.length !== Math.ceil(value.size / checkpointPartBytes)
        || value.parts.some((part, index) => !part || typeof part !== 'object' || Object.keys(part).some((name) => name !== 'partNumber' && name !== 'etag')
          || part.partNumber !== index + 1 || !validPartEtag(part.etag))) throw new CheckpointInputError('Invalid multipart completion parts');
      // R2 exposes the new object only after completing the supplied parts; keep the existing single writer.
      const object = await env.PROTOLAB_DATA.resumeMultipartUpload(key, value.uploadId).complete(value.parts);
      if (object.size !== value.size || object.customMetadata?.checkpointId !== expectedMetadata.checkpointId
        || object.customMetadata?.sha256 !== expectedMetadata.sha256 || object.customMetadata?.archiveBytes !== expectedMetadata.archiveBytes) {
        throw new Error('Completed checkpoint metadata does not match the requested archive');
      }
      return new Response(null, { status: 204, headers });
    }
    if (action === 'multipart-abort' && request.method === 'DELETE') {
      const uploadId = url.searchParams.get('uploadId');
      if (!validUploadId(uploadId)) throw new CheckpointInputError('Invalid multipart upload ID');
      await env.PROTOLAB_DATA.resumeMultipartUpload(key, uploadId).abort();
      return new Response(null, { status: 204, headers });
    }
    return new Response(null, { status: 405, headers });
  } catch (error) {
    return new Response(error instanceof CheckpointInputError ? error.message : 'Checkpoint storage failed', {
      status: error instanceof CheckpointInputError ? error.status : 500, headers,
    });
  }
}

async function demoVideo(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const options = { range: request.headers };
  const object = request.method === 'HEAD' ? await env.PROTOLAB_DATA.head(demoKey) : await env.PROTOLAB_DATA.get(demoKey, options);
  if (!object) return new Response('Video unavailable', { status: 404 });
  const headers = new Headers({
    'content-type': 'video/mp4',
    'content-length': String(object.size),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=300',
    etag: object.httpEtag,
  });
  const range = object.range;
  if (request.method === 'GET' && request.headers.has('range') && range?.offset !== undefined && range.length !== undefined) {
    headers.set('content-length', String(range.length));
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === checkpointPath) return checkpoint(request, env);
    if (pathname === '/judge-demo.mp4') return demoVideo(request, env);
    const id = env.PROTOLAB_CONTAINER.idFromName('production');
    return env.PROTOLAB_CONTAINER.get(id).fetch(request);
  },
};

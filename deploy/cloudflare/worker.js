import { Container } from '@cloudflare/containers';

const checkpointPath = '/_internal/checkpoint';
const maxBytes = 90 * 1024 * 1024;
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

async function checkpoint(request, env) {
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
  if (request.method === 'GET') {
    const object = await env.PROTOLAB_DATA.get(key);
    if (!object) return new Response('Checkpoint missing', { status: 404, headers });
    return new Response(object.body, { headers: { ...headers, 'content-type': 'application/gzip', 'content-length': String(object.size) } });
  }
  if (request.method === 'PUT') {
    const size = Number(request.headers.get('content-length'));
    if (!request.body || !Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
      return new Response('Invalid checkpoint length', { status: 413, headers });
    }
    await env.PROTOLAB_DATA.put(key, request.body, { httpMetadata: { contentType: 'application/gzip' } });
    return new Response(null, { status: 204, headers });
  }
  return new Response(null, { status: 405, headers });
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

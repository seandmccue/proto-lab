import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chat } from './llm.ts';

test('chat retries a 503 service_overloaded reply and then succeeds', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (hits <= 2) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'service_overloaded', message: 'The backend is temporarily overloaded' } })); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_plan', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const retries: number[] = [];
    const res = await chat({ baseUrl: `http://127.0.0.1:${port}`, model: 'muse-wonder-1.0', apiKey: 'test', maxTokens: 64, timeoutMs: 5000 }, [{ role: 'user', content: 'hi' }], [], { toolChoice: 'auto', onRetry: (r) => { retries.push(r.attempt); assert.match(r.reason, /503/); } });
    assert.equal(hits, 3);
    assert.deepEqual(retries, [1, 2], 'caller is told about each retry');
    assert.equal(res.toolCalls[0]?.function.name, 'write_plan');
  } finally { server.close(); }
});

test('chat reports a non-transient Meta error verbatim without retrying', async () => {
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'bad key' } })); });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(() => chat({ baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 64, timeoutMs: 5000 }, [{ role: 'user', content: 'hi' }], [], { toolChoice: 'auto' }), /HTTP 401.*unauthorized/);
    assert.equal(hits, 1);
  } finally { server.close(); }
});

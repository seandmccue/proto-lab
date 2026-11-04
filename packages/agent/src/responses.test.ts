import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { assistantMessage, chat, modelConfigFromEnv, TransientModelError, type ChatMessage, type ModelConfig } from './llm.ts';

test('Responses transport and reasoning effort require valid opt-in values', () => {
  assert.equal(modelConfigFromEnv({ MODEL_API_KEY: 'test' })?.transport, undefined);
  assert.equal(modelConfigFromEnv({ MODEL_API_KEY: 'test', MODEL_TRANSPORT: 'typo' })?.transport, undefined);
  assert.equal(modelConfigFromEnv({ MODEL_API_KEY: 'test', MODEL_RESPONSES_REASONING_EFFORT: 'none' })?.reasoningEffort, undefined);
  const cfg = modelConfigFromEnv({ MODEL_API_KEY: 'test', MODEL_TRANSPORT: 'responses-encrypted', MODEL_RESPONSES_REASONING_EFFORT: 'medium' });
  assert.equal(cfg?.transport, 'responses-encrypted');
  assert.equal(cfg?.reasoningEffort, 'medium');
});

const tools = [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }];
type Body = Record<string, unknown> & { input: Array<Record<string, unknown>> };

type Intercept = (res: ServerResponse, request: number) => boolean;
const rejectLineage = (status: number, res: ServerResponse) => {
  res.writeHead(status);
  res.end(JSON.stringify({ error: { message: 'Referenced response not found', param: 'previous_response_id' } }));
  return true;
};

async function withResponsesServer(run: (cfg: ModelConfig, requests: Body[]) => Promise<void>, intercept?: Intercept) {
  const requests: Body[] = [];
  const paths: (string | undefined)[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as Body;
    requests.push(body);
    paths.push(req.url);
    const n = requests.length;
    res.setHeader('content-type', 'application/json');
    if (intercept?.(res, n)) return;
    res.end(JSON.stringify({
      id: `resp_${n}`, status: 'completed',
      output: [
        { type: 'reasoning', id: `rs_${n}`, summary: [], encrypted_content: `opaque_${n}` },
        { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working' }] },
        { type: 'function_call', call_id: `call_${n}`, name: 'echo', arguments: '{"n":7}', status: 'completed' },
      ],
      usage: { input_tokens: 12, output_tokens: 15, output_tokens_details: { reasoning_tokens: 10 } },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 256, timeoutMs: 3000 }, requests);
    assert.ok(paths.length > 0 && paths.every((url) => url === '/responses'));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const history = (): ChatMessage[] => [{ role: 'system', content: 'Inspect the device' }, { role: 'user', content: 'Start' }];

async function toolTurn(cfg: ModelConfig, messages: ChatMessage[]) {
  const result = await chat(cfg, messages, tools, { toolChoice: 'auto' });
  assert.equal(result.content, 'Working');
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.usage?.completion_tokens_details?.reasoning_tokens, 10);
  const call = result.toolCalls[0];
  assert.equal(call?.function.name, 'echo');
  messages.push(assistantMessage(result), { role: 'tool', tool_call_id: call.id, content: '{"n":13}' });
}

test('encrypted replay survives a tool round and resets at a specialist handoff', async () => {
  await withResponsesServer(async (config, requests) => {
    const spark = { ...config, transport: 'responses-encrypted' as const, reasoningEffort: 'medium' as const };
    const wonder = { ...spark, model: 'muse-wonder-1.0' };
    const messages = history();
    await toolTurn(spark, messages);
    await toolTurn(spark, messages);
    assert.equal(requests[0].store, false);
    assert.deepEqual(requests[0].reasoning, { effort: 'medium' });
    assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
    assert.equal((requests[0].tools as { name: string }[])[0]?.name, 'echo');
    assert.equal(requests[1].input.find((item) => item.type === 'reasoning')?.encrypted_content, 'opaque_1');
    assert.deepEqual(requests[1].input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{"n":13}' });

    messages.push({ role: 'user', content: 'Specialist handoff' });
    await toolTurn(wonder, messages);
    assert.equal(requests[2].model, 'muse-wonder-1.0');
    assert.equal(requests[2].previous_response_id, undefined);
    assert.equal(requests[2].input.some((item) => item.type === 'reasoning'), false);
    assert.deepEqual(requests[2].input.filter((item) => item.type === 'function_call_output').map((item) => item.call_id), ['call_1', 'call_2']);
    assert.ok(requests[2].input.some((item) => item.role === 'assistant' && item.phase === 'commentary'));

    messages.push({ role: 'user', content: 'Primary resumes' });
    await toolTurn(spark, messages);
    assert.equal(requests[3].input.some((item) => item.type === 'reasoning'), false);
    assert.deepEqual(requests[3].input.filter((item) => item.type === 'function_call_output').map((item) => item.call_id), ['call_1', 'call_2', 'call_3']);
    await toolTurn(spark, messages);
    assert.deepEqual(requests[4].input.filter((item) => item.type === 'reasoning').map((item) => item.encrypted_content), ['opaque_4']);
    assert.doesNotMatch(JSON.stringify(messages), /opaque_/);
  });
});

test('stored continuation sends just new tool output and replays visible history if the ID expires', async () => {
  await withResponsesServer(async (config, requests) => {
    const cfg = { ...config, transport: 'responses-stored' as const };
    const messages = history();
    await toolTurn(cfg, messages);
    await toolTurn(cfg, messages);
    assert.equal(requests[0].store, true);
    assert.equal(requests[0].include, undefined);
    assert.equal(requests[1].previous_response_id, 'resp_1');
    assert.deepEqual(requests[1].input, [{ type: 'function_call_output', call_id: 'call_1', output: '{"n":13}' }]);
    assert.equal(requests[2].previous_response_id, undefined);
    assert.ok(requests[2].input.some((item) => item.type === 'function_call' && item.call_id === 'call_1'));
    assert.ok(requests[2].input.some((item) => item.type === 'function_call_output' && item.call_id === 'call_1'));
  }, (res, request) => request === 2 && rejectLineage(400, res));
});

test('an explicit 404 lineage error replays visible history, while a generic 404 remains terminal', async () => {
  for (const lineage of [true, false]) {
    await withResponsesServer(async (config, requests) => {
      const cfg = { ...config, transport: 'responses-stored' as const };
      const messages = history();
      await toolTurn(cfg, messages);
      if (lineage) {
        await toolTurn(cfg, messages);
        assert.equal(requests.length, 3);
        assert.equal(requests[2].previous_response_id, undefined);
        assert.deepEqual(requests[2].input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{"n":13}' });
      } else {
        await assert.rejects(() => chat(cfg, messages, tools), /HTTP 404.*Route not found/);
        assert.equal(requests.length, 2);
      }
      assert.equal(requests[1].previous_response_id, 'resp_1');
    }, (res, request) => {
      if (request !== 2) return false;
      if (lineage) return rejectLineage(404, res);
      res.writeHead(404);
      res.end(JSON.stringify({ error: { message: 'Route not found' } }));
      return true;
    });
  }
});

test('a network failure and timeout after lineage recovery report the transient request error', async () => {
  await withResponsesServer(async (config, requests) => {
    const cfg = { ...config, transport: 'responses-stored' as const };
    const messages = history();
    await toolTurn(cfg, messages);
    await assert.rejects(() => chat({ ...cfg, timeoutMs: 200 }, messages, tools), {
      name: TransientModelError.name,
      message: /no response within 0\.2 s.*after 2 attempts/,
    });
    assert.equal(requests.length, 4);
    assert.equal(requests[1].previous_response_id, 'resp_1');
    assert.equal(requests[2].previous_response_id, undefined);
    assert.deepEqual(requests[3], requests[2]);
  }, (res, request) => {
    if (request === 2) return rejectLineage(400, res);
    if (request === 3) res.destroy();
    // The second fallback attempt never returns headers.
    return request >= 3;
  });
});

test('changing credentials resets stored and encrypted continuation', async () => {
  for (const transport of ['responses-stored', 'responses-encrypted'] as const) {
    await withResponsesServer(async (config, requests) => {
      const cfg = { ...config, transport };
      const messages = history();
      await toolTurn(cfg, messages);
      await toolTurn({ ...cfg, apiKey: 'another-test-credential' }, messages);
      assert.equal(requests[1].previous_response_id, undefined);
      assert.equal(requests[1].input.some((item) => item.type === 'reasoning'), false);
      assert.ok(requests[1].input.some((item) => item.type === 'function_call' && item.call_id === 'call_1'));
      assert.deepEqual(requests[1].input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{"n":13}' });
    });
  }
});

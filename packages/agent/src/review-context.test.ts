import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart } from '@protolab/parts';
import { TestSpec, VersionRecord, type ToolLogEntry } from '@protolab/schema';
import { baseSpec, runAgent, type AgentEvent } from './index.ts';
import { MAX_SAVED_REVIEW_BYTES, savedFailedReviewContext } from './review-context.ts';

const failed = { passed: false, retryable: false, summary: 'Latest support gap needs repair.',
  issues: [{ message: 'The support needs inspection.', instanceIds: ['support'], suggestion: 'Inspect the current support before retesting.' }] };
const record = (args: unknown = failed, ok = false): ToolLogEntry => ({ t: '2026-01-01', tool: 'review_design', args, ok, summary: 'Saved review' });

test('only the latest completed failed review supplies historical hints', () => {
  const log = [record({ ...failed, summary: 'Obsolete issue' }), record()];
  const before = structuredClone(log);
  assert.deepEqual(JSON.parse(savedFailedReviewContext(log)!), { summary: failed.summary, issues: failed.issues, truncated: false });
  assert.equal(savedFailedReviewContext([...log, record({ passed: true, retryable: false, summary: 'Fixed', issues: [] }, true)]), undefined);
  for (const malformed of [null, 'not JSON', {}, { ...failed, retryable: true }, { ...failed, passed: true },
    { ...failed, issues: [] }, { ...failed, issues: [null] }, { ...failed, issues: [{ message: 4 }] },
    { ...failed, issues: [{ message: 'Bad IDs', instanceIds: [3] }] }]) {
    assert.equal(savedFailedReviewContext([...log, record(malformed)]), undefined, 'do not resurrect an older veto behind an invalid latest record');
  }
  assert.deepEqual(log, before);
});

test('large Unicode and escaped review text remains complete bounded JSON with exact IDs', () => {
  const text = '🦀\n"\\\u0001'.repeat(5000);
  const ids = Array.from({ length: 32 }, (_, i) => `instance-${i}-${'x'.repeat(110)}`);
  const review = { ...failed, summary: text, issues: Array.from({ length: 12 }, () => ({ message: text, suggestion: text, instanceIds: ids })) };
  const json = savedFailedReviewContext([record(review)])!;
  assert.ok(Buffer.byteLength(json, 'utf8') <= MAX_SAVED_REVIEW_BYTES);
  const parsed = JSON.parse(json);
  assert.equal(parsed.issues.length, 8);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.summary.length > 0);
  for (const issue of parsed.issues) {
    assert.ok(issue.message.length > 0);
    assert.ok((issue.instanceIds ?? []).every((id: string) => ids.includes(id)));
  }
});

test('a real follow-up sees the last veto but must run fresh native checks and receive a new review', async () => {
  const definition = TestSpec.parse({ kind: 'motion', id: 'support_test', duration_s: .2,
    measure: { base: 'support' }, criteria: { maxBaseTilt_deg: 1 } });
  const parent = VersionRecord.parse({
    id: 'parent', inventionId: 'review-context', parentVersionId: null, iteration: 1,
    prompt: 'Build a grounded support.', spec: baseSpec('Build a grounded support.'),
    assembly: applyOps(emptyAssembly(), [{ op: 'place', id: 'support', part: 'beam-50', position: [0, .005, 0], anchored: true }], getPart).assembly,
    tests: [], testDefinitions: [definition], decisions: [], toolLog: [record({ ...failed, summary: 'Obsolete issue' }), record()],
    modelId: 'muse-spark-1.3', status: 'failed', createdAt: '2026-01-01',
  });
  const before = structuredClone(parent);
  const requests: { messages: { role: string; content: string; tool_call_id?: string }[]; tools?: unknown[] }[] = [];
  let builder = 0, reviews = 0;
  const rounds = [
    [['premature', 'finalize_design', { status: 'passed', summary: 'Prior hints are sufficient.' }]],
    [['define', 'define_test', { test: definition }], ['run', 'run_test', { test_id: definition.id }], ['finish', 'finalize_design', { status: 'passed', summary: 'Fresh test finished.' }]],
    [['stop', 'finalize_design', { status: 'failed', summary: 'The fresh review requires more work.' }]],
  ] as const;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    res.setHeader('content-type', 'application/json');
    if (!body.tools?.length) {
      reviews++;
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        passed: false, summary: 'Fresh independent veto.', issues: [{ message: 'A current brief gap remains.', instanceIds: ['support'] }],
      }) } }] })); return;
    }
    const calls = rounds[builder++];
    if (!calls) { res.writeHead(400).end(); return; }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
      tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
    } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const events: AgentEvent[] = [];
    const result = await runAgent({ prompt: parent.prompt, inventionId: parent.inventionId, parent,
      changeRequest: 'Finish the saved design.', startIteration: 1, newVersionId: () => 'follow-up',
      model: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 512, timeoutMs: 3000 },
      specialist: null,
    }, (event) => events.push(structuredClone(event)));
    const prompt = requests[0].messages[0].content;
    assert.match(prompt, /historical repair hints only/);
    assert.match(prompt, /Fresh native checks and a fresh independent review are still required/);
    assert.match(prompt, /Latest support gap needs repair/);
    assert.doesNotMatch(prompt, /Obsolete issue/);
    const line = prompt.split('\n').find((line) => line.startsWith('Latest saved independent review failure'))!;
    assert.deepEqual(JSON.parse(line.slice(line.indexOf(': ') + 2)).issues, failed.issues);
    const reply = requests[1].messages.find(({ tool_call_id }) => tool_call_id === 'premature')!;
    assert.match(JSON.parse(reply.content).error, /No simulation test has run/);
    assert.equal(events.filter((event) => event.type === 'test_start').length, 1);
    assert.equal(reviews, 1);
    assert.equal(result.status, 'failed', 'historical hints cannot waive the new independent veto');
    assert.ok(events.some((event) => event.type === 'tool' && event.entry.tool === 'review_design' && !event.entry.ok));
    assert.deepEqual(parent, before);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

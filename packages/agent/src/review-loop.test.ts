import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { runAgent, type AgentEvent } from './index.ts';

type Call = [id: string, name: string, args: unknown];
type Request = {
  model: string;
  messages: { role: string; content?: string; tool_call_id?: string }[];
  tools?: unknown[];
};

const brief = 'Build a spinning spoked wheel on a grounded stand with a separate grounded display foot.';
const definition = {
  kind: 'motion', id: 'spin_check', duration_s: 1,
  measure: { joints: ['spin'] },
  criteria: { minJointRate_rad_s: 0.2, torqueWithinRating: true },
};
const setup: Call[] = [
  ['assembly', 'assemble', { rationale: 'Mount a wheel on the stand.', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub',
      joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] }],
  ['drive', 'set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.2, profile: { kind: 'constant', value: 2 } }] }],
];
const runSpin = (id: string): Call => [id, 'run_test', { test_id: definition.id }];
const finish = (id: string, status = 'passed'): Call => [id, 'finalize_design', { status, summary: 'Finished the wheel demonstration.' }];
const start: Call[] = [...setup, ['define', 'define_test', { test: definition }], runSpin('run-original'), finish('submit-original')];
const rejected = {
  passed: false, summary: 'The display foot is missing.',
  issues: [{ message: 'The brief requests a separate display foot. The placed design only contains the tower and wheel.',
    instanceIds: ['tower'], suggestion: 'Add a separate grounded display foot and rerun spin_check.' }],
};
const approved = { passed: true, summary: 'Wheel motion and grounded display foot verified.', issues: [] };
const usage = { prompt_tokens: 432, completion_tokens: 21, total_tokens: 453 };

async function scriptedBuild(builderReplies: Call[][], reviewerReplies: string[]) {
  const requests: { builders: Request[]; reviewers: Request[]; order: string[] } = { builders: [], reviewers: [], order: [] };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Request;
    const isBuilder = Boolean(body.tools?.length);
    const group = isBuilder ? requests.builders : requests.reviewers;
    const reply = (isBuilder ? builderReplies : reviewerReplies)[group.length];
    group.push(body);
    requests.order.push(isBuilder ? 'build' : 'review');
    if (reply === undefined) {
      response.writeHead(400);
      response.end('Unexpected model request');
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (typeof reply === 'string') {
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: reply } }], usage }));
    } else {
      response.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
        tool_calls: reply.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
      } }] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    const events: AgentEvent[] = [];
    let nextVersion = 0;
    const result = await runAgent({
      prompt: brief, inventionId: 'inv_review_loop', newVersionId: () => `review-v${++nextVersion}`,
      model: { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 500, timeoutMs: 3000 },
      specialist: null, maxIterations: 1,
    }, (event) => events.push(structuredClone(event)));
    return { result, requests, events };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function toolReply(request: Request, id: string) {
  const reply = request.messages.find((message) => message.tool_call_id === id)?.content;
  assert.ok(reply, `model received the response to ${id}`);
  return JSON.parse(reply);
}

test('native success waits for review, caches a veto and finalizes a repaired and retested design', async () => {
  const { result, requests, events } = await scriptedBuild([
    start,
    [finish('repeat-original')],
    [['foot', 'assemble', { rationale: 'Ground the requested display foot.', ops: [
      { op: 'place', id: 'display_foot', part: 'beam-100', position: [0.35, 0.005, 0], anchored: true },
    ] }], runSpin('run-repaired'), finish('submit-repaired')],
  ], [JSON.stringify(rejected), JSON.stringify(approved)]);

  assert.equal(result.status, 'passed', result.summary);
  assert.deepEqual(requests.order, ['build', 'review', 'build', 'build', 'review']);
  assert.ok(requests.reviewers.every(({ model, tools }) => model === 'muse-spark-1.3' && !tools?.length));
  assert.equal(toolReply(requests.builders[1], 'submit-original').designReview.passed, false);
  assert.deepEqual(toolReply(requests.builders[2], 'repeat-original').designReview.issues, rejected.issues);

  const evidence = requests.reviewers.map(({ messages }) => JSON.parse(messages[1].content!));
  assert.ok(evidence.every((review) => review.originalBrief === brief && review.tests.length === 1 && review.tests[0].passed));
  assert.deepEqual(evidence[0].testDefinitions, evidence[1].testDefinitions);
  assert.deepEqual(evidence[0].instances.map(({ id }: { id: string }) => id), ['tower', 'wheel']);
  assert.deepEqual(evidence[1].instances.map(({ id }: { id: string }) => id), ['tower', 'wheel', 'display_foot']);

  const reviews = events.flatMap((event) => event.type === 'tool' && event.entry.tool === 'review_design' ? [event.entry] : []);
  assert.deepEqual(reviews.map(({ ok, args }) => [ok, (args as { cached: boolean }).cached]), [[false, false], [false, true], [true, false]]);
  assert.equal(events.filter((event) => event.type === 'test_start').length, 2);
  assert.equal(events.filter((event) => event.type === 'status' && event.message.includes('is reviewing the complete design')).length, 2);
  assert.equal(events.filter((event) => event.type === 'model_timing' && event.inputTokens === usage.prompt_tokens && event.outputTokens === usage.completion_tokens).length, 2);
  const [before, after] = result.versions;
  assert.equal(result.versions.length, 2);
  assert.equal(after.parentVersionId, before.id);
  assert.ok(before.tests[0].passed && after.tests[0].passed);
  const finalVersion = events.filter((event) => event.type === 'version').at(-1)?.version;
  assert.equal(finalVersion?.id, after.id);
  assert.ok(finalVersion.toolLog.some(({ tool, ok, summary }) => tool === 'review_design' && ok && summary === approved.summary));
  assert.equal(events.filter((event) => event.type === 'done').length, 1);
  assert.equal(events.at(-1)?.type, 'done');
});

test('a terminal veto stays in the saved record after native tests passed', async () => {
  const { result, requests, events } = await scriptedBuild([start, [finish('stop', 'failed')]], [JSON.stringify(rejected)]);
  assert.deepEqual(requests.order, ['build', 'review', 'build']);
  assert.equal(result.status, 'failed');
  assert.equal(result.versions.length, 1);
  const saved = events.filter((event) => event.type === 'version').at(-1)?.version;
  assert.ok(saved?.tests[0].passed);
  assert.ok(saved.toolLog.some(({ tool, ok, summary }) => tool === 'review_design' && !ok && summary === rejected.summary));
});

test('a native failure blocks finalization before any model review', async () => {
  const impossible = { ...definition, criteria: { minRevolutions: 5, torqueWithinRating: true } };
  const { result, requests, events } = await scriptedBuild([
    [...setup, ['define', 'define_test', { test: impossible }], runSpin('run-native-failure'), finish('submit-native-failure')],
    [finish('stop', 'failed')],
  ], []);
  assert.deepEqual(requests.order, ['build', 'build']);
  assert.equal(result.status, 'failed');
  assert.equal(result.versions[0].tests[0].passed, false);
  assert.match(toolReply(requests.builders[1], 'submit-native-failure').error, /latest test failed/);
  assert.ok(!events.some((event) => event.type === 'tool' && event.entry.tool === 'review_design'));
});

test('a malformed review may be retried on the same evidence', async () => {
  const { result, requests, events } = await scriptedBuild([
    start, [finish('retry-review')],
  ], ['not a verdict', JSON.stringify(approved)]);
  assert.deepEqual(requests.order, ['build', 'review', 'build', 'review']);
  assert.equal(result.status, 'passed', result.summary);
  assert.equal(events.filter((event) => event.type === 'test_start').length, 1);
  const failedReview = toolReply(requests.builders[1], 'submit-original').designReview;
  assert.equal(failedReview.passed, false);
  assert.equal(failedReview.retryable, true);
});

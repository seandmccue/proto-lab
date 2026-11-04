import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { TestSpec } from '@protolab/schema';
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

async function scriptedBuild(builderReplies: Call[][], reviewerReplies: string[], options: { maxIterations?: number } = { maxIterations: 1 }) {
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
      specialist: null, ...options,
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
  assert.ok(evidence.every((review) => review.clearanceObservations.length === 1 && review.clearanceObservations[0].complete));

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

test('a native pass with an omitted wheel-to-brace collision reaches the independent review as measured evidence', async () => {
  const collision = { passed: false, summary: 'The extra brace intersects the spinning wheel.', issues: [{
    message: 'The complete-machine observation reports wheel-to-brace penetration that the rotation-only test omitted.',
    instanceIds: ['wheel', 'brace'], suggestion: 'Repair the brace and explicitly test its clearance.',
  }] };
  const { result, requests, events } = await scriptedBuild([
    [...setup, ['brace', 'assemble', { rationale: 'Fit a grounded axle brace.', ops: [
      { op: 'mount', id: 'brace', part: 'beam-100', onto: 'tower', connector: 'axle', via: 'end_a', joint: 'fixed' },
    ] }], ['define', 'define_test', { test: definition }], runSpin('run-overlap'), finish('submit-overlap')],
    [finish('stop', 'failed')],
  ], [JSON.stringify(collision)]);
  assert.equal(result.status, 'failed');
  assert.ok(result.versions[0].tests[0].passed, 'the saved native result stays truthful');
  const evidence = JSON.parse(requests.reviewers[0].messages[1].content!);
  const observation = evidence.clearanceObservations[0];
  const early = toolReply(requests.builders[1], 'run-overlap');
  assert.equal(early.passed, true);
  assert.equal(early.assemblyClearance.diagnosticOnly, true);
  assert.deepEqual(early.assemblyClearance.issues, observation.issues);
  assert.equal(early.assemblyClearance.pairsChecked, observation.pairsChecked);
  assert.equal(early.assemblyClearance.samplesChecked, observation.samplesChecked);
  assert.ok(observation.complete && observation.samplesChecked > 1);
  assert.ok(observation.issues.some(({ firstId, secondId, penetration_m }: { firstId: string; secondId: string; penetration_m: number }) =>
    new Set([firstId, secondId]).has('wheel') && new Set([firstId, secondId]).has('brace') && penetration_m > 0.001));
  const saved = events.filter((event) => event.type === 'version').at(-1)!.version;
  assert.ok(saved.toolLog.some(({ tool }) => tool === 'review_clearance'));
  assert.ok(saved.toolLog.some(({ tool, ok }) => tool === 'review_design' && !ok));
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

const ratedWheelSetup: Call[] = [
  ['assembly', 'assemble', { rationale: 'Mount a rated wheel drive, its rim marker and a grounded clearance reference.', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'motor', part: 'gearmotor-37', onto: 'tower', connector: 'axle', via: 'mount', joint: 'fixed' },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'motor', connector: 'shaft', via: 'hub',
      joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    { op: 'mount', id: 'rim_marker', part: 'shaft-3x60', onto: 'wheel', connector: 'rim_0', via: 'end_a', joint: 'fixed' },
    { op: 'place', id: 'clearance_reference', part: 'beam-100', position: [0.35, 0.05, 0], rotation_deg: [0, 0, 90], anchored: true },
  ] }],
  setup[1],
];
const mandatoryChecks = [
  { id: 'wheel_turns', measure: { joints: ['spin'] }, criteria: { minRevolutions: 0.1 } },
  { id: 'rim_path', measure: { orbits: [{ body: 'rim_marker', center: 'wheel', plane: 'xy', minTurns: 0.1, minRadius_m: 0.19, maxRadius_m: 0.21 }] } },
  { id: 'stand_stability', measure: { base: 'tower' }, criteria: { maxBaseTilt_deg: 1, maxBaseDrift_m: 0.001 } },
  { id: 'ground_clearance', measure: { noGroundContact: ['motor', 'wheel', 'rim_marker'] } },
  { id: 'moving_clearance', measure: { clearancePairs: [['wheel', 'clearance_reference']] } },
  { id: 'rated_load', measure: { joints: ['spin'] }, criteria: { torqueWithinRating: true } },
].map((check) => TestSpec.parse({ kind: 'motion', duration_s: 1, ...check }));
const runCheck = (definition: TestSpec, prefix: string): Call => [`${prefix}-${definition.id}`, 'run_test', { test_id: definition.id }];

test('a review-requested geometry repair reruns the entire unchanged mandatory suite beyond nine native tests', async () => {
  const weakened = TestSpec.parse({ ...mandatoryChecks[0], criteria: { minRevolutions: 0.01, torqueWithinRating: true } });
  const missingFoot = { passed: false, summary: 'The display foot is missing.', issues: [{
    message: 'The separate upright is a clearance post; the requested horizontal display foot is missing.',
    instanceIds: ['clearance_reference'], suggestion: 'Add the grounded display foot and rerun the original checks.',
  }] };
  const { result, requests, events } = await scriptedBuild([
    [...ratedWheelSetup,
      ...mandatoryChecks.map((check): Call => [`define-${check.id}`, 'define_test', { test: check }]),
      ...mandatoryChecks.map((check) => runCheck(check, 'original')), finish('submit-original')],
    [['foot', 'assemble', { rationale: 'Add the grounded display foot requested by the reviewer.', ops: [
      { op: 'place', id: 'display_foot', part: 'beam-100', position: [-0.35, 0.005, 0], anchored: true },
    ] }],
    ...mandatoryChecks.slice(0, 3).map((check) => runCheck(check, 'repaired')), finish('submit-partial-retest'),
    ['weaken-target', 'define_test', { test: weakened }]],
    [...mandatoryChecks.slice(3).map((check) => runCheck(check, 'repaired')), finish('submit-full-retest')],
  ], [JSON.stringify(missingFoot), JSON.stringify(approved)], {});

  assert.equal(result.status, 'passed', [result.summary, ...events.flatMap((event) =>
    event.type === 'tool' && !event.entry.ok ? [event.entry.summary] : [])].join('\n'));
  assert.deepEqual(requests.order, ['build', 'review', 'build', 'build', 'review']);
  assert.match(toolReply(requests.builders[2], 'weaken-target').error, /fixed when comparing revisions/);
  const premature = toolReply(requests.builders[2], 'submit-partial-retest');
  for (const check of mandatoryChecks.slice(3)) {
    assert.ok(premature.error.includes(`${check.id}: assembly geometry changed`), `${check.id} must require a fresh run`);
  }
  const nativeRuns = events.flatMap((event) => event.type === 'test' ? [event.result] : []);
  assert.equal(nativeRuns.length, 12);
  assert.equal(events.filter((event) => event.type === 'test_start').length, 12);
  assert.ok(nativeRuns.every((run) => run.passed));
  assert.deepEqual(nativeRuns.map(({ testId }) => testId), [
    ...mandatoryChecks.map(({ id }) => `${id}#1`), ...mandatoryChecks.map(({ id }) => `${id}#2`),
  ]);
  const evidence = requests.reviewers.map(({ messages }) => JSON.parse(messages[1].content!));
  assert.deepEqual(evidence[0].testDefinitions, mandatoryChecks);
  assert.deepEqual(evidence[1].testDefinitions, mandatoryChecks);
  assert.deepEqual(evidence[0].tests.map(({ testId }: { testId: string }) => testId), mandatoryChecks.map(({ id }) => `${id}#1`));
  assert.deepEqual(evidence[1].tests.map(({ testId }: { testId: string }) => testId), mandatoryChecks.map(({ id }) => `${id}#2`));
  assert.ok(!evidence[0].instances.some(({ id }: { id: string }) => id === 'display_foot'));
  assert.ok(evidence[1].instances.some(({ id }: { id: string }) => id === 'display_foot'));
  assert.equal(result.versions.length, 2);
  assert.equal(result.versions[1].parentVersionId, result.versions[0].id);
  assert.ok(result.versions.every(({ tests, testDefinitions }) => tests.length === 6
    && tests.every(({ passed }) => passed) && JSON.stringify(testDefinitions) === JSON.stringify(mandatoryChecks)));
  assert.ok(!events.some((event) => event.type === 'tool' && !event.entry.ok && event.entry.summary.includes('Test budget')));
});

test('the larger native allowance remains bounded and rejects the next run without fabricating evidence', async () => {
  const { result, requests, events } = await scriptedBuild([
    [...ratedWheelSetup, ['foot', 'assemble', { rationale: 'Ground the requested display foot.', ops: [
      { op: 'place', id: 'display_foot', part: 'beam-100', position: [-0.35, 0.005, 0], anchored: true },
    ] }], ['define', 'define_test', { test: definition }],
      ...Array.from({ length: 15 }, (_, index) => runSpin(`attempt-${index + 1}`))],
    [finish('submit-measured-result')],
  ], [JSON.stringify(approved)], {});
  assert.match(toolReply(requests.builders[1], 'attempt-15').error, /Test budget \(14\) exhausted/);
  const tests = events.flatMap((event) => event.type === 'test' ? [event.result] : []);
  assert.equal(tests.length, 14);
  assert.equal(events.filter((event) => event.type === 'test_start').length, 14);
  assert.ok(tests.every(({ passed }) => passed));
  assert.deepEqual(tests.map(({ testId }) => testId), Array.from({ length: 14 }, (_, index) => `${definition.id}#${index + 1}`));
  assert.equal(result.status, 'passed', result.summary);
  assert.equal(result.versions[0].tests.length, 14);
  const evidence = JSON.parse(requests.reviewers[0].messages[1].content!);
  assert.deepEqual(evidence.tests.map(({ testId }: { testId: string }) => testId), [`${definition.id}#14`]);
});

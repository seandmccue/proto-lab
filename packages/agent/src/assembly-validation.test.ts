import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { TestSpec, type TestResult, type Vec3 } from '@protolab/schema';
import { auditSampledRotorClearance, runTest } from '@protolab/simulator';
import { runAgent, type AgentEvent } from './index.ts';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

const testId = 'integrity_spin';
const spinCheck = {
  kind: 'motion', id: testId, duration_s: 4,
  measure: { joints: ['spin'], noGroundContact: ['rotor'] },
  criteria: { minRevolutions: 2, torqueWithinRating: true },
};
const buildRotor = {
  rationale: 'Build a rotor with a motor on a grounded tower.',
  ops: [
    { op: 'place', id: 'tower', part: 'tower-150', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'motor', part: 'gearmotor-37', onto: 'tower', connector: 'top', via: 'flange', joint: 'fixed' },
    { op: 'mount', id: 'rotor', part: 'propeller-3x200', onto: 'motor', connector: 'shaft', via: 'shaft', joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.3, damping: 0.1 } },
  ],
};
const floatingTrim = {
  rationale: 'Add the cowl edge and its trim strip.',
  ops: [
    { op: 'place', id: 'cowl', part: 'beam-50', position: [0.36, 0.325, 0], anchored: true },
    { op: 'place', id: 'trim', part: 'beam-50', position: [0.36, 0.325, 0.03] },
  ],
};
const supportedTrim = {
  rationale: 'Ground an upright support, mount the cowl to its top and attach the trim to the cowl.',
  ops: [
    { op: 'place', id: 'support', part: 'beam-300', position: [0.36, 0.15, 0], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'mount', id: 'cowl', part: 'beam-50', onto: 'support', connector: 'end_b', via: 'end_a', joint: 'fixed' },
    { op: 'mount', id: 'trim', part: 'beam-50', onto: 'cowl', connector: 'side_a', via: 'side_b', joint: 'fixed' },
  ],
};
const drive = { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 6 } }] };
const testRequest = { test_id: testId };
const finalize = { status: 'passed', summary: 'The mounted rotor passed its original rotation and clearance targets.' };

interface AssemblyChecks {
  passed: boolean;
  issues: { kind: string; instanceIds: string[] }[];
}

function assertUnsupportedTrim(checks: AssemblyChecks) {
  assert.equal(checks.passed, false);
  assert(checks.issues.some(issue => issue.kind === 'unsupported_anchor' && issue.instanceIds.includes('cowl')));
  assert(checks.issues.some(issue => issue.kind === 'detached_part' && issue.instanceIds.includes('trim')));
}

type ModelCall = [id: string, name: string, args: unknown];
type ModelMessage = { role: string; content?: string; tool_call_id?: string };

async function runScriptedBuild(prompt: string, replies: ModelCall[][]) {
  const requests: ModelMessage[][] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as { messages: ModelMessage[] };
    const reply = replies[requests.length] ?? [];
    requests.push(request.messages);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{
      message: { content: null, tool_calls: reply.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
      finish_reason: 'tool_calls',
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    const events: AgentEvent[] = [];
    let sequence = 0;
    const result = await runAgent({
      prompt, inventionId: 'inv_integrity',
      model: { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 256, timeoutMs: 5000 },
      specialist: null, maxIterations: 1, newVersionId: () => `ver_integrity_${++sequence}`,
    }, event => events.push(event));
    return { result, requests, events };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('preflight preserves the simulation budget and measured test definitions across structural repairs', async () => {
  const recorded: TestResult[] = [];
  let starts = 0;
  const clearanceCheck = {
    ...spinCheck, id: 'rotor_clearance',
    measure: { ...spinCheck.measure, clearancePairs: [['rotor', 'tower']] },
  };
  const rt = new ToolRuntime(baseSpec('A rotor with a fixed cowl'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTestStart() { starts++; },
    onTest(result) { recorded.push(result); },
  }, { maxTests: 4, maxToolCalls: 24 });
  for (const [name, args] of [
    ['assemble', buildRotor], ['set_drives', drive], ['define_test', { test: spinCheck }],
    ['define_test', { test: clearanceCheck }],
  ] as const) {
    const response = await rt.call(name, structuredClone(args)) as { error?: string };
    assert.equal(response.error, undefined, response.error);
  }
  const original = await rt.call('run_test', testRequest) as { passed: boolean };
  assert.equal(original.passed, true);
  const originalClearance = await rt.call('run_test', { test_id: clearanceCheck.id }) as { passed: boolean };
  assert.equal(originalClearance.passed, true);
  assert.equal(recorded.length, 2);
  const savedEvidence = structuredClone(recorded);
  const weakened = await rt.call('define_test', { test: {
    ...clearanceCheck, measure: { joints: ['spin'] },
  } }) as { error: string };
  assert.match(weakened.error, /fixed when comparing revisions/);
  assert.deepEqual(rt.testSpecs.get(clearanceCheck.id), TestSpec.parse(clearanceCheck));

  const added = await rt.call('assemble', structuredClone(floatingTrim)) as { error?: string };
  assert.equal(added.error, undefined, added.error);
  const draft = structuredClone(rt.assembly);
  assertUnsupportedTrim(await rt.call('validate_assembly', {}) as AssemblyChecks);
  assert.deepEqual(rt.assembly, draft, 'validation must leave the draft editable');

  for (const [name, args] of [
    ['run_test', testRequest],
    ['sweep_drive', { ...testRequest, controlId: 'spin', field: 'value', values: [5, 6] }],
    ['finalize_design', finalize],
  ] as const) {
    const blocked = await rt.call(name, args) as { error: string; assemblyChecks: AssemblyChecks };
    assert.equal(typeof blocked.error, 'string');
    assertUnsupportedTrim(blocked.assemblyChecks);
  }
  assert.equal(rt.testCount, 2);
  assert.equal(rt.sweeps, 0);
  assert.equal(starts, 2);
  assert.deepEqual(recorded, savedEvidence);
  assert.deepEqual(rt.tests, savedEvidence);
  assert.equal(rt.finalized, null);

  const repaired = await rt.call('assemble', structuredClone(supportedTrim)) as { error?: string };
  assert.equal(repaired.error, undefined, repaired.error);
  const clear = await rt.call('validate_assembly', {}) as AssemblyChecks;
  assert.equal(clear.passed, true);
  assert.deepEqual(clear.issues, []);
  const rerun = await rt.call('run_test', testRequest) as { passed: boolean; testId: string };
  assert.equal(rerun.passed, true);
  assert.equal(rerun.testId, `${testId}#2`);
  assert.deepEqual(rt.testSpecs.get(testId), TestSpec.parse(spinCheck));
  const stale = await rt.call('finalize_design', finalize) as { error: string };
  assert.match(stale.error, /rotor_clearance: assembly geometry changed; rerun the original test/);
  const rerunClearance = await rt.call('run_test', { test_id: clearanceCheck.id }) as { passed: boolean; testId: string };
  assert.equal(rerunClearance.passed, true);
  assert.equal(rerunClearance.testId, `${clearanceCheck.id}#2`);
  assert.deepEqual(recorded.slice(0, 2), savedEvidence);
  assert.equal(starts, 4);
  assert.deepEqual(await rt.call('finalize_design', finalize), { ok: true });
});

test('Muse repairs a blocked revision in the same build and keeps its earlier passing version', async () => {
  const { result, requests, events } = await runScriptedBuild('Build and test a rotor with a visible, attached cowl and trim.', [
    [
      ['build', 'assemble', buildRotor],
      ['drive', 'set_drives', drive], ['definition', 'define_test', { test: spinCheck }],
      ['first-run', 'run_test', testRequest],
    ],
    [
      ['loose-parts', 'assemble', floatingTrim], ['blocked', 'run_test', testRequest],
    ],
    [
      ['repair', 'assemble', supportedTrim], ['run', 'run_test', testRequest], ['finish', 'finalize_design', finalize],
    ],
  ]);

  assert.equal(result.status, 'passed', result.summary);
  assert.equal(requests.length, 3);
  const feedback = requests[2].find(message => message.role === 'tool' && message.tool_call_id === 'blocked');
  assert(feedback?.content, 'Muse must receive the reason for the blocked test');
  assertUnsupportedTrim(JSON.parse(feedback.content).assemblyChecks);
  assert.equal(events.filter(event => event.type === 'test_start').length, 2);
  assert.equal(events.filter(event => event.type === 'version').length, 2);
  assert.equal(result.versions.length, 2);
  const [original, version] = result.versions;
  assert.equal(original.status, 'passed');
  assert.equal(original.iteration, 1);
  assert.deepEqual(original.assembly.instances.map(part => part.id), ['tower', 'motor', 'rotor']);
  assert.deepEqual(original.tests.map(check => [check.testId, check.passed]), [[`${testId}#1`, true]]);
  assert.equal(version.status, 'passed');
  assert.equal(version.iteration, 2);
  assert.equal(version.parentVersionId, original.id);
  assert.deepEqual(original.testDefinitions, [TestSpec.parse(spinCheck)]);
  assert.deepEqual(version.testDefinitions, [TestSpec.parse(spinCheck)]);
  assert.deepEqual(version.tests.map(check => [check.testId, check.passed]), [[`${testId}#2`, true]]);
  assert(version.tests[0].trace.frames.length > 1);
  assert(version.toolLog.some(entry => entry.tool === 'run_test' && !entry.ok), 'keep the blocked attempt in the build log');
  for (const id of ['cowl', 'trim']) {
    assert.equal(version.assembly.instances.find(part => part.id === id)?.anchored, false);
    assert(version.assembly.joints.some(joint => joint.type === 'fixed' && joint.b.instanceId === id));
  }
});

test('inherited test targets stay fixed while a new behavior can be tested separately', async () => {
  const events = { onLog() {}, onPlan() {}, onAssembly() {}, onTest() {} };
  const initial = new ToolRuntime(baseSpec('A grounded rotor'), events);
  for (const [name, args] of [['assemble', buildRotor], ['set_drives', drive]] as const) {
    const result = await initial.call(name, structuredClone(args)) as { error?: string };
    assert.equal(result.error, undefined, result.error);
  }
  const inherited = TestSpec.parse(spinCheck);
  const resumed = new ToolRuntime(initial.spec, events, undefined, initial.assembly, [inherited]);
  const weakened = await resumed.call('define_test', {
    test: { ...spinCheck, measure: { joints: ['spin'] } },
  }) as { error: string };
  assert.match(weakened.error, /fixed when comparing revisions/);
  assert.equal(resumed.testSpecs.size, 0);

  const next = { ...spinCheck, id: 'new_behavior', criteria: { ...spinCheck.criteria, minRevolutions: 3 } };
  const defined = await resumed.call('define_test', { test: next }) as { error?: string };
  assert.equal(defined.error, undefined, defined.error);
  const result = await resumed.call('run_test', { test_id: next.id }) as { passed: boolean };
  assert.equal(result.passed, true);
  assert.deepEqual(resumed.pendingChecks(), [], 'reference tests stay out of the pending queue');

  const unchanged = await resumed.call('define_test', { test: structuredClone(inherited) }) as { error?: string };
  assert.equal(unchanged.error, undefined, unchanged.error);
  assert.deepEqual(resumed.pendingChecks(), [`${testId}: current criteria have not been tested`]);
});

test('automatic ground checks observe elevated parts of a floor-seated unanchored rotor', async () => {
  const rt = new ToolRuntime(baseSpec('A floor-seated rotor and a loose payload'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTest() {},
  });
  const definition = TestSpec.parse({
    ...spinCheck, id: 'free_standing_spin', measure: { joints: ['spin'], base: 'tower' },
  });
  for (const [name, args] of [
    ['assemble', {
      ...buildRotor,
      ops: [
        ...buildRotor.ops.map(op => op.id === 'tower' ? { ...op, anchored: false } : op),
        { op: 'place', id: 'payload', part: 'wood-marble-24', position: [0.65, 0.2, 0.4], free: true },
      ],
    }],
    ['set_drives', drive], ['define_test', { test: definition }],
  ] as const) {
    const result = await rt.call(name, structuredClone(args)) as { error?: string };
    assert.equal(result.error, undefined, result.error);
  }
  assert(rt.assembly.instances.every(instance => !instance.anchored));
  const original = await runTest(rt.assembly, { env: rt.spec.environment, test: definition });
  assert.equal(original.passed, true);

  const checked = await rt.call('run_test', { test_id: definition.id }) as { passed: boolean; failureReasons: string[] };
  assert.equal(checked.passed, true, JSON.stringify(checked.failureReasons));
  const [recorded] = rt.tests;
  assert.deepEqual(rt.testSpecs.get(definition.id), definition);
  assert.deepEqual(recorded.trace, original.trace);
  assert.deepEqual(recorded.metrics, {
    ...original.metrics, automaticGroundContactChecks: 2, automaticGroundContactViolation: 0,
    assemblyIntegrityIssues: 0, disconnectedGeometryParts: 0,
    sampledRotorClearancePairs: 1, sampledRotorClearanceFrames: original.trace.frames.length,
    sampledRotorClearanceViolations: 0, sampledRotorClearanceComplete: 1,
  });
  assert(recorded.trace.frames.at(-1)!.bodies.payload.position[1] < 0.02, 'the loose marble reaches the floor without failing the rotor check');
});

test('sampled rotor clearance blocks a false pass and Muse repairs the same measured target', async () => {
  const box = (position: Vec3, size: Vec3) => ({
    shape: { kind: 'box', size }, offset: { position, rotation: [0, 0, 0, 1] }, role: 'structure', collide: true,
  });
  const statorBrace = (reach: number) => ({
    name: 'Stator brace', category: 'brackets',
    pieces: [box([0, 0, 0.028], [0.012, 0.016, 0.056]), box([reach / 2, 0, 0.054], [reach, 0.014, 0.012])],
    connectors: [{ id: 'seat', position: [0, 0, 0], axis: [1, 0, 0], kind: 'fixed' }],
  });
  const mountStator = (part: string) => ({
    op: 'mount', id: 'stator', part, onto: 'motor', connector: 'mount', via: 'seat', joint: 'fixed',
  });
  const { result, requests } = await runScriptedBuild('Test a rotor and its stationary brace.', [
    [
      ['design-brace', 'design_part', statorBrace(0.136)],
      ['assemble', 'assemble', { ...buildRotor, ops: [...buildRotor.ops, mountStator('designed-1')] }],
      ['drive', 'set_drives', drive], ['definition', 'define_test', { test: spinCheck }],
      ['spin-overlap', 'run_test', testRequest], ['premature-finalize', 'finalize_design', finalize],
    ],
    [
      ['shorten-brace', 'design_part', statorBrace(0.09)],
      ['remount', 'assemble', { rationale: 'Shorten the supported brace to clear the blades.', ops: [mountStator('designed-2')] }],
      ['spin-clear', 'run_test', testRequest], ['finish', 'finalize_design', finalize],
    ],
  ]);

  assert.equal(result.status, 'passed', result.summary);
  assert.equal(requests.length, 2);
  assert.equal(result.versions.length, 2);
  const [overlap, repaired] = result.versions;
  assert.equal(overlap.status, 'failed');
  assert.equal(repaired.status, 'passed');
  assert.equal(repaired.parentVersionId, overlap.id);
  const definition = TestSpec.parse(spinCheck);
  assert.deepEqual(overlap.testDefinitions, [definition]);
  assert.deepEqual(repaired.testDefinitions, [definition]);
  assert.deepEqual(repaired.assembly.instances.map(({ id }) => id), ['tower', 'motor', 'rotor', 'stator']);

  const native = await runTest(overlap.assembly, { env: overlap.spec.environment, test: definition });
  const [observed] = overlap.tests;
  assert.equal(native.passed, true, 'the authored motion test omits the interfering brace');
  assert.equal(observed.passed, false);
  assert.deepEqual(observed.trace, native.trace);
  assert.equal(observed.metrics['spin.revolutions'], native.metrics['spin.revolutions']);
  assert.equal(observed.metrics.clearanceViolation, 0);
  const clearance = await auditSampledRotorClearance(overlap.assembly, native.trace);
  assert.equal(clearance.complete, true);
  assert.equal(clearance.issues.length, 1);
  const [collision] = clearance.issues;
  assert.equal(collision.rotorId, 'rotor');
  assert.equal(collision.obstacleId, 'stator');
  assert(collision.time_s > 0);
  assert(collision.penetration_m > 0.005);
  assert.equal(observed.metrics.sampledRotorClearancePairs, 2);
  assert.equal(observed.metrics.sampledRotorClearanceFrames, native.trace.frames.length);
  assert.equal(observed.metrics.sampledRotorClearanceViolations, 1);
  assert.equal(observed.metrics.sampledRotorClearanceComplete, 1);
  const diagnosis = `rotor intersects stator by ${(collision.penetration_m * 1000).toFixed(2)} mm at ${collision.time_s.toFixed(3)} s`;
  assert(observed.failureReasons.some(reason => reason.includes(diagnosis)));
  const feedback = requests[1].find(message => message.tool_call_id === 'spin-overlap');
  const rejected = requests[1].find(message => message.tool_call_id === 'premature-finalize');
  assert(feedback?.content && rejected?.content);
  assert.deepEqual(JSON.parse(feedback.content).failureReasons, observed.failureReasons);
  assert.match(JSON.parse(rejected.content).error, /latest test failed/);

  const [verified] = repaired.tests;
  assert.equal(verified.testId, `${testId}#2`);
  assert.equal(verified.passed, true);
  assert.equal(verified.metrics.sampledRotorClearancePairs, 2);
  assert.equal(verified.metrics.sampledRotorClearanceFrames, native.trace.frames.length);
  assert.equal(verified.metrics.sampledRotorClearanceViolations, 0);
  assert.equal(verified.metrics.sampledRotorClearanceComplete, 1);
});

test('a rotor requires a quantified motion test before finalization', async () => {
  const rt = new ToolRuntime(baseSpec('Verify two rotor turns in four seconds and rated load'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTest() {},
  });
  const loadCheck = { ...spinCheck, id: 'rated_load', criteria: { torqueWithinRating: true } };
  for (const [name, args] of [
    ['assemble', buildRotor], ['set_drives', drive], ['define_test', { test: loadCheck }],
  ] as const) {
    const result = await rt.call(name, structuredClone(args)) as { error?: string };
    assert.equal(result.error, undefined, result.error);
  }
  const load = await rt.call('run_test', { test_id: loadCheck.id }) as { passed: boolean; metrics: Record<string, number> };
  assert.equal(load.passed, true);
  assert(load.metrics['spin.revolutions'] >= 2, 'incidental rotation is measured without an authored threshold');
  const savedLoad = structuredClone(rt.tests[0]);
  const blocked = await rt.call('finalize_design', finalize) as { error: string };
  assert.match(blocked.error, /spin: no quantified rotor motion target/);
  assert.match(blocked.error, /Define an additional test/);
  assert.equal(rt.finalized, null);

  const overwrite = await rt.call('define_test', { test: { ...spinCheck, id: loadCheck.id } }) as { error: string };
  assert.match(overwrite.error, /fixed when comparing revisions/);
  const defined = await rt.call('define_test', { test: structuredClone(spinCheck) }) as { error?: string };
  assert.equal(defined.error, undefined, defined.error);
  const untested = await rt.call('finalize_design', finalize) as { error: string };
  assert.match(untested.error, /integrity_spin: current criteria have not been tested/);
  const motion = await rt.call('run_test', testRequest) as { passed: boolean };
  assert.equal(motion.passed, true);
  assert.deepEqual([...rt.testSpecs.values()], [TestSpec.parse(loadCheck), TestSpec.parse(spinCheck)]);
  assert.deepEqual(rt.tests[0], savedLoad);
  assert.deepEqual(rt.tests.map(({ testId }) => testId), [`${loadCheck.id}#1`, `${testId}#1`]);
  assert.deepEqual(await rt.call('finalize_design', finalize), { ok: true });
});

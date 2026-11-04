import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssemblyOp } from '@protolab/parts';
import { TestSpec, type Assembly, type TestResult } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { measurePlanarOrbit, type PlanarOrbit } from '@protolab/simulator/planar-orbit';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

const wheelOps: AssemblyOp[] = [
  { op: 'place', id: 'tower', part: 'tower-500', position: [0, 0, 0], anchored: true },
  { op: 'mount', id: 'motor', part: 'gearmotor-37', onto: 'tower', connector: 'axle', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'motor', connector: 'shaft', via: 'hub', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
];
const markerOps: AssemblyOp[] = [
  // These two origins differ in Z, but coincide in the wheel's XY orbit plane.
  { op: 'mount', id: 'center', part: 'crank-30', onto: 'wheel', connector: 'hub_front', via: 'shaft', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  { op: 'mount', id: 'marker', part: 'shaft-3x60', onto: 'wheel', connector: 'rim_0', via: 'end_a', joint: 'fixed', spin_deg: 0, offset_m: 0 },
];

function runtime(savedAssembly?: Assembly, inheritedDefinitions: TestSpec[] = []) {
  const recorded: TestResult[] = [];
  const started: string[] = [];
  const rt = new ToolRuntime(baseSpec('Verify the wheel marker orbit without weakening its targets.'), {
    onLog() {}, onPlan() {}, onAssembly() {},
    onTestStart(id) { started.push(id); },
    onTest(result) { recorded.push(result); },
  }, { maxTests: 1, maxToolCalls: 40 }, savedAssembly, inheritedDefinitions);
  return { rt, recorded, started };
}

async function callOk(rt: ToolRuntime, name: string, args: unknown) {
  const response = await rt.call(name, structuredClone(args)) as { error?: string };
  assert.equal(response.error, undefined, response.error);
  return response;
}

async function assemble(rt: ToolRuntime, extraOps = markerOps, controls = ['spin']) {
  await callOk(rt, 'assemble', { ops: [...wheelOps, ...extraOps], rationale: 'Mount the wheel and orbit markers on a grounded, rated motor fixture.' });
  await callOk(rt, 'set_drives', { drives: controls.map((controlId) => ({
    controlId, mode: 'velocity', rampIn_s: 0.3, profile: { kind: 'constant', value: 3 },
  })) });
  assert.deepEqual(await rt.call('validate_assembly', {}), { passed: true, issues: [] });
}

function orbitTest(orbit: PlanarOrbit, id = 'wheel_orbit') {
  return TestSpec.parse({
    kind: 'motion', id, duration_s: 4,
    measure: { orbits: [{ ...orbit, minTurns: 1 }] },
    criteria: { torqueWithinRating: true },
  });
}

function assertNoSimulation({ rt, recorded, started }: ReturnType<typeof runtime>) {
  assert.equal(rt.testCount, 0);
  assert.deepEqual(started, []);
  assert.deepEqual(recorded, []);
  assert.deepEqual(rt.tests, []);
  assert.deepEqual(rt.pendingChecks(), ['No simulation test has run']);
}

test('a centered orbit is repairable under the same ID without spending the sole simulation or freezing evidence', async () => {
  const fixture = runtime();
  const { rt, recorded, started } = fixture;
  const original = orbitTest({ body: 'wheel', center: 'center', plane: 'xy' });

  // Muse may define its targets before the referenced parts exist.
  await callOk(rt, 'define_test', { test: original });
  assert.equal(rt.assembly.instances.length, 0);
  await assemble(rt);
  const blocked = await rt.call('run_test', { test_id: original.id }) as { error: string };
  assert.match(blocked.error, /orbit/i);
  assert.match(blocked.error, /marker/i);
  assert.match(blocked.error, /fixed|rigid/i);
  assertNoSimulation(fixture);
  assert.deepEqual(rt.testSpecs.get(original.id), original);

  // Change only the observed point; keep the original duration and turn target.
  const corrected = orbitTest({ body: 'marker', center: 'center', plane: 'xy' }, original.id);
  await callOk(rt, 'define_test', { test: corrected });
  const result = await callOk(rt, 'run_test', { test_id: original.id }) as unknown as TestResult;
  assert.equal(result.passed, true, result.failureReasons?.join('; '));
  assert.equal(result.testId, `${original.id}#1`);
  assert.ok(Math.abs(result.metrics['marker.orbitSignedTurns']) >= 1);
  assert.equal(rt.testCount, 1);
  assert.deepEqual(started, [`${original.id}#1`]);
  assert.equal(recorded.length, 1);
  assert.deepEqual(rt.tests, recorded);
  assert.deepEqual(rt.pendingChecks(), []);

  // The successful native result now protects the measured definition normally.
  const rewrite = await rt.call('define_test', { test: original }) as { error: string };
  assert.match(rewrite.error, /fixed when comparing revisions/);
  assert.deepEqual(rt.testSpecs.get(original.id), corrected);
});

test('missing orbit instances and a reference direction with zero projected length spend no simulation', async (t) => {
  const valid: PlanarOrbit = { body: 'marker', center: 'center', plane: 'xy' };
  const cases: [string, PlanarOrbit][] = [
    ['missing body', { ...valid, body: 'absent_body' }],
    ['missing center', { ...valid, center: 'absent_center' }],
    ['missing reference part', { ...valid, reference: 'absent_reference' }],
    ['missing reference start', { ...valid, reference: { from: 'absent_from', to: 'marker' } }],
    ['missing reference end', { ...valid, reference: { from: 'center', to: 'absent_to' } }],
    // Distinct physical parts are separated in Z, yet have no XY direction.
    ['reference perpendicular to the orbit plane', { ...valid, reference: { from: 'wheel', to: 'center' } }],
  ];
  for (const [name, orbit] of cases) await t.test(name, async () => {
    const fixture = runtime();
    const spec = orbitTest(orbit);
    await callOk(fixture.rt, 'define_test', { test: spec });
    await assemble(fixture.rt);
    const blocked = await fixture.rt.call('run_test', { test_id: spec.id }) as { error: string };
    assert.match(blocked.error, /orbit/i);
    assertNoSimulation(fixture);
  });
});

test('define_test rejects a known zero-start orbit before recording a definition', async () => {
  const fixture = runtime();
  await assemble(fixture.rt);
  for (const orbit of [
    { body: 'wheel', center: 'center', plane: 'xy' as const },
    { body: 'marker', center: 'center', plane: 'xy' as const, reference: { from: 'wheel', to: 'center' } },
  ]) {
    const spec = orbitTest(orbit);
    const rejected = await fixture.rt.call('define_test', { test: spec }) as { error: string };
    assert.match(rejected.error, /orbit/i);
    assert.equal(fixture.rt.testSpecs.has(spec.id), false);
    assertNoSimulation(fixture);
  }
  // A definition may still name a reference that will be added in a later step.
  const future = orbitTest({ body: 'marker', center: 'future_axle', plane: 'xy' });
  await callOk(fixture.rt, 'define_test', { test: future });
  assert.deepEqual(fixture.rt.testSpecs.get(future.id), future);
});

const secondMarker: AssemblyOp = {
  op: 'mount', id: 'marker2', part: 'shaft-3x60', onto: 'wheel', connector: 'rim_2', via: 'end_a',
  joint: 'fixed', spin_deg: 0, offset_m: 0,
};

test('an inherited degenerate target permits only an off-axis body in the same fixed group, retaining all other targets and history', async () => {
  const builder = runtime();
  await assemble(builder.rt, [...markerOps, secondMarker]);
  const original = TestSpec.parse({
    kind: 'motion', id: 'legacy_orbits', duration_s: 4,
    measure: { orbits: [
      { body: 'wheel', center: 'center', plane: 'xy', minTurns: 1, minRadius_m: 0.15, maxRadius_m: 0.25 },
      { body: 'marker', center: 'center', plane: 'xy', minTurns: 1 },
    ] },
    criteria: { torqueWithinRating: true },
  });
  // Capture actual old native evidence, as a saved version from before preflight.
  const oldResult = await runTest(builder.rt.assembly, { env: builder.rt.spec.environment, test: original });
  assert.equal(oldResult.passed, false);
  assert.ok(oldResult.trace.frames.length > 2);
  const saved = { assembly: builder.rt.assembly, testDefinitions: [original], tests: [oldResult] };
  const unchangedSaved = structuredClone(saved);
  const { rt, recorded, started } = runtime(saved.assembly, saved.testDefinitions);
  const corrected = structuredClone(original);
  assert.ok(corrected.kind === 'motion' && corrected.measure.orbits);
  corrected.measure.orbits[0].body = 'marker2';

  type MotionTest = Extract<TestSpec, { kind: 'motion' }>;
  const changes: [string, (spec: MotionTest) => void][] = [
    ['another rigid group', (spec) => { spec.measure.orbits![0].body = 'tower'; }],
    ['lower turn target', (spec) => { spec.measure.orbits![0].minTurns = 0.5; }],
    ['shorter duration', (spec) => { spec.duration_s = 3; }],
    ['smaller minimum radius', (spec) => { spec.measure.orbits![0].minRadius_m = 0.1; }],
    ['larger maximum radius', (spec) => { spec.measure.orbits![0].maxRadius_m = 0.3; }],
    ['different center', (spec) => { spec.measure.orbits![0].center = 'wheel'; }],
    ['different reference', (spec) => { spec.measure.orbits![0].reference = 'motor'; }],
    ['removed existing orbit', (spec) => { spec.measure.orbits!.pop(); }],
    ['reordered orbits', (spec) => { spec.measure.orbits!.reverse(); }],
    ['added orbit', (spec) => { spec.measure.orbits!.push({ body: 'center', center: 'tower', plane: 'xy', minTurns: 1 }); }],
    ['weakened torque check', (spec) => { spec.criteria.torqueWithinRating = false; }],
  ];
  for (const [label, change] of changes) {
    const candidate = structuredClone(corrected);
    change(candidate);
    const rejected = await rt.call('define_test', { test: candidate }) as { error?: string };
    assert.equal(typeof rejected.error, 'string', `${label} must not be permitted`);
    assert.equal(rt.testSpecs.has(original.id), false);
  }
  const correction = await callOk(rt, 'define_test', { test: corrected }) as {
    trackingCorrection?: string; requiresRetest?: boolean;
  };
  assert.equal(correction.requiresRetest, true);
  assert.equal(typeof correction.trackingCorrection, 'string');
  assert.match(correction.trackingCorrection!, /wheel/);
  assert.match(correction.trackingCorrection!, /marker2/);
  const weakenedBeforeRerun = structuredClone(corrected);
  weakenedBeforeRerun.measure.orbits![0].minTurns = 0.5;
  const unlocked = await rt.call('define_test', { test: weakenedBeforeRerun }) as { error?: string };
  assert.equal(typeof unlocked.error, 'string', 'accepting a tracking correction must not unlock its targets before retesting');
  assert.deepEqual(rt.testSpecs.get(original.id), corrected);
  assert.equal(rt.testCount, 0);
  assert.deepEqual(started, []);
  assert.deepEqual(recorded, []);
  assert.deepEqual(rt.pendingChecks(), ['No simulation test has run']);
  const premature = await rt.call('finalize_design', { status: 'passed', summary: 'The corrected marker is ready.' }) as { error?: string };
  assert.equal(typeof premature.error, 'string', 'changing the observed point is not passing evidence');

  const result = await callOk(rt, 'run_test', { test_id: original.id }) as unknown as TestResult;
  assert.equal(result.passed, true, result.failureReasons?.join('; '));
  assert.equal(rt.testCount, 1);
  assert.deepEqual(started, [`${original.id}#1`]);
  assert.equal(recorded.length, 1);
  assert.ok(result.metrics['marker2.orbitSignedTurns'] >= 1);
  assert.ok(result.metrics['marker.orbitSignedTurns'] >= 1);
  assert.deepEqual(rt.pendingChecks(), []);
  assert.deepEqual(saved, unchangedSaved, 'the prior saved definitions, results and geometry must stay intact');
  assert.deepEqual(rt.testSpecs.get(original.id), corrected);
});

test('moving a previously valid target onto its axis cannot unlock measured or inherited criteria', async (t) => {
  for (const source of ['inherited', 'measured'] as const) await t.test(source, async () => {
    const builder = runtime();
    await assemble(builder.rt, [...markerOps, secondMarker]);
    const original = orbitTest({ body: 'marker', center: 'center', plane: 'xy' });
    const fixture = source === 'inherited' ? runtime(builder.rt.assembly, [original]) : builder;
    const { rt } = fixture;
    await callOk(rt, 'define_test', { test: original });
    if (source === 'measured') {
      const passed = await callOk(rt, 'run_test', { test_id: original.id }) as { passed?: boolean };
      assert.equal(passed.passed, true);
    }
    const history = structuredClone(rt.tests);
    await callOk(rt, 'assemble', { rationale: 'Move the old marker onto the hub to check criteria remain protected.', ops: [
      { op: 'remove', id: 'marker' },
      { op: 'mount', id: 'marker', part: 'shaft-3x60', onto: 'wheel', connector: 'hub_front', via: 'end_a', joint: 'fixed' },
    ] });
    const candidate = orbitTest({ body: 'marker2', center: 'center', plane: 'xy' });
    const rejected = await rt.call('define_test', { test: candidate }) as { error?: string };
    assert.equal(typeof rejected.error, 'string');
    assert.deepEqual(rt.testSpecs.get(original.id), original);
    assert.deepEqual(rt.tests, history);
    assert.ok(rt.pendingChecks().length > 0);
  });
});

test('a moving orbit center remains valid with either a rotating part or a moving reference direction', async (t) => {
  const nestedOps: AssemblyOp[] = [
    { op: 'mount', id: 'orbit_motor', part: 'gearmotor-37', onto: 'wheel', connector: 'rim_0', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'orbit_crank', part: 'crank-30', onto: 'orbit_motor', connector: 'shaft', via: 'shaft', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'nested', stiffness: 0.2, damping: 0.1 } },
    { op: 'mount', id: 'orbit_marker', part: 'shaft-3x60', onto: 'orbit_crank', connector: 'pin', via: 'end_a', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ];
  const references: [string, PlanarOrbit['reference']][] = [
    ['part quaternion', 'wheel'],
    ['two-body direction', { from: 'wheel', to: 'orbit_motor' }],
  ];
  for (const [name, reference] of references) await t.test(name, async () => {
    const { rt, recorded, started } = runtime();
    await assemble(rt, nestedOps, ['spin', 'nested']);
    const orbit: PlanarOrbit = { body: 'orbit_marker', center: 'orbit_crank', plane: 'xy', reference };
    const spec = orbitTest(orbit, 'nested_orbit');
    await callOk(rt, 'define_test', { test: spec });
    const result = await callOk(rt, 'run_test', { test_id: spec.id }) as unknown as TestResult;
    assert.equal(result.passed, true, result.failureReasons?.join('; '));
    assert.equal(rt.testCount, 1);
    assert.deepEqual(started, [`${spec.id}#1`]);
    assert.equal(recorded.length, 1);
    assert.deepEqual(rt.pendingChecks(), []);

    const trace = recorded[0].trace;
    const start = trace.frames[0].bodies.orbit_crank.position;
    const centerTravel = Math.max(...trace.frames.map(({ bodies }) =>
      Math.hypot(...bodies.orbit_crank.position.map((value, axis) => value - start[axis]))));
    assert.ok(centerTravel > 0.35, `the test must exercise a moving center, got ${centerTravel} m`);
    const relative = measurePlanarOrbit(trace, orbit);
    const world = measurePlanarOrbit(trace, { body: orbit.body, center: orbit.center, plane: orbit.plane });
    assert.ok(relative && world);
    assert.ok(relative.signedTurns > 1);
    assert.ok(world.signedTurns - relative.signedTurns > 1, 'the rotating reference must remove the carrier rotation');
    assert.ok(Math.abs(relative.minRadius_m - 0.03) < 0.0001);
    assert.ok(Math.abs(relative.maxRadius_m - 0.03) < 0.0001);
  });
});

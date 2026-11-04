import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart, setDrives } from '@protolab/parts';
import { TestSpec, type Assembly, type Drive, type TestResult } from '@protolab/schema';
import { boundMotionObservations, motionDiagnostics } from './motion-diagnostics.ts';
import { ToolRuntime } from './tools.ts';
import { baseSpec } from './spec.ts';

const spec = TestSpec.parse({ kind: 'motion', id: 'position', duration_s: 2, measure: { joints: ['axis'] }, criteria: { minJointAmplitude_rad: 0.05 } });
function assembly(drive: Partial<Drive> = {}): Assembly {
  return setDrives(applyOps(emptyAssembly(), [
    { op: 'place', id: 'stand', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'stand', connector: 'axle', via: 'hub',
      joint: 'revolute', spin_deg: 0, offset_m: 0.06, motor: { controlId: 'axis', stiffness: 5, damping: 0.2 } },
  ], getPart).assembly, [{ controlId: 'axis', mode: 'position', rampIn_s: 0.1, profile: { kind: 'constant', value: 0.6 }, ...drive }]);
}
function trace(times: number[], missing = false): TestResult {
  return { testId: 'position#1', kind: 'motion', passed: true, metrics: {}, failureReasons: [], notes: [], engine: 'fixture',
    trace: { dt: 1 / 30, frames: times.map((t): TestResult['trace']['frames'][number] => ({ t, bodies: {}, joints: missing ? {} : { axis: 0 } })) } };
}

test('position commands use native settle, delayed ramps, steps and initial-target blend durations', () => {
  const constant = motionDiagnostics(assembly(), spec, trace([0, 0.2333, 0.2667, 0.5, 0.75, 1.25, 2]))!;
  const c = constant.positionJoints[0];
  assert.equal(c.firstNonzeroCommand_s, 0.2667);
  assert.equal(c.samples.find(({ time_s }) => time_s === 0.2333)!.command, 0);
  assert.equal(c.samples.find(({ time_s }) => time_s === 0.2667)!.command, 0.01);
  assert.ok(c.samples.some(({ time_s, phases }) => time_s === 1.25 && phases.includes('blend_in_end:at_or_after')));
  assert.deepEqual(c.commandRange, [0, 0.6]);

  const ramp = motionDiagnostics(assembly({ rampIn_s: 10, profile: { kind: 'ramp', from: 0, to: 0.8, start_s: 0.5, duration_s: 1 } }),
    spec, trace([0, 0.25, 0.5, 0.75, 1.25, 1.75, 2]))!.positionJoints[0];
  assert.equal(ramp.firstNonzeroCommand_s, 1.25);
  assert.equal(ramp.samples.find(({ time_s }) => time_s === 1.25)!.command, 0.4);
  assert.equal(ramp.samples.find(({ time_s }) => time_s === 1.75)!.command, 0.8);
  assert.ok(!ramp.samples.some(({ phases }) => phases.some((phase) => phase.startsWith('blend_in'))));

  const step = motionDiagnostics(assembly({ rampIn_s: 10, profile: { kind: 'step', before: 0.1, after: -0.4, at_s: 0.5 } }),
    spec, trace([0, 0.25, 0.5, 0.75, 1, 2]))!.positionJoints[0];
  assert.equal(step.samples.find(({ time_s }) => time_s === 0.25)!.command, 0, 'the controller holds rest during settle');
  assert.equal(step.samples.find(({ time_s }) => time_s === 0.5)!.command, 0.1);
  assert.equal(step.samples.find(({ time_s }) => time_s === 0.75)!.command, -0.4, 'native steps ignore rampIn');
  assert.deepEqual(step.commandRange, [-0.4, 0.1]);

  const sine = motionDiagnostics(assembly({ rampIn_s: 0.5, profile: { kind: 'sine', amplitude: 0.5, offset: 0.5, phase: -Math.PI / 2, frequency_hz: 1 } }),
    spec, trace([0, 0.25, 0.5, 0.75, 1, 2]))!.positionJoints[0];
  assert.equal(sine.samples.find(({ time_s }) => time_s === 0.5)!.command, 0.25);
  assert.equal(sine.samples.find(({ time_s }) => time_s === 0.75)!.command, 1);
});

test('missing observations stay null and large joint sets report bounded explicit omissions', () => {
  const missing = motionDiagnostics(assembly(), spec, trace([0, 0.2333, 0.2667, 0.5, 1, 2], true))!;
  assert.equal(missing.positionJoints[0].peakAbsoluteError, null);
  assert.equal(missing.positionJoints[0].actualRange, null);
  assert.ok(missing.positionJoints[0].samples.every(({ actual, error }) => actual === null && error === null));
  const many = assembly();
  const native = trace(Array.from({ length: 61 }, (_, i) => +(i / 30).toFixed(4)));
  many.joints = Array.from({ length: 64 }, (_, i) => ({ ...structuredClone(many.joints[0]), id: `joint_${i}`,
    motor: { ...many.joints[0].motor!, controlId: `axis_${i}` } }));
  many.controller.drives = many.joints.map(({ motor }) => ({ ...structuredClone(many.controller.drives[0]), controlId: motor!.controlId }));
  for (const frame of native.trace.frames) frame.joints = Object.fromEntries(many.joints.map(({ motor }, i) => [motor!.controlId, -i / 100]));
  const report = motionDiagnostics(many, spec, native)!;
  assert.equal(report.totalPositionJoints, 64);
  assert.equal(report.omittedPositionJoints, 56);
  assert.equal(report.positionJoints.length, 8);
  assert.equal(report.positionJoints[0].controlId, 'axis_63', 'largest observed errors are retained');
  assert.ok(report.positionJoints.every(({ samples }) => samples.length <= 12));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 24_000);
  assert.equal(motionDiagnostics(many, spec, { ...native, trace: { dt: 1 / 30, frames: [] } }), undefined);
});

test('run_test and later review retain each recorded controller after drives change', async () => {
  const rt = new ToolRuntime(baseSpec('Turn a wheel slowly on its stand'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {},
  }, undefined, assembly({ profile: { kind: 'constant', value: 0.2 } }));
  await rt.call('define_test', { test: spec });
  const firstReply = await rt.call('run_test', { test_id: spec.id }) as { motionDiagnostics: NonNullable<ReturnType<typeof motionDiagnostics>> };
  assert.ok(firstReply.motionDiagnostics, JSON.stringify(firstReply));
  const first = rt.tests[0];
  const saved = structuredClone(firstReply.motionDiagnostics);
  await rt.call('set_drives', { drives: [{ controlId: 'axis', mode: 'position', profile: { kind: 'constant', value: -0.2 }, rampIn_s: 0.1 }] });
  assert.deepEqual(rt.motionObservations([first]).reports, [saved], 'new drives cannot relabel old samples');
  const returned = rt.motionObservations([first]).reports;
  returned[0].positionJoints[0].samples[0].command = 99;
  assert.deepEqual(rt.motionObservations([first]).reports, [saved], 'review consumers cannot mutate the recorded cache');
  await rt.call('run_test', { test_id: spec.id });
  const both = rt.motionObservations(rt.tests).reports;
  assert.equal(both.length, 2);
  assert.deepEqual(both[0].positionJoints[0].commandRange, [0, 0.2]);
  assert.deepEqual(both[1].positionJoints[0].commandRange, [-0.2, 0]);
  const unknown = rt.motionObservations([structuredClone(first)]);
  assert.deepEqual(unknown.reports, [], 'uncached historical traces are not reconstructed using current drives');
  assert.equal(unknown.unavailableTestCount, 1);
});

test('fourteen position tests share one review byte budget with explicit whole-report coverage', () => {
  const observation = motionDiagnostics(assembly(), spec, trace([0, 0.2333, 0.2667, 0.5, 1, 2]))!;
  const reports = Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(observation), testId: `test_${i}#1`,
    positionJoints: Array.from({ length: 8 }, () => structuredClone(observation.positionJoints[0])) }));
  const input = { diagnosticOnly: true as const, requestedTestCount: 14, notApplicableTestCount: 0, unavailableTestCount: 0,
    omittedTestCount: 0, omittedTestIds: [], omittedTestIdCount: 0, reports };
  const bounded = boundMotionObservations(input)!;
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 24_000);
  assert.ok(bounded.omittedTestCount > 0);
  assert.equal(bounded.reports.length + bounded.omittedTestCount, 14);
  assert.equal(bounded.omittedTestIds.length + bounded.omittedTestIdCount, bounded.omittedTestCount);
  assert.deepEqual(bounded.reports, reports.slice(0, bounded.reports.length), 'kept observations remain complete');
  assert.equal(input.reports.length, 14, 'source reports are untouched');
  const tiny = boundMotionObservations(bounded, 512)!;
  assert.ok(Buffer.byteLength(JSON.stringify(tiny)) <= 512);
  assert.equal(tiny.omittedTestCount, 14);
  assert.equal(tiny.reports.length, 0);
});

test('oversized identifiers cannot defeat the payload-only report bound or get truncated into false IDs', () => {
  const id = 'p'.repeat(30_000);
  const result = trace([0, 1]);
  result.passed = false; result.metrics.payloadLift_m = 0;
  result.testId = id;
  const payloadSpec = TestSpec.parse({ ...spec, measure: { payload: { instance: id, holder: id } }, criteria: { minPayloadLift_m: 1 } });
  const empty = emptyAssembly();
  const report = motionDiagnostics(empty, payloadSpec, result)!;
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 24_000);
  assert.equal(report.omittedPayload, true);
  assert.equal(report.omittedTestId, true);
  assert.equal(report.testId, '');
  assert.equal(report.payload, undefined);
});

test('a shared control ID never assigns one overwritten trace reading to multiple physical joints', () => {
  const fixture = assembly();
  fixture.joints.push({ ...structuredClone(fixture.joints[0]), id: 'second_joint',
    b: { instanceId: 'second_wheel', connectorId: 'hub' } });
  const native = trace([0, 1, 2]);
  native.trace.frames[1].joints.axis = 1.5;
  native.metrics['axis.peakTorque_Nm'] = 0.2;
  const report = motionDiagnostics(fixture, spec, native)!;
  assert.equal(report.positionJoints.length, 2);
  for (const joint of report.positionJoints) {
    assert.equal(joint.ambiguousControlId, true);
    assert.equal(joint.actualRange, null);
    assert.equal(joint.peakAbsoluteError, null);
    assert.equal(joint.motor.peakDemand, null);
    assert.ok(joint.samples.every(({ actual, error }) => actual === null && error === null));
  }
});

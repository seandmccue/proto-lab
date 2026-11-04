import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, AssemblyOp, emptyAssembly, generatePart, getPart, invert, setDrives, transformPoint } from '@protolab/parts';
import { TestSpec, type TestResult } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { buildMarbleElevator, marbleElevatorTest } from '@protolab/simulator/marble-elevator';
import { motionDiagnostics } from './motion-diagnostics.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

function loadedArm(density: number, stiffness = 20) {
  // Same dimensions, motor, controller and joints: only the physical load changes.
  const load = generatePart('block', { length: 0.12, height: 0.12, width: 0.12, density }, 'diagnostic-load');
  const { assembly } = applyOps(emptyAssembly(), [
    { op: 'place', id: 'stand', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-high-torque-35', onto: 'stand', connector: 'top', via: 'bottom', joint: 'fixed' },
    { op: 'mount', id: 'arm', part: 'leg-bar-100', onto: 'servo', connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: 90,
      motor: { controlId: 'raise', stiffness, damping: 0.7 } },
    { op: 'mount', id: 'holder', part: 'beam-50', onto: 'arm', connector: 'tip', via: 'end_a', joint: 'fixed' },
    { op: 'mount', id: 'payload', part: load.id, onto: 'holder', connector: 'bottom', via: 'top', joint: 'fixed' },
  ].map((op) => AssemblyOp.parse(op)), (id) => id === load.id ? load : getPart(id));
  return setDrives(assembly, [{ controlId: 'raise', mode: 'position', rampIn_s: 0,
    profile: { kind: 'ramp', from: 0, to: 0.5, start_s: 0.5, duration_s: 1 } }]);
}

const liftingTest = TestSpec.parse({
  kind: 'motion', id: 'lift_load', duration_s: 4,
  measure: { joints: ['raise'], payload: { instance: 'payload', holder: 'holder' } },
  criteria: { minPayloadLift_m: 0.03, torqueWithinRating: true },
});

function near(actual: number | null, expected: number, tolerance = 0.0001) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function frameAt(result: TestResult, time_s: number) {
  const frame = result.trace.frames.find((candidate) => Math.abs(candidate.t - time_s) < 0.0001);
  assert.ok(frame, `diagnostic time ${time_s} must come from a recorded native frame`);
  return frame;
}

test('native position diagnostics distinguish loaded sag from healthy tracking without changing evidence', async () => {
  const observations = [];
  for (const density of [100, 2200]) {
    const assembly = loadedArm(density);
    const result = await runTest(assembly, { env, test: liftingTest });
    const saved = structuredClone({ assembly, test: liftingTest, result });
    const diagnostic = motionDiagnostics(assembly, liftingTest, result);
    assert.ok(diagnostic);
    assert.equal(diagnostic.diagnosticOnly, true);
    assert.equal(diagnostic.positionJoints.length, 1);
    const joint = diagnostic.positionJoints[0];
    assert.equal(joint.controlId, 'raise');
    assert.equal(joint.jointId, 'j_arm');
    assert.equal(joint.unit, 'rad');
    assert.deepEqual(joint.commandRange, [0, 0.5]);
    assert.ok(joint.firstNonzeroCommand_s! > 0.75 && joint.firstNonzeroCommand_s! < 0.79,
      'command begins after the native 0.25 s settling period plus the 0.5 s ramp delay');
    assert.ok(joint.samples.length > 2 && joint.samples.length <= 12);
    assert.equal(joint.samples[0].time_s, 0);
    assert.equal(joint.samples.at(-1)!.time_s, 4);
    for (const sample of joint.samples) {
      near(sample.actual, frameAt(result, sample.time_s).joints.raise);
      near(sample.error, sample.command - sample.actual!);
    }
    assert.equal(joint.motor.stiffness, 20);
    assert.equal(joint.motor.damping, 0.7);
    assert.equal(joint.motor.rating, 3.5);
    assert.equal(joint.motor.peakDemand, result.metrics['raise.peakTorque_Nm']);
    assert.equal(joint.motor.saturationFraction, null, 'native saturation is aggregate, not per-joint evidence');
    assert.equal(diagnostic.allMotorSaturationFraction, result.metrics.motorSaturation_fraction);
    const recorded = result.trace.frames.map((frame) => frame.joints.raise);
    near(joint.actualRange![0], Math.min(...recorded));
    near(joint.actualRange![1], Math.max(...recorded));
    assert.deepEqual({ assembly, test: liftingTest, result }, saved, 'diagnostics must not alter native evidence or targets');
    observations.push({ result, joint });
  }

  const [healthy, overloaded] = observations;
  assert.equal(healthy.result.passed, true, healthy.result.failureReasons.join('; '));
  assert.ok(healthy.joint.peakAbsoluteError! < 0.06);
  assert.ok(healthy.joint.samples.at(-1)!.actual! > 0.48);
  assert.equal(healthy.result.metrics.motorSaturation_fraction, 0);
  assert.equal(overloaded.result.passed, false);
  assert.match(overloaded.result.failureReasons.join('; '), /Payload lifted.*Motor demand exceeds rating/);
  assert.ok(overloaded.joint.peakAbsoluteError! > 0.8);
  assert.ok(overloaded.joint.samples.at(-1)!.actual! < -0.3, 'the overloaded arm sags below its assembled pose');
  assert.ok(overloaded.joint.motor.peakDemand! > overloaded.joint.motor.rating!);
  assert.equal(overloaded.result.metrics.motorSaturation_fraction, 1);
});

test('a real velocity drive never labels angular velocity as a commanded position', async () => {
  const assembly = setDrives(loadedArm(100), [{ controlId: 'raise', mode: 'velocity', rampIn_s: 0.3,
    profile: { kind: 'constant', value: 1 } }]);
  const spec = TestSpec.parse({ kind: 'motion', id: 'rotate_arm', duration_s: 1,
    measure: { joints: ['raise'] }, criteria: { minJointAmplitude_rad: 0.1, torqueWithinRating: true } });
  const result = await runTest(assembly, { env, test: spec });
  assert.ok(result.passed, result.failureReasons.join('; '));
  assert.ok(result.trace.frames.some((frame) => Math.abs(frame.joints.raise) > 0.1));
  assert.equal(motionDiagnostics(assembly, spec, result), undefined);
});

test('zero native motor saturation does not hide weak position control under gravity', async () => {
  const assembly = loadedArm(500, 2);
  const result = await runTest(assembly, { env, test: liftingTest });
  const saved = structuredClone(result);
  const diagnostic = motionDiagnostics(assembly, liftingTest, result);
  assert.ok(diagnostic);
  const joint = diagnostic.positionJoints[0];
  assert.equal(result.metrics.motorSaturation_fraction, 0);
  assert.ok(joint.motor.peakDemand! < joint.motor.rating!, JSON.stringify(joint.motor));
  assert.ok(joint.peakAbsoluteError! > 0.3, JSON.stringify(joint));
  assert.ok(joint.samples.at(-1)!.actual! < 0.2, 'low stiffness leaves a large steady tracking error despite unused rated torque');
  assert.equal(joint.samples.at(-1)!.command, 0.5);
  assert.equal(result.passed, false);
  assert.match(result.failureReasons.join('; '), /Payload lifted/);
  assert.doesNotMatch(result.failureReasons.join('; '), /Motor demand exceeds rating/);
  assert.deepEqual(result, saved);
});

test('failed native payload lift gets holder-relative diagnostics even when delivery and final hold pass', async () => {
  const assembly = buildMarbleElevator();
  assert.equal(marbleElevatorTest.kind, 'motion');
  const spec = TestSpec.parse({ ...marbleElevatorTest, id: 'lift_before_delivery',
    measure: { ...marbleElevatorTest.measure, payload: { instance: 'marble', holder: 'bucket' } },
    criteria: { ...marbleElevatorTest.criteria, minPayloadLift_m: 0.5 },
  });
  const result = await runTest(assembly, { env, test: spec });
  assert.equal(result.passed, false);
  assert.equal(result.failureReasons.length, 1);
  assert.match(result.failureReasons[0], /Payload lifted/);
  assert.ok(result.metrics.endInHold_s >= 0.75, 'receiver hold succeeds independently of the failed lift target');
  assert.ok(result.metrics.endInFinalMargin_m > 0);
  assert.ok(result.metrics.payloadLift_m > 0.1 && result.metrics.payloadLift_m < 0.2);
  const saved = structuredClone(result);
  const diagnostic = motionDiagnostics(assembly, spec, result);
  assert.ok(diagnostic?.payload);
  const payload = diagnostic.payload;
  assert.equal(payload.instance, 'marble');
  assert.equal(payload.holder, 'bucket');
  assert.ok(payload.samples.length > 2 && payload.samples.length <= 12);
  assert.equal(payload.samples[0].time_s, 0);
  assert.equal(payload.samples.at(-1)!.time_s, 9);
  const start = result.trace.frames[0];
  const initialRelative = transformPoint(invert(start.bodies.bucket), start.bodies.marble.position);
  for (const sample of payload.samples) {
    const frame = frameAt(result, sample.time_s);
    near(sample.payloadDeltaY_m, frame.bodies.marble.position[1] - start.bodies.marble.position[1]);
    near(sample.holderDeltaY_m, frame.bodies.bucket.position[1] - start.bodies.bucket.position[1]);
    near(sample.holderReferenceDeltaY_m, transformPoint(frame.bodies.bucket, initialRelative)[1] - start.bodies.marble.position[1]);
    const relative = transformPoint(invert(frame.bodies.bucket), frame.bodies.marble.position);
    assert.ok(sample.relativePosition_m);
    relative.forEach((coordinate, axis) => near(sample.relativePosition_m![axis], coordinate));
    near(sample.relativeDisplacement_m, Math.hypot(...relative.map((coordinate, axis) => coordinate - initialRelative[axis])));
  }
  const slide = diagnostic.positionJoints.find(({ controlId }) => controlId === 'lift');
  assert.ok(slide);
  assert.equal(slide.unit, 'm', 'the prismatic lift is measured in metres, not radians');
  assert.equal(slide.motor.rating, result.metrics['lift.rating']);
  assert.equal(slide.motor.peakDemand, result.metrics['lift.peakForce_N']);
  near(slide.commandRange[1], 0.12);
  assert.ok(slide.actualRange![1] > 0.11 && slide.actualRange![1] < 0.13);
  assert.deepEqual(result, saved, 'failed diagnostics must preserve receiver success and all native traces');
});

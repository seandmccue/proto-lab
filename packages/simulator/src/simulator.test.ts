import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalker, walkerOps, DEFAULT_WALKER, danceDrives, applyOps, emptyAssembly, setDrives, getPart, generatePart, transformPoint, type WalkerParams } from '@protolab/parts';
import { runTest, driveValue } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
const walk = { id: 'walk_1', kind: 'walk' as const, duration_s: 6, base: 'body', minDistance_m: 0.3, maxTilt_deg: 25, direction: 'x' as const, signed: false };
const TUNED: WalkerParams = { ...DEFAULT_WALKER, hipOffset_rad: 0.3, hipServoPartId: 'servo-ds3218', kneeServoPartId: 'servo-ds3218', gait: { ...DEFAULT_WALKER.gait, hipAmplitude_rad: 0.4, frequency_hz: 1.0, swingDuty: 0.2, kneeAmplitude_rad: 0.3, stiffness: 5, damping: 0.2 } };

test('standing walker stays upright', async () => {
  const a = buildWalker(DEFAULT_WALKER);
  const still = { drives: a.controller.drives.map((d) => ({ ...d, profile: { ...d.profile, amplitude: 0 } as never })) };
  const r = await runTest(a, { env, controller: still, test: { ...walk, duration_s: 2 } });
  assert.equal(r.metrics.fell, 0, r.failureReasons.join('; '));
  assert.ok(r.metrics.maxTilt_deg < 5, `tilt ${r.metrics.maxTilt_deg}`);
});

test('tuned quadruped (built from generic ops) walks the target distance', async () => {
  const a = buildWalker(TUNED);
  const r = await runTest(a, { env, test: walk });
  assert.ok(r.passed, r.failureReasons.join('; ') + ' ' + JSON.stringify(r.metrics));
  assert.ok(r.metrics.distance_m >= 0.3);
});

test('simulation is deterministic', async () => {
  const a = buildWalker(TUNED);
  const r1 = await runTest(a, { env, test: { ...walk, duration_s: 3 } });
  const r2 = await runTest(a, { env, test: { ...walk, duration_s: 3 } });
  assert.deepEqual(r1.metrics, r2.metrics);
});

test('dance keeps the tuned robot in place', async () => {
  const a = buildWalker(TUNED);
  const r = await runTest(a, { env, controller: { drives: danceDrives(TUNED) }, test: { kind: 'motion', id: 'dance_1', duration_s: 4, measure: { base: 'body', joints: [], clearancePairs: [], noGroundContact: [] }, criteria: { maxBaseTilt_deg: 25, maxBaseDrift_m: 0.08, torqueWithinRating: true } } });
  assert.ok(r.passed, r.failureReasons.join('; '));
});

test('gait drive keeps at most one leg lifted for a crawl', () => {
  const a = buildWalker(TUNED);
  for (let t = 1; t < 3; t += 0.01) {
    const lifted = a.controller.drives.filter((d) => d.profile.kind === 'gait' && d.profile.role === 'lift').filter((d) => Math.abs(driveValue(d.profile, t, 1) - (d.profile as { offset: number }).offset) > 1e-6).length;
    assert.ok(lifted <= 1, `${lifted} legs lifted at t=${t}`);
  }
});

test('motion test: a motor spins a propeller on an anchored tower and reports revolutions', async () => {
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'tower-150', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'motor', part: 'gearmotor-37', onto: 'base', connector: 'top', via: 'flange', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'prop', part: 'propeller-3x200', onto: 'motor', connector: 'shaft', via: 'shaft', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'spin', stiffness: 0.3, damping: 0.1 } },
  ], getPart);
  const a = setDrives(r0.assembly, [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 6 } }]);
  const r = await runTest(a, { env, test: { kind: 'motion', id: 'spin_1', duration_s: 4, measure: { joints: ['spin'], base: 'base', clearancePairs: [], noGroundContact: ['prop'] }, criteria: { minRevolutions: 2, torqueWithinRating: true } } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics['spin.revolutions'] >= 2);
});

test('launch test: a free ball on a tray flung by a servo arm lands and reports distance', async () => {
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.005, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-giant-8', onto: 'base', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0.03 },
    { op: 'mount', id: 'arm', part: 'leg-bar-100', onto: 'servo', connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: 195, offset_m: 0, motor: { controlId: 'throw', stiffness: 30, damping: 0.5 } },
    { op: 'mount', id: 'tray', part: 'tray-45', onto: 'arm', connector: 'tip', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart);
  // ball placed resting in the tray, free
  const tray = r0.assembly.instances.find((i) => i.id === 'tray')!;
  const r1 = applyOps(r0.assembly, [{ op: 'place', id: 'ball', part: 'foam-ball-60', position: [tray.transform.position[0], tray.transform.position[1] + 0.035, tray.transform.position[2]], free: true }], getPart);
  const a = setDrives(r1.assembly, [{ controlId: 'throw', mode: 'position', rampIn_s: 0, profile: { kind: 'step', before: 0, after: -1.4, at_s: 0.5 } }]);
  const r = await runTest(a, { env, test: { kind: 'launch', id: 'launch_1', duration_s: 4, projectile: 'ball', targetDistance_m: 0.5, tolerance_m: 0.5, direction: 'x' } });
  assert.ok(r.metrics.released === 1 && r.metrics.landed === 1, JSON.stringify(r.metrics) + r.failureReasons.join(';'));
  assert.ok(r.metrics.landingDistance_m > 0.05, `distance ${r.metrics.landingDistance_m}`);
  assert.ok(r.trace.frames.length > 50);
});

test('flapping: catalog butterfly wings on the winged body rise together with one sine drive', async () => {
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'body', part: 'body-butterfly-80', position: [0, 0.2, 0], anchored: true },
    { op: 'mount', id: 'wingL', part: 'wing-butterfly-200-left', onto: 'body', connector: 'wing_L0', via: 'hinge', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'flapL', stiffness: 0.5, damping: 0.05 } },
    { op: 'mount', id: 'wingR', part: 'wing-butterfly-200', onto: 'body', connector: 'wing_R0', via: 'hinge', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'flapR', stiffness: 0.5, damping: 0.05 } },
  ], getPart);
  const a = setDrives(r0.assembly, [
    { controlId: 'flapL', mode: 'position', rampIn_s: 0.2, profile: { kind: 'sine', amplitude: 0.7, offset: 0, frequency_hz: 2, phase: 0 } },
    { controlId: 'flapR', mode: 'position', rampIn_s: 0.2, profile: { kind: 'sine', amplitude: 0.7, offset: 0, frequency_hz: 2, phase: 0 } },
  ]);
  const r = await runTest(a, { env, test: { kind: 'motion', id: 'flap_1', duration_s: 3, measure: { joints: ['flapL', 'flapR'], base: 'body', clearancePairs: [['wingL', 'wingR']], noGroundContact: ['wingL', 'wingR'] }, criteria: { minJointAmplitude_rad: 0.5, torqueWithinRating: true } } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  // both wing tips move up and down in phase: sample the trace at the last frame and a quarter period earlier
  const frames = r.trace.frames; const last = frames[frames.length - 1];
  const tipY = (f: typeof last, id: string) => { const b = f.bodies[id]; const q = b.rotation; const [x, y, z, w] = q; const p: [number, number, number] = [0.2, 0, 0]; // rotate local tip
    const tx = 2 * (y * p[2] - z * p[1]), ty = 2 * (z * p[0] - x * p[2]), tz = 2 * (x * p[1] - y * p[0]);
    return b.position[1] + p[1] + w * ty + (z * tx - x * tz); };
  let maxDiff = 0; for (const f of frames.slice(-60)) maxDiff = Math.max(maxDiff, Math.abs(tipY(f, 'wingL') - tipY(f, 'wingR')));
  assert.ok(maxDiff < 0.02, `wing tips should move together, max height difference ${maxDiff.toFixed(3)} m`);
});

test('hexapod walks with the measured wave gait (recipe numbers)', async () => {
  const hex: WalkerParams = { ...TUNED, legCount: 6, chassisPartId: 'chassis-hex-200', gait: { ...TUNED.gait, swingDuty: 0.3, stiffness: 8 } };
  const r = await runTest(buildWalker(hex), { env, test: { ...walk, id: 'hex_walk', minDistance_m: 0.35 } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics.distance_m >= 0.35 && r.metrics.maxTilt_deg < 10, JSON.stringify(r.metrics));
});

test('hexapod placed across the walk direction scuttles sideways (walk test direction z)', async () => {
  const hex: WalkerParams = { ...TUNED, legCount: 6, chassisPartId: 'chassis-hex-200', gait: { ...TUNED.gait, swingDuty: 0.3 } };
  const { ops, drives } = walkerOps(hex);
  if (ops[0].op === 'place') ops[0].rotation_deg = [0, 90, 0];
  let a = setDrives(applyOps(emptyAssembly(), ops, getPart).assembly, drives);
  const foot = getPart('foot-pad-12')!;
  const lowest = Math.min(...a.instances.filter((x) => x.partId === foot.id).map((x) => x.transform.position[1] - foot.params.radius));
  a = applyOps(a, [{ op: 'move', id: 'body', translate: [0, -lowest, 0] }], getPart).assembly;
  const r = await runTest(a, { env, test: { ...walk, id: 'side_walk', direction: 'z' } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics.distance_m >= 0.3, JSON.stringify(r.metrics));
});

test('drawbridge: a plate deck on a servo horn via hinge_back lifts 60° within rating (recipe numbers)', async () => {
  const deck = generatePart('plate', { length: 0.3, width: 0.15, thickness: 0.006 }, 'deck-300x150');
  const resolve = (id: string) => (id === deck.id ? deck : getPart(id));
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.004, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-high-torque-35', onto: 'base', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'deck', part: deck.id, onto: 'servo', connector: 'horn', via: 'hinge_back', joint: 'revolute', spin_deg: 180, offset_m: 0, motor: { controlId: 'lift', stiffness: 40, damping: 2 } },
  ], resolve);
  const a = setDrives(r0.assembly, [{ controlId: 'lift', mode: 'position', rampIn_s: 0, profile: { kind: 'ramp', from: 0, to: 1.1, start_s: 0.5, duration_s: 3 } }]);
  const r = await runTest(a, { env, test: { kind: 'motion', id: 'lift', duration_s: 5, measure: { joints: ['lift'], base: 'base', clearancePairs: [['deck', 'base']], noGroundContact: ['deck'] }, criteria: { minJointAmplitude_rad: 1.0, torqueWithinRating: true } } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics['lift.peakTorque_Nm'] < 2, `torque ${r.metrics['lift.peakTorque_Nm']}`);
  const endY = r.trace.frames[r.trace.frames.length - 1].bodies.deck.position[1];
  assert.ok(endY > 0.12, `deck centre should rise, got y=${endY}`);
});

test('quadruped with motor stiffness 8 walks past 45 cm in 6 s (recipe numbers)', async () => {
  const fast: WalkerParams = { ...TUNED, gait: { ...TUNED.gait, stiffness: 8 } };
  const r = await runTest(buildWalker(fast), { env, test: { ...walk, id: 'fast_walk', minDistance_m: 0.45 } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics.maxTilt_deg < 8 && r.metrics.motorSaturation_fraction < 0.03, JSON.stringify(r.metrics));
});

function clawAssembly(blockOffsetX = 0) {
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'plate-120x80', position: [0, 0.002, 0], anchored: true },
    { op: 'mount', id: 'post', part: 'beam-100', onto: 'base', connector: 'top', via: 'end_a', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'palm', part: 'plate-120x80', onto: 'post', connector: 'end_b', via: 'top', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'servo_L', part: 'servo-mg996r', onto: 'palm', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'servo_R', part: 'servo-mg996r', onto: 'palm', connector: 'top_front', via: 'bottom', joint: 'fixed', spin_deg: 180, offset_m: 0 },
    { op: 'mount', id: 'finger_L', part: 'gripper-finger-50', onto: 'servo_L', connector: 'horn', via: 'root', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'grip_L', stiffness: 8, damping: 0.3 } },
    { op: 'mount', id: 'finger_R', part: 'gripper-finger-50', onto: 'servo_R', connector: 'horn', via: 'root', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'grip_R', stiffness: 8, damping: 0.3 } },
    { op: 'move', id: 'servo_R', translate: [0, 0, 0.046] },   // the flipped servo's horn sits on the other face; bring both fingers into one plane
  ], getPart);
  const inst = (id: string) => r0.assembly.instances.find((i) => i.id === id)!;
  const tipL = transformPoint(inst('finger_L').transform, [0, -0.05, 0]), tipR = transformPoint(inst('finger_R').transform, [0, -0.05, 0]);
  const mid: [number, number, number] = [(tipL[0] + tipR[0]) / 2 + blockOffsetX, Math.min(tipL[1], tipR[1]) + 0.012, (tipL[2] + tipR[2]) / 2];
  return applyOps(r0.assembly, [{ op: 'place', id: 'block', part: 'block-40', position: mid, free: true }], getPart).assembly;
}
const gripTest = { kind: 'grip' as const, id: 'grip_1', duration_s: 4, payload: 'block', holder: 'palm', supportUntil_s: 1.2, maxSeparation_m: 0.15 };

test('claw: two mirrored fingers on a palm hold a 40 mm block (recipe numbers)', async () => {
  const a = setDrives(clawAssembly(), ['grip_L', 'grip_R'].map((c) => ({ controlId: c, mode: 'position' as const, rampIn_s: 0, profile: { kind: 'step' as const, before: 0, after: 0.6, at_s: 0.5 } })));
  const r = await runTest(a, { env, test: gripTest });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.equal(r.metrics.payloadGrounded, 0);
  assert.ok(r.metrics.payloadSeparation_m < 0.03, JSON.stringify(r.metrics));
});

test('grip test fails honestly when the payload lands on the floor', async () => {
  const a = setDrives(clawAssembly(0.12), ['grip_L', 'grip_R'].map((c) => ({ controlId: c, mode: 'position' as const, rampIn_s: 0, profile: { kind: 'constant' as const, value: 0 } })));
  const r = await runTest(a, { env, test: gripTest });
  assert.ok(!r.passed && /fell to the ground|on the ground/.test(r.failureReasons[0]), r.failureReasons.join('; '));
  assert.equal(r.metrics.payloadGrounded, 1);
});

test('catapult range is set by arm length: a 140 mm arm on the 8 N·m servo lands the pizza near 0.6 m (recipe numbers)', async () => {
  const arm = generatePart('leg_segment', { length: 0.14 }, 'arm-140');
  const resolve = (id: string) => (id === arm.id ? arm : getPart(id));
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.005, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-giant-8', onto: 'base', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0.03 },
    { op: 'mount', id: 'arm', part: arm.id, onto: 'servo', connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: 195, offset_m: 0, motor: { controlId: 'throw', stiffness: 30, damping: 0.5 } },
    { op: 'mount', id: 'tray', part: 'tray-45', onto: 'arm', connector: 'tip', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], resolve);
  const tray = r0.assembly.instances.find((i) => i.id === 'tray')!;
  void tray;
  const r1 = applyOps(r0.assembly, [{ op: 'mount', id: 'pizza', part: 'foam-pizza-80', onto: 'tray', connector: 'payload', via: 'bottom', joint: 'free', spin_deg: 0, offset_m: 0 }], resolve);
  const a = setDrives(r1.assembly, [{ controlId: 'throw', mode: 'position', rampIn_s: 0, profile: { kind: 'step', before: 0, after: -1.4, at_s: 0.5 } }]);
  const r = await runTest(a, { env, test: { kind: 'launch', id: 'l', duration_s: 5, projectile: 'pizza', targetDistance_m: 0.6, tolerance_m: 0.15, direction: 'x' } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics.landingDistance_m > 0.45 && r.metrics.landingDistance_m < 0.75, `landed ${r.metrics.landingDistance_m}`);
});

test('a sine drive whose offset starts away from the assembled pose is blended in over rampIn_s (no t=0 slam)', async () => {
  const deck = generatePart('plate', { length: 0.3, width: 0.15, thickness: 0.006 }, 'deck-300x150');
  const resolve = (id: string) => (id === deck.id ? deck : getPart(id));
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.004, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-high-torque-35', onto: 'base', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'deck', part: deck.id, onto: 'servo', connector: 'horn', via: 'hinge_back', joint: 'revolute', spin_deg: 180, offset_m: 0, motor: { controlId: 'lift', stiffness: 40, damping: 2 } },
  ], resolve);
  // phase 0: the target is already 0.55 rad at t = 0 while the deck lies flat
  const a = setDrives(r0.assembly, [{ controlId: 'lift', mode: 'position', rampIn_s: 0.5, profile: { kind: 'sine', amplitude: 0.55, offset: 0.55, frequency_hz: 0.2, phase: 0 } }]);
  const r = await runTest(a, { env, test: { kind: 'motion', id: 'cycle', duration_s: 10, measure: { joints: ['lift'], base: 'base', clearancePairs: [['deck', 'base']], noGroundContact: ['deck'] }, criteria: { minJointAmplitude_rad: 1.0, torqueWithinRating: true } } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics['lift.peakTorque_Nm'] < 3, `peak ${r.metrics['lift.peakTorque_Nm']}`);
});

test('a rotor mounted flush on a tower axle spins clear: bearing contact is not a clearance violation', async () => {
  for (const [tower, rotor] of [['tower-500', 'windmill-4x600'], ['tower-150', 'propeller-3x200']] as const) {
    const r0 = applyOps(emptyAssembly(), [
      { op: 'place', id: 'tower', part: tower, position: [0, 0, 0], anchored: true },
      { op: 'mount', id: 'rotor', part: rotor, onto: 'tower', connector: 'axle', via: 'shaft', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    ], getPart);
    const a = setDrives(r0.assembly, [{ controlId: 'spin', mode: 'velocity', rampIn_s: 1, profile: { kind: 'constant', value: 2.5 } }]);
    const r = await runTest(a, { env, test: { kind: 'motion', id: 's', duration_s: 6, measure: { joints: ['spin'], base: 'tower', clearancePairs: [['rotor', 'tower']], noGroundContact: ['rotor'] }, criteria: { minRevolutions: 1.5, torqueWithinRating: true } } });
    assert.ok(r.passed, `${tower}+${rotor}: ` + r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  }
});

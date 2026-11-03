import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalker, walkerOps, DEFAULT_WALKER, danceDrives, applyOps, emptyAssembly, setDrives, getPart, generatePart, type WalkerParams } from '@protolab/parts';
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
  const hex: WalkerParams = { ...TUNED, legCount: 6, chassisPartId: 'chassis-hex-200', gait: { ...TUNED.gait, swingDuty: 0.3 } };
  const r = await runTest(buildWalker(hex), { env, test: { ...walk, id: 'hex_walk' } });
  assert.ok(r.passed, r.failureReasons.join('; ') + JSON.stringify(r.metrics));
  assert.ok(r.metrics.distance_m >= 0.3 && r.metrics.maxTilt_deg < 10, JSON.stringify(r.metrics));
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

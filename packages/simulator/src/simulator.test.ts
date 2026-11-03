import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalker, DEFAULT_WALKER, danceDrives, applyOps, emptyAssembly, setDrives, getPart, type WalkerParams } from '@protolab/parts';
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

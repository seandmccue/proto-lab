import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalker, DEFAULT_WALKER, danceController, type WalkerParams } from '@protolab/parts';
import { runTest, controlTargets } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
const walk = { id: 'walk_1', kind: 'walk' as const, duration_s: 6, targets: { minDistance_m: 0.3, maxTilt_deg: 25 } };
const TUNED: WalkerParams = { ...DEFAULT_WALKER, hipOffset_rad: 0.25, hipServoPartId: 'servo-mg996r', kneeServoPartId: 'servo-mg996r', gait: { ...DEFAULT_WALKER.gait, hipAmplitude_rad: 0.4, frequency_hz: 1.0, swingDuty: 0.2, kneeAmplitude_rad: 0.3 } };

test('standing robot stays upright', async () => {
  const a = buildWalker(DEFAULT_WALKER);
  const ctl = { ...a.controller!, hipAmplitude_rad: 0, kneeAmplitude_rad: 0 };
  const r = await runTest(a, { env, controller: ctl, test: { ...walk, duration_s: 2 } });
  assert.equal(r.metrics.fell, 0);
  assert.ok(r.metrics.maxTilt_deg < 5, `tilt ${r.metrics.maxTilt_deg}`);
});

test('tuned quadruped walks the target distance and passes', async () => {
  const a = buildWalker(TUNED);
  const r = await runTest(a, { env, test: walk });
  assert.ok(r.passed, r.failureReasons.join('; '));
  assert.ok(r.metrics.distance_m >= 0.3);
  assert.ok(r.trace.frames.length > 100);
});

test('simulation is deterministic', async () => {
  const a = buildWalker(TUNED);
  const r1 = await runTest(a, { env, test: { ...walk, duration_s: 3 } });
  const r2 = await runTest(a, { env, test: { ...walk, duration_s: 3 } });
  assert.deepEqual(r1.metrics, r2.metrics);
});

test('dance test keeps the tuned robot in place', async () => {
  const a = buildWalker(TUNED);
  const r = await runTest(a, { env, controller: danceController(a.controller! as any), test: { id: 'dance_1', kind: 'dance', duration_s: 4, targets: { maxTilt_deg: 25, maxDrift_m: 0.08 } } });
  assert.equal(r.metrics.fell, 0, r.failureReasons.join('; '));
  assert.ok(Math.hypot(r.metrics.distance_m, r.metrics.lateralDrift_m) < 0.08, `drift ${r.metrics.distance_m}`);
});

test('crawl controller keeps three feet down', () => {
  const a = buildWalker(TUNED);
  for (let t = 1; t < 3; t += 0.01) {
    const tg = controlTargets(a.controller!, t);
    const lifted = Object.entries(tg).filter(([k, v]) => k.startsWith('knee_') && v > TUNED.kneeFlex_rad + 1e-6).length;
    assert.ok(lifted <= 1, `${lifted} legs lifted at t=${t}`);
  }
});

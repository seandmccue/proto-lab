import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTest } from './index.ts';
import { buildCamSemaphore, camSemaphoreEnvironment as env, camSemaphoreTest, measureCamSemaphore } from './cam-semaphore.ts';

test('opposing lobes on one camshaft alternate two passive flags with measurable dwell', async () => {
  const assembly = buildCamSemaphore();
  assert.deepEqual(assembly.joints.flatMap(({ motor }) => motor ? [motor.controlId] : []), ['cam_spin']);
  const result = await runTest(assembly, { env, test: camSemaphoreTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  const cycles = measureCamSemaphore(result);
  assert.equal(result.metrics.followerCycles, cycles.length);
  assert.ok(result.metrics.followerPhaseGap_deg >= 165);
  assert.ok(cycles.length >= 3);
  for (const { flags, phaseGap_deg } of cycles) {
    assert.ok(phaseGap_deg >= 165, `peaks only ${phaseGap_deg}° apart`);
    for (const { id, stroke_m, lowDwell_s } of flags) {
      assert.ok(stroke_m >= 0.016, `${id} moved ${stroke_m} m`);
      assert.ok(lowDwell_s >= 1.05, `${id} held low for ${lowDwell_s} s`);
    }
  }
});

test('a still-spinning shaft with lobe contact disabled cannot lift either flag', async () => {
  const result = await runTest(buildCamSemaphore({ lobesCollide: false }), { env, test: camSemaphoreTest });
  assert.equal(result.passed, false);
  assert.ok(result.metrics['cam_spin.revolutions'] >= 3);
  assert.equal(result.failureReasons.filter((reason) => /flag travelled .* along y/.test(reason)).length, 2);
  assert.ok(result.metrics['amber_flag.travel_y_m'] < 0.002);
  assert.ok(result.metrics['teal_flag.travel_y_m'] < 0.002);
  assert.ok(result.failureReasons.some((reason) => reason.includes('shortest stroke')));
});

test('follower timing alone rejects missed dwell and phase targets', async () => {
  if (camSemaphoreTest.kind !== 'motion' || !camSemaphoreTest.measure.followerTiming) assert.fail('missing timing spec');
  const result = await runTest(buildCamSemaphore(), { env, test: {
    ...camSemaphoreTest,
    measure: { joints: [], clearancePairs: [], noGroundContact: [], followerTiming: {
      ...camSemaphoreTest.measure.followerTiming, minLowDwell_s: 1.5, minPhaseGap_deg: 180,
    } },
    criteria: { torqueWithinRating: false },
  } });
  assert.equal(result.passed, false);
  assert.ok(result.failureReasons.some((reason) => reason.includes('peaks were only')));
  assert.equal(result.failureReasons.filter((reason) => reason.includes('shortest dwell')).length, 2);
});

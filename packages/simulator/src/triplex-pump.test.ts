import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestSpec } from '@protolab/schema';
import { runTest } from './index.ts';
import { buildTriplexPump, measureTriplexPump, triplexPumpTest } from './triplex-pump.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

test('one shaft drives three passive pump pistons through 40 mm strokes at 120° intervals', async () => {
  const assembly = buildTriplexPump();
  assert.deepEqual(assembly.controller.drives.map((drive) => drive.controlId), ['shaft_spin']);
  assert.equal(assembly.joints.filter((joint) => joint.motor).length, 1);
  assert.equal(assembly.joints.filter((joint) => joint.type === 'prismatic' && !joint.motor).length, 3);

  const result = await runTest(assembly, { env, test: triplexPumpTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(result.metrics['shaft_spin.revolutions'] >= 3);
  const { measurements, phaseGaps_deg } = measureTriplexPump(result);
  for (const { piston, stroke_m } of measurements) {
    assert.ok(Math.abs(stroke_m - 0.04) < 0.002, `Piston ${piston} stroke ${stroke_m} m`);
  }
  assert.ok(phaseGaps_deg.every((gap) => Math.abs(gap - 120) <= 8), JSON.stringify(phaseGaps_deg));
});

test('a stopped pump fails to meet the shaft and passive travel criteria', async () => {
  const result = await runTest(buildTriplexPump(), { env, test: triplexPumpTest, controller: { drives: [] } });
  assert.equal(result.passed, false);
  assert.ok(result.metrics['shaft_spin.revolutions'] < 0.01);
  const travelFailures = result.failureReasons.filter((reason) => /piston_[123]/.test(reason));
  assert.equal(travelFailures.length, 3, result.failureReasons.join(', '));
});

test('a phase-only test validates all three pump outputs over multiple complete turns', async () => {
  const spec = {
    kind: 'motion' as const, id: 'triplex_timing', duration_s: 7.3,
    measure: {
      joints: [], clearancePairs: [], noGroundContact: [],
      followerTiming: {
        shaft: 'shaft_spin', followers: ['piston_1', 'piston_2', 'piston_3'] as [string, string, string],
        axis: 'y' as const, minCycles: 3, minStroke_m: 0.038, minPhaseGap_deg: 110, maxPhaseGap_deg: 130,
      },
    },
    criteria: { torqueWithinRating: true },
  };
  const assembly = buildTriplexPump();
  const result = await runTest(assembly, { env, test: TestSpec.parse(spec) });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.equal(result.metrics.followerCycles, 3);
  assert.ok(result.metrics.followerPhaseGap_deg >= 110);
  assert.ok(result.metrics.followerMaxPhaseGap_deg <= 130);

  const timing = spec.measure.followerTiming;
  const tooNarrow = await runTest(assembly, {
    env, test: { ...spec, measure: { ...spec.measure, followerTiming: { ...timing, maxPhaseGap_deg: 120 } } },
  });
  assert.equal(tooNarrow.passed, false);
  assert.match(tooNarrow.failureReasons.join(', '), /Follower peaks were up to .* limit 120°/);

  const duplicate = await runTest(assembly, {
    env, test: { ...spec, measure: { ...spec.measure, followerTiming: { ...timing, followers: ['piston_1', 'piston_2', 'piston_1'] } } },
  });
  assert.equal(duplicate.passed, false);
  assert.match(duplicate.failureReasons.join(', '), /different instances/);
});

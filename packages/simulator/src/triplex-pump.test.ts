import assert from 'node:assert/strict';
import { test } from 'node:test';
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

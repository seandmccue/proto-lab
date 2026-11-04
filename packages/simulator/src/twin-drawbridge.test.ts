import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTest } from './index.ts';
import { buildTwinDrawbridge, measureTwinDrawbridge, twinDrawbridgeTest } from './twin-drawbridge.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

test('one actuator opens and closes two passive bridge leaves through bell cranks', async () => {
  const assembly = buildTwinDrawbridge();
  assert.deepEqual(assembly.controller.drives.map(({ controlId }) => controlId), ['open_bridge']);
  assert.equal(assembly.joints.filter((joint) => joint.motor).length, 1);

  const result = await runTest(assembly, { env, test: twinDrawbridgeTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  const [left, right] = measureTwinDrawbridge(result);
  for (const { leaf, peakAngle_deg, endAngle_deg } of [left, right]) {
    assert.ok(peakAngle_deg >= 40, `${leaf} opened to ${peakAngle_deg}°`);
    assert.ok(endAngle_deg <= 2, `${leaf} ended at ${endAngle_deg}°`);
  }
  assert.ok(Math.abs(left.peakAngle_deg - right.peakAngle_deg) <= 5);
  assert.equal(result.metrics.clearanceViolation, 0);
});

test('an unpowered bridge fails both leaf travel requirements', async () => {
  const result = await runTest(buildTwinDrawbridge(), { env, test: twinDrawbridgeTest, controller: { drives: [] } });
  assert.equal(result.passed, false);
  assert.equal(result.failureReasons.filter((reason) => /left_deck|right_deck/.test(reason)).length, 2);
});

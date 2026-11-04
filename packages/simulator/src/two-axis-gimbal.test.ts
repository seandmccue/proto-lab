import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTest } from './index.ts';
import { buildTwoAxisGimbal, twoAxisGimbalTest } from './two-axis-gimbal.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

function assertBothAxesSwept(metrics: Record<string, number>) {
  for (const axis of ['roll', 'pitch']) {
    assert.ok(metrics[`${axis}.minSwing_rad`] <= -0.35);
    assert.ok(metrics[`${axis}.maxSwing_rad`] >= 0.35);
  }
}

test('two perpendicular passive bearings keep a tray level through both powered sweeps', async () => {
  const assembly = buildTwoAxisGimbal();
  assert.deepEqual(assembly.controller.drives.map(({ controlId }) => controlId), ['roll', 'pitch']);
  assert.equal(assembly.joints.filter(({ motor }) => motor).length, 2);
  const passive = assembly.joints.filter(({ type, motor }) => type === 'revolute' && !motor);
  assert.equal(passive.length, 2);

  const result = await runTest(assembly, { env, test: twoAxisGimbalTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assertBothAxesSwept(result.metrics);
  assert.ok(result.metrics['tray.maxTilt_deg'] <= 10);
  assert.equal(result.metrics.groundContactViolation, 0);
  assert.equal(result.metrics.clearanceViolation, 0);
});

test('locking either passive bearing loses leveling while both powered axes keep moving', async () => {
  const assembly = buildTwoAxisGimbal();
  const bearings = assembly.joints.filter(({ type, motor }) => type === 'revolute' && !motor);
  assert.equal(bearings.length, 2);
  for (const { id } of bearings) {
    const rig = structuredClone(assembly);
    rig.joints.find((joint) => joint.id === id)!.type = 'fixed';
    const result = await runTest(rig, { env, test: twoAxisGimbalTest });
    assert.equal(result.passed, false, `Locking ${id} should lose leveling`);
    assertBothAxesSwept(result.metrics);
    assert.ok(result.metrics['tray.maxTilt_deg'] > 10);
    assert.ok(result.failureReasons.some((reason) => reason.startsWith('tray tilted')));
  }
});

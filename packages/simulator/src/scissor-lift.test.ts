import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTest } from './index.ts';
import { buildScissorLift, scissorLiftTest } from './scissor-lift.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

test('one actuator raises and retracts a level scissor lift platform', async () => {
  const assembly = buildScissorLift();
  assert.equal(assembly.joints.filter((joint) => joint.motor).length, 1);

  const result = await runTest(assembly, { env, test: scissorLiftTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  const heights = result.trace.frames.map((frame) => frame.bodies.platform.position[1]);
  assert.ok(Math.max(...heights) - heights[0] >= 0.045);
  assert.ok(Math.abs(heights.at(-1)! - heights[0]) <= 0.002);
  assert.ok(result.metrics['platform.maxTilt_deg'] <= 2);
  assert.equal(result.metrics.clearanceViolation, 0);
  assert.equal(result.metrics.groundContactViolation, 0);
});

test('the platform fails the travel requirement when the actuator applies no force', async () => {
  const assembly = buildScissorLift();
  for (const joint of assembly.joints) {
    if (joint.motor) {
      joint.motor.stiffness = 0;
      joint.motor.damping = 0;
    }
  }

  const result = await runTest(assembly, { env, test: scissorLiftTest, controller: { drives: [] } });
  assert.equal(result.passed, false);
  assert.match(result.failureReasons.join(', '), /platform travelled .* target 0\.045 m/);
  assert.ok(result.metrics['platform.travel_y_m'] < 0.002);
});

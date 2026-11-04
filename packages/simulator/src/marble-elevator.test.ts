import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Spec } from '@protolab/schema';
import { buildMarbleElevator, marbleElevatorTest } from './marble-elevator.ts';
import { runTest } from './index.ts';

const env = Spec.parse({ task: 'Marble elevator' }).environment;

test('an unjointed marble rides up in a bucket and rolls down the chute into the receiver', async () => {
  const assembly = buildMarbleElevator();
  assert.equal(assembly.instances.find(({ id }) => id === 'marble')?.free, true);
  assert.equal(assembly.joints.some(({ a, b }) => a.instanceId === 'marble' || b.instanceId === 'marble'), false);
  const result = await runTest(assembly, { env, test: marbleElevatorTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(result.metrics.endInHold_s >= 0.75);
  assert.ok(result.metrics.endInFinalMargin_m > 0);
  assert.equal(result.metrics.groundContactViolation, 0);
});

test('holding the tip drive level still lifts the marble but fails delivery', async () => {
  const result = await runTest(buildMarbleElevator(false), { env, test: marbleElevatorTest });
  assert.equal(result.passed, false);
  assert.ok(result.metrics.payloadLift_m >= 0.10);
  assert.ok(result.metrics['marble.travel_x_m'] < 0.12);
  assert.equal(result.metrics.endInHold_s, 0);
  assert.ok(result.failureReasons.some((reason) => reason.includes('ended inside catcher')));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps } from '@protolab/parts';
import { Spec, TestSpec } from '@protolab/schema';
import { buildMarbleElevator, marbleElevatorEndIn, marbleElevatorTest } from './marble-elevator.ts';
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

test('one motion run must deliver both marbles to their own receivers', async () => {
  const fixture = buildMarbleElevator();
  const second = { ...marbleElevatorEndIn, instance: 'second_marble', receiver: 'second_catcher' };
  const testSpec = TestSpec.parse({
    kind: 'motion', id: 'check_both_receivers', duration_s: 9,
    measure: { endIn: [marbleElevatorEndIn, second] },
    criteria: { torqueWithinRating: false },
  });
  const lookup = (id: string) => fixture.parts.find((part) => part.id === id);
  const firstBallPart = fixture.instances.find(({ id }) => id === 'marble')!.partId;
  const firstReceiverPart = fixture.instances.find(({ id }) => id === 'catcher')!.partId;

  for (const secondDelivered of [true, false]) {
    const { assembly } = applyOps(fixture, [
      { op: 'place', id: 'second_catcher', part: firstReceiverPart, position: [0.45, 0.15, 0], anchored: true },
      { op: 'place', id: 'second_marble', part: firstBallPart, position: [secondDelivered ? 0.45 : 0.60, 0.18, 0], free: true },
    ], lookup);
    const result = await runTest(assembly, { env, test: testSpec });
    assert.equal(result.passed, secondDelivered, result.failureReasons.join(', '));
    assert.ok(result.metrics['endInHold_s.1'] >= 0.75);
    assert.ok(result.metrics['endInFinalMargin_m.1'] > 0);
    if (secondDelivered) {
      assert.ok(result.metrics['endInHold_s.2'] >= 0.75);
      assert.ok(result.metrics['endInFinalMargin_m.2'] > 0);
    } else {
      assert.equal(result.metrics['endInHold_s.2'], 0);
      assert.ok(result.metrics['endInFinalMargin_m.2'] < 0);
      assert.equal(result.failureReasons.length, 1);
      assert.match(result.failureReasons[0], /second_marble ended inside second_catcher/);
      assert.match(result.failureReasons[0], /Final center in receiver-local XYZ \[150\.00, [^,]+, 0\.00\] mm/);
      assert.match(result.failureReasons[0], /allowed bounds X \[-60\.00, 60\.00\], Y \[11\.00, 19\.00\], Z \[-54\.00, 54\.00\] mm/);
    }
  }
});

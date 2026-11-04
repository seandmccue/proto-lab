import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quatFromAxisAngle, transformPoint } from '@protolab/parts';
import type { Trace, Vec3 } from '@protolab/schema';
import { measureEndIn, receiverOccupancyAt, sampleReceiverOccupancy } from './end-in.ts';

const goal = {
  instance: 'marble', receiver: 'catcher',
  centerOffset_m: [0.01, 0.02, 0] as Vec3,
  halfExtents_m: [0.025, 0.01, 0.02] as Vec3,
  minHold_s: 0.3,
};
const makeTrace = (samples: Vec3[]): Trace => ({
  dt: 0.1,
  frames: samples.map((local, index) => {
    const catcher = { position: [1 + index * 0.1, 2, 3] as Vec3, rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2) };
    return { t: index / 10, joints: {}, bodies: {
      catcher, marble: { position: transformPoint(catcher, local), rotation: [0, 0, 0, 1] },
    } };
  }),
});

test('receiver occupancy uses the local box and counts the uninterrupted final hold', () => {
  const outside: Vec3 = [0.05, 0.02, 0];
  const inside: Vec3 = [0.01, 0.02, 0];
  const measured = measureEndIn(makeTrace([outside, inside, outside, inside, inside, inside, inside]), goal);
  assert.ok(measured);
  assert.ok(Math.abs(measured.hold_s - 0.3) < 1e-8);
  assert.ok(Math.abs(measured.finalMargin_m - 0.01) < 1e-8);
});

test('passing through the receiver does not count as a final hold', () => {
  const measured = measureEndIn(makeTrace([[0.01, 0.02, 0], [0.01, 0.02, 0], [0.05, 0.02, 0]]), goal);
  assert.ok(measured);
  assert.equal(measured.hold_s, 0);
  assert.ok(measured.finalMargin_m < 0);
  assert.ok(Math.abs(measured.finalLocalPosition_m[0] - 0.05) < 1e-8);
  assert.ok(Math.abs(measured.finalLocalPosition_m[1] - 0.02) < 1e-8);
});

test('a missing sample cannot establish a final hold', () => {
  const trace = makeTrace([[0.01, 0.02, 0], [0.01, 0.02, 0], [0.01, 0.02, 0]]);
  trace.frames.splice(1, 1);
  assert.equal(measureEndIn(trace, goal), null);
});


test('scrubbing a pass-through shows a hold while inside, then resets when the payload leaves', () => {
  const inside: Vec3 = [0.01, 0.02, 0];
  const outside: Vec3 = [0.05, 0.02, 0];
  const samples = sampleReceiverOccupancy(makeTrace([outside, inside, inside, outside, inside]), goal);
  assert.ok(samples);
  assert.equal(receiverOccupancyAt(samples, 0.05)?.inside, false);
  assert.equal(receiverOccupancyAt(samples, 0.25)?.inside, true);
  assert.equal(receiverOccupancyAt(samples, 0.25)?.hold_s, 0.1);
  assert.equal(receiverOccupancyAt(samples, 0.35)?.inside, false);
  assert.equal(receiverOccupancyAt(samples, 0.35)?.hold_s, 0);
  assert.equal(receiverOccupancyAt(samples, 0.4)?.inside, true);
  assert.equal(receiverOccupancyAt(samples, 0.4)?.hold_s, 0);
});

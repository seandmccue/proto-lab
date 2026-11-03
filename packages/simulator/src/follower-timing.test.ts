import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Trace } from '@protolab/schema';
import { measureFollowerTiming } from './follower-timing.ts';

const dt = 0.1;
const measurement = { shaft: 'shaft', followers: ['a', 'b'] as ['a', 'b'], axis: 'y' as const };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `expected ${expected}, got ${actual}`);
const traceWithLowSamples = (...low: number[]): Trace => ({
  dt,
  frames: Array.from({ length: 33 }, (_, n) => ({
    t: n * dt,
    joints: { shaft: n * Math.PI / 4 },
    bodies: {
      a: { position: [0, low.includes(n) ? 0 : 0.02, 0], rotation: [0, 0, 0, 1] },
      b: { position: [0, n % 8 === 5 ? 0.02 : 0, 0], rotation: [0, 0, 0, 1] },
    },
  })),
});

test('low samples at opposite ends of the same turn do not create a fictitious hold', () => {
  const [cycle] = measureFollowerTiming(traceWithLowSamples(8, 9, 14, 15), measurement);
  near(cycle.flags[0].lowDwell_s, 0.1);
});

test('real samples across a turn boundary count once, in the turn containing their midpoint', () => {
  const cycles = measureFollowerTiming(traceWithLowSamples(13, 14, 15, 16, 17, 18, 19), measurement);
  near(cycles[0].flags[0].lowDwell_s, 0);
  near(cycles[1].flags[0].lowDwell_s, 0.6);
});

test('a gap in recorded samples cannot bridge a low interval', () => {
  const trace = traceWithLowSamples(8, 9, 10, 11, 12, 13);
  trace.frames.splice(10, 1);
  const [cycle] = measureFollowerTiming(trace, measurement);
  near(cycle.flags[0].lowDwell_s, 0.2);
});

test('three staggered peaks produce all neighboring gaps, including across the turn boundary', () => {
  const dt = 0.05;
  const frames: Trace['frames'] = Array.from({ length: 48 }, (_, n) => ({
    t: n * dt,
    joints: { shaft: 1 - n * Math.PI / 6 },
    bodies: Object.fromEntries(['a', 'b', 'c'].map((id, index) => [id, {
      // Deliberately omit phase ordering from the follower list and change one
      // peak in the second measured turn so each turn must be read separately.
      position: [0, n % 12 === ([9, 1, n >= 24 ? 6 : 5][index]) ? 0.02 : 0, 0],
      rotation: [0, 0, 0, 1],
    }])),
  }));
  const cycles = measureFollowerTiming({ dt, frames }, { ...measurement, followers: ['a', 'b', 'c'] });
  assert.equal(cycles.length, 2);
  for (const gap of cycles[0].phaseGaps_deg) near(gap, 120);
  assert.deepEqual(cycles[1].phaseGaps_deg.map(Math.round), [150, 90, 120]);
  near(cycles[1].phaseGap_deg, 90);
});

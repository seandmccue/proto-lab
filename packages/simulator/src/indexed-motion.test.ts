import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Trace } from '@protolab/schema';
import { measureIndexedMotion, type IndexedMotion } from './indexed-motion.ts';

const spec: IndexedMotion = {
  input: 'shaft', body: 'marker', center: 'center', plane: 'xz',
  step_deg: 90, stepTolerance_deg: 8, minDwell_s: 0.4, maxDwellDrift_deg: 3,
};

function trace(input: (t: number) => number, output: (t: number) => number): Trace {
  const dt = 0.02;
  return { dt, frames: Array.from({ length: 411 }, (_, index) => {
    const t = index * dt;
    const angle = output(t) * Math.PI / 180;
    return {
      t, joints: { shaft: input(t) * Math.PI / 180 },
      bodies: {
        center: { position: [0.01 * t, 0.1, 0], rotation: [0, 0, 0, 1] },
        marker: { position: [0.01 * t + 0.05 * Math.cos(angle), 0.1, 0.05 * Math.sin(angle)], rotation: [0, 0, 0, 1] },
      },
    };
  }) };
}

const cycleProgress = (t: number) => Math.floor(t) + Math.max(0, Math.min(1, (t % 1 - 0.45) / 0.2));
const indexAngle = (t: number) => 90 * cycleProgress(t);

test('counts repeated quarter-turn steps between real dwells with either driver direction', () => {
  for (const sign of [1, -1]) {
    const result = measureIndexedMotion(trace((t) => sign * 360 * t, indexAngle), spec);
    assert.ok(result);
    assert.equal(result.consecutiveSteps, 8);
    assert.ok(result.steps.every((step) => Math.abs(step.angle_deg - 90) < 2));
    assert.ok(result.holds.every((hold) => hold.duration_s >= 0.4 && hold.inputAdvance_deg > 100 && hold.drift_deg <= 3));
  }
});

test('rejects steady output motion, a paused input, and the wrong step cadence', () => {
  const invalid = [
    trace((t) => 360 * t, (t) => 90 * t),
    trace(() => 0, indexAngle),
    trace((t) => 360 * cycleProgress(t), indexAngle),
    trace((t) => 720 * t, indexAngle),
    trace((t) => 180 * t, indexAngle),
  ];
  for (const sample of invalid) assert.equal(measureIndexedMotion(sample, spec)?.consecutiveSteps, 0);
  const loose = { ...spec, minDwell_s: 0.1, maxDwellDrift_deg: 30 };
  assert.equal(measureIndexedMotion(invalid[0], loose)?.consecutiveSteps, 0);
});

test('alternating reversals and overshooting transitions cannot count as indexing', () => {
  const oscillating = (t: number) => Math.floor(t) % 2 ? 180 - indexAngle(t % 1) : 90 + indexAngle(t % 1);
  assert.equal(measureIndexedMotion(trace((t) => 360 * t, oscillating), spec)?.consecutiveSteps, 0);
  const overshoot = (t: number) => {
    const phase = t % 1;
    const extra = phase >= 0.53 && phase <= 0.65 ? 55 * (1 - Math.abs(phase - 0.59) / 0.06) : 0;
    return indexAngle(t) + extra;
  };
  assert.equal(measureIndexedMotion(trace((t) => 360 * t, overshoot), spec)?.consecutiveSteps, 0);
});

test('missing observations and an input reversal invalidate the trace', () => {
  const reversed = trace((t) => 360 * (t < 4 ? t : 8 - t) + t, indexAngle);
  assert.equal(measureIndexedMotion(reversed, spec), null);
  const missing = trace((t) => 360 * t, indexAngle);
  missing.frames.splice(150, 1);
  assert.equal(measureIndexedMotion(missing, spec), null);
  const noDriver = trace((t) => 360 * t, indexAngle);
  delete noDriver.frames[50].joints.shaft;
  assert.equal(measureIndexedMotion(noDriver, spec), null);
});

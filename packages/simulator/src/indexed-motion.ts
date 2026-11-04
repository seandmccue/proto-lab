import type { Trace } from '@protolab/schema';
import { measurePlanarOrbit, type PlanarOrbit } from './planar-orbit.ts';

export type IndexedMotion = Pick<PlanarOrbit, 'body' | 'center' | 'plane'> & {
  input: string;
  step_deg: number;
  stepTolerance_deg: number;
  minDwell_s: number;
  maxDwellDrift_deg: number;
};

type Sample = { t: number; input_deg: number; output_deg: number };
type Hold = { start_s: number; end_s: number; duration_s: number; drift_deg: number; inputAdvance_deg: number };
type Step = { start_s: number; end_s: number; angle_deg: number; inputSpacing_deg: number | null; valid: boolean };
export type IndexedMotionResult = { consecutiveSteps: number; steps: Step[]; holds: Hold[]; series: Sample[] };

const deg = 180 / Math.PI;
const fullTurn_deg = 360;
const turnTolerance_deg = 45;
const inputJitter_deg = 2;
const minDwellInputAdvance_deg = 15;
const epsilon = 1e-8;

/** Observe an indexed output during continuous input rotation. Each credited
 * transition connects distinct measured dwells and repeats at the driver's period. */
export function measureIndexedMotion(trace: Trace, spec: IndexedMotion): IndexedMotionResult | null {
  const { input, step_deg, stepTolerance_deg, minDwell_s, maxDwellDrift_deg } = spec;
  if (![step_deg, stepTolerance_deg, minDwell_s, maxDwellDrift_deg].every(Number.isFinite) ||
    step_deg <= 0 || stepTolerance_deg < 0 || stepTolerance_deg >= step_deg || minDwell_s <= 0 || maxDwellDrift_deg < 0) return null;
  const orbit = measurePlanarOrbit(trace, spec);
  if (!orbit) return null;
  const rawInput = trace.frames.map((frame) => frame.joints[input] * deg);
  if (!rawInput.every(Number.isFinite)) return null;
  const direction = Math.sign(rawInput.at(-1)! - rawInput[0]);
  const samples: Sample[] = [];
  let inputPeak = 0;
  let outputAngle = 0;
  for (const [index, point] of orbit.points.entries()) {
    const inputAngle = (rawInput[index] - rawInput[0]) * direction;
    const previous = orbit.points[index - 1];
    if (previous) {
      if (Math.abs(rawInput[index] - rawInput[index - 1]) >= 180 || inputAngle < inputPeak - inputJitter_deg) return null;
      const cross = previous.u_m * point.v_m - previous.v_m * point.u_m;
      const dot = previous.u_m * point.u_m + previous.v_m * point.v_m;
      outputAngle += Math.atan2(cross, dot) * deg;
    }
    inputPeak = Math.max(inputPeak, inputAngle);
    samples.push({ t: point.t, input_deg: inputAngle, output_deg: outputAngle });
  }

  const holds: Hold[] = [];
  const plateaus: { first: number; last: number; level: number }[] = [];
  const minStep = step_deg - stepTolerance_deg;
  for (let first = 0; first < samples.length - 1;) {
    const start = samples[first];
    let low = start.output_deg, high = start.output_deg, sum = start.output_deg;
    let last = first;
    // Find an uninterrupted band, using peak-to-peak drift rather than just its endpoints.
    for (let index = first + 1; index < samples.length; index++) {
      const angle = samples[index].output_deg;
      const nextLow = Math.min(low, angle), nextHigh = Math.max(high, angle);
      if (nextHigh - nextLow > maxDwellDrift_deg + epsilon) break;
      low = nextLow;
      high = nextHigh;
      sum += angle;
      last = index;
    }
    const end = samples[last];
    const duration_s = end.t - start.t;
    const inputAdvance_deg = end.input_deg - start.input_deg;
    const drift_deg = high - low;
    // A slow continuous reduction ratio cannot qualify as a dwell, even with loose drift limits.
    const slowDriftLimit = (minStep * inputAdvance_deg) / (2 * fullTurn_deg);
    if (duration_s + epsilon >= minDwell_s && inputAdvance_deg + epsilon >= minDwellInputAdvance_deg &&
      drift_deg <= slowDriftLimit + epsilon) {
      holds.push({ start_s: start.t, end_s: end.t, duration_s, drift_deg, inputAdvance_deg });
      plateaus.push({ first, last, level: sum / (last - first + 1) });
      first = last + 1;
    } else {
      first++;
    }
  }

  const steps: Step[] = [];
  let previousStepPhase: number | null = null;
  let streak = 0;
  let consecutiveSteps = 0;
  for (let index = 1; index < plateaus.length; index++) {
    const before = plateaus[index - 1], after = plateaus[index];
    const start = samples[before.last], end = samples[after.first];
    const angle_deg = after.level - before.level;
    const sign = Math.sign(angle_deg);
    const phase = (start.input_deg + end.input_deg) / 2;
    const inputSpacing_deg = previousStepPhase === null ? null : phase - previousStepPhase;
    let peak = start.output_deg * sign;
    let monotone = true;
    for (let frame = before.last + 1; frame <= after.first; frame++) {
      const progress = samples[frame].output_deg * sign;
      if (progress < peak - maxDwellDrift_deg - epsilon) monotone = false;
      peak = Math.max(peak, progress);
    }
    const valid = monotone && Math.abs(Math.abs(angle_deg) - step_deg) <= stepTolerance_deg + epsilon &&
      end.input_deg - start.input_deg < fullTurn_deg - minDwellInputAdvance_deg;
    const repeats = inputSpacing_deg !== null && Math.abs(inputSpacing_deg - fullTurn_deg) <= turnTolerance_deg &&
      Math.sign(steps.at(-1)?.angle_deg ?? 0) === sign;
    streak = valid ? (repeats ? streak + 1 : 1) : 0;
    // An isolated transition cannot establish repeatability.
    if (streak >= 2) consecutiveSteps = Math.max(consecutiveSteps, streak);
    steps.push({ start_s: start.t, end_s: end.t, angle_deg, inputSpacing_deg, valid });
    previousStepPhase = phase;
  }
  return { consecutiveSteps, steps, holds, series: samples };
}

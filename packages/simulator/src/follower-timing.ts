import type { TestSpec, Trace } from '@protolab/schema';

type Timing = NonNullable<Extract<TestSpec, { kind: 'motion' }>['measure']['followerTiming']>;
type Measurement = Pick<Timing, 'shaft' | 'followers' | 'axis'>;

const revolution = 2 * Math.PI;
const lowBand_m = 0.001;

/** Measure complete turns after the first turn, using the recorded shaft and follower poses. */
export function measureFollowerTiming(trace: Trace, { shaft, followers, axis }: Measurement) {
  const first = trace.frames[0]?.joints[shaft];
  const last = trace.frames.at(-1)?.joints[shaft];
  if (first === undefined || last === undefined || !Number.isFinite(trace.dt) || trace.dt <= 0) return [];
  const direction = Math.sign(last - first);
  const coordinate = { x: 0, y: 1, z: 2 }[axis];
  const timeline: { angle: number; progress: number; t: number; positions: number[] }[] = [];
  const turns = new Map<number, typeof timeline>();
  let peak = 0;
  for (const frame of trace.frames) {
    const shaftAngle = frame.joints[shaft];
    const positions = followers.map((id) => frame.bodies[id]?.position[coordinate]);
    if (!Number.isFinite(shaftAngle) || positions.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(frame.t) || frame.t <= (timeline.at(-1)?.t ?? -Infinity)) return [];
    const angle = (shaftAngle - first) * direction;
    // Tiny solver jitter is tolerated. A reversal invalidates the continuous-cycle measurement.
    if (angle < peak - 0.03) return [];
    peak = Math.max(angle, peak);
    const turn = Math.floor(peak / revolution);
    const samples = turns.get(turn) ?? [];
    const sample = { angle, progress: peak, t: frame.t, positions };
    samples.push(sample);
    timeline.push(sample);
    turns.set(turn, samples);
  }

  const cycles = [];
  const creditedThrough = followers.map(() => -Infinity);
  const completeTurns = Math.floor(peak / revolution);
  for (let turn = 1; turn < completeTurns; turn++) {
    const samples = turns.get(turn);
    if (!samples || samples.length < 4) return [];
    const flags = followers.map((id, index) => {
      const positions = samples.map((sample) => sample.positions[index]);
      const min = Math.min(...positions);
      const max = Math.max(...positions);
      let start = 0;
      let longest = 0;
      let creditedUntil = creditedThrough[index];
      const consider = (from: number, to: number) => {
        if (from >= creditedThrough[index] && to - from > longest) {
          longest = to - from;
          creditedUntil = to;
        }
      };
      const startAngle = turn * revolution;
      const endAngle = startAngle + revolution;
      const record = (end: number) => {
        if (end <= start) return;
        const from = timeline[start], to = timeline[end];
        const span = to.progress - from.progress;
        if (span >= revolution) {
          // A hold spanning an entire turn can only contribute observed time within this turn.
          const inside = samples.filter(({ t }) => t >= from.t && t <= to.t);
          if (inside.length > 1) consider(inside[0].t, inside.at(-1)!.t);
          return;
        }
        // A short hold belongs to the turn containing its angular midpoint. It can
        // borrow real samples across either edge, but cannot fill two turns.
        const middle = from.progress + span / 2;
        if (middle >= startAngle && middle < endAngle) consider(from.t, to.t);
      };
      for (let n = 0; n < timeline.length; n++) {
        const sample = timeline[n];
        if (sample.positions[index] - min > lowBand_m) {
          record(n - 1);
          start = n + 1;
        } else if (n > start && sample.t - timeline[n - 1].t > 1.5 * trace.dt) {
          // Missing observations cannot establish an uninterrupted hold.
          record(n - 1);
          start = n;
        }
      }
      record(timeline.length - 1);
      creditedThrough[index] = creditedUntil;
      return {
        id,
        stroke_m: max - min,
        lowDwell_s: longest,
        peakAngle_rad: samples[positions.indexOf(max)].angle - turn * revolution,
      };
    });
    const peaks = flags.map(({ peakAngle_rad }) => ((peakAngle_rad % revolution) + revolution) % revolution)
      .sort((a, b) => a - b);
    const adjacentGaps = peaks.map((angle, index) => (peaks[index + 1] ?? peaks[0] + revolution) - angle);
    // With two followers, phase separation has always meant the shorter arc.
    const phaseGaps_deg = (peaks.length === 2 ? [Math.min(...adjacentGaps)] : adjacentGaps)
      .map((gap) => gap * 180 / Math.PI);
    cycles.push({ flags, phaseGap_deg: Math.min(...phaseGaps_deg), phaseGaps_deg });
  }
  return cycles;
}

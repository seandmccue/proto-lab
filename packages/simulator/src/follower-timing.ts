import type { TestSpec, Trace } from '@protolab/schema';

type Timing = NonNullable<Extract<TestSpec, { kind: 'motion' }>['measure']['followerTiming']>;
type Measurement = Pick<Timing, 'shaft' | 'followers' | 'axis'>;

const revolution = 2 * Math.PI;
const lowBand_m = 0.001;

/** Measure complete turns after the first turn, using the recorded shaft and follower poses. */
export function measureFollowerTiming(trace: Trace, { shaft, followers, axis }: Measurement) {
  const first = trace.frames[0]?.joints[shaft];
  const last = trace.frames.at(-1)?.joints[shaft];
  if (first === undefined || last === undefined || trace.dt <= 0) return [];
  const direction = Math.sign(last - first);
  const coordinate = { x: 0, y: 1, z: 2 }[axis];
  const turns = new Map<number, { angle: number; positions: number[] }[]>();
  let peak = 0;
  for (const frame of trace.frames) {
    const shaftAngle = frame.joints[shaft];
    const positions = followers.map((id) => frame.bodies[id]?.position[coordinate]);
    if (shaftAngle === undefined || positions.some((value) => value === undefined)) return [];
    const angle = (shaftAngle - first) * direction;
    // Tiny solver jitter is tolerated. A reversal invalidates the continuous-cycle measurement.
    if (angle < peak - 0.03) return [];
    peak = Math.max(angle, peak);
    const turn = Math.floor(peak / revolution);
    const samples = turns.get(turn) ?? [];
    samples.push({ angle, positions });
    turns.set(turn, samples);
  }

  const cycles = [];
  const completeTurns = Math.floor(peak / revolution);
  for (let turn = 1; turn < completeTurns; turn++) {
    const samples = turns.get(turn);
    if (!samples || samples.length < 4) return [];
    const flags = followers.map((id, index) => {
      const positions = samples.map((sample) => sample.positions[index]);
      const min = Math.min(...positions);
      const max = Math.max(...positions);
      let streak = 0;
      let longest = 0;
      // A low interval may wrap across the revolution boundary.
      for (const position of [...positions, ...positions]) {
        streak = position - min <= lowBand_m ? streak + 1 : 0;
        longest = Math.min(samples.length, Math.max(longest, streak));
      }
      return {
        id,
        stroke_m: max - min,
        lowDwell_s: longest * trace.dt,
        peakAngle_rad: samples[positions.indexOf(max)].angle - turn * revolution,
      };
    });
    const gap = Math.abs(flags[0].peakAngle_rad - flags[1].peakAngle_rad) % revolution;
    cycles.push({ flags, phaseGap_deg: Math.min(gap, revolution - gap) * 180 / Math.PI });
  }
  return cycles;
}

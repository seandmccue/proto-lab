import { receiverChecks, type TestResult, type TestSpec } from '@protolab/schema';

/** Give Muse a small set of actual observations to locate a missed transfer. */
export function failedReceiverPaths(spec: TestSpec, result: TestResult) {
  if (spec.kind !== 'motion' || result.passed || !result.trace.frames.length) return [];
  const frames = result.trace.frames;
  const count = Math.min(7, frames.length);
  const indices = [...new Set(Array.from({ length: count }, (_, index) =>
    Math.round(index * (frames.length - 1) / Math.max(1, count - 1))))];
  return receiverChecks(spec.measure.endIn)
    .filter(({ check, holdKey }) => !(result.metrics[holdKey] + 1e-8 >= check.minHold_s))
    .map(({ check }) => {
      // A fast fall can occur entirely between uniform samples. Include the
      // actual pair with the fastest observed downward motion as well.
      const selected = new Set(indices);
      let fastestFall = 0;
      let fallEnd = -1;
      for (let index = 1; index < frames.length; index++) {
        const before = frames[index - 1], after = frames[index];
        const a = before.bodies[check.instance]?.position[1], b = after.bodies[check.instance]?.position[1];
        if (a === undefined || b === undefined || after.t <= before.t) continue;
        const velocity = (b - a) / (after.t - before.t);
        if (Number.isFinite(velocity) && velocity < fastestFall) { fastestFall = velocity; fallEnd = index; }
      }
      if (fallEnd > 0) { selected.add(fallEnd - 1); selected.add(fallEnd); }
      return {
        instance: check.instance,
        receiver: check.receiver,
        columns: ['time_s', 'world_x_m', 'world_y_m', 'world_z_m'],
        // Missing observations stay explicit; never interpolate a successful transfer.
        samples: [...selected].sort((a, b) => a - b).map((index) => {
          const frame = frames[index];
          const point = frame.bodies[check.instance]?.position;
          return [frame.t, ...(point ?? [null, null, null])].map((value) =>
            value !== null && Number.isFinite(value) ? +value.toFixed(5) : null);
        }),
        note: 'Selected recorded samples, not a continuous path. Use the test metrics for final occupancy.',
      };
    });
}

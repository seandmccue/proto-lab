import { invert, transformPoint } from '@protolab/parts';
import type { ReceiverCheck, Trace, Vec3 } from '@protolab/schema';

interface ReceiverSample {
  t: number;
  inside: boolean;
  hold_s: number;
  margin_m: number;
  localPosition_m: Vec3;
}

/** Read occupancy and the current uninterrupted hold at each recorded sample. */
export function sampleReceiverOccupancy(trace: Trace, { instance, receiver, centerOffset_m = [0, 0, 0], halfExtents_m }: ReceiverCheck): ReceiverSample[] | null {
  if (!Number.isFinite(trace.dt) || trace.dt <= 0 || trace.frames.length < 2) return null;
  let previousTime = -Infinity;
  let insideSince: number | undefined;
  const samples: ReceiverSample[] = [];
  for (const { t, bodies } of trace.frames) {
    const point = bodies[instance]?.position;
    const frame = bodies[receiver];
    if (!point || !frame || !Number.isFinite(t) || t <= previousTime ||
        (previousTime !== -Infinity && t - previousTime > trace.dt * 1.5)) return null;
    const localPosition_m = transformPoint(invert(frame), point);
    const margin_m = Math.min(...localPosition_m.map((value, axis) => halfExtents_m[axis] - Math.abs(value - centerOffset_m[axis])));
    if (!Number.isFinite(margin_m)) return null;
    const inside = margin_m >= 0;
    insideSince = inside ? insideSince ?? t : undefined;
    samples.push({ t, inside, hold_s: insideSince === undefined ? 0 : t - insideSince, margin_m, localPosition_m });
    previousTime = t;
  }
  return samples;
}

/** Credit the last observed sample at or before the scrubber, without extrapolating. */
export function receiverOccupancyAt(samples: ReceiverSample[], time: number): ReceiverSample | undefined {
  for (let index = samples.length - 1; index >= 0; index--) {
    if (samples[index].t <= time) return samples[index];
  }
}

/** Measure the uninterrupted final interval that the tracked point is in the receiver's local box. */
export function measureEndIn(trace: Trace, check: ReceiverCheck) {
  const last = sampleReceiverOccupancy(trace, check)?.at(-1);
  return last ? { hold_s: last.hold_s, finalMargin_m: last.margin_m, finalLocalPosition_m: last.localPosition_m } : null;
}

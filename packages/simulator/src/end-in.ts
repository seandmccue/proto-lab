import { invert, transformPoint } from '@protolab/parts';
import type { ReceiverCheck, Trace, Vec3 } from '@protolab/schema';

/** Measure the uninterrupted final interval that the tracked point is in the receiver's local box. */
export function measureEndIn(trace: Trace, { instance, receiver, centerOffset_m = [0, 0, 0], halfExtents_m }: ReceiverCheck) {
  if (!Number.isFinite(trace.dt) || trace.dt <= 0 || trace.frames.length < 2) return null;
  let previousTime = -Infinity;
  let insideSince: number | undefined;
  let finalMargin_m = -Infinity;
  let finalLocalPosition_m: Vec3 = [0, 0, 0];
  for (const { t, bodies } of trace.frames) {
    const point = bodies[instance]?.position;
    const frame = bodies[receiver];
    if (!point || !frame || !Number.isFinite(t) || t <= previousTime ||
        (previousTime !== -Infinity && t - previousTime > trace.dt * 1.5)) return null;
    finalLocalPosition_m = transformPoint(invert(frame), point);
    finalMargin_m = Math.min(...finalLocalPosition_m.map((value, axis) => halfExtents_m[axis] - Math.abs(value - centerOffset_m[axis])));
    if (!Number.isFinite(finalMargin_m)) return null;
    insideSince = finalMargin_m >= 0 ? insideSince ?? t : undefined;
    previousTime = t;
  }
  return { hold_s: insideSince === undefined ? 0 : previousTime - insideSince, finalMargin_m, finalLocalPosition_m };
}

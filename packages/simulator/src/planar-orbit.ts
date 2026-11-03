import { quatConj, rotate, sub } from '@protolab/parts';
import type { Quat, Trace } from '@protolab/schema';

const planes = { xy: [0, 1], xz: [0, 2], yz: [1, 2] } as const;
const minRadius_m = 1e-8;

export type PlanarOrbit = {
  body: string;
  center: string;
  plane: keyof typeof planes;
  /** Quaternion of a reference instance, or a direction between two recorded instances. */
  reference?: string | { from: string; to: string };
};

type PlanarPoint = { t: number; u_m: number; v_m: number };

/**
 * Measure signed net winding around the recorded center, with a positive turn
 * from the first named axis toward the second. Samples must resolve movement
 * below half a turn per frame. A missing or ambiguous sample invalidates winding.
 */
export function measurePlanarOrbit(trace: Trace, { body, center, plane, reference }: PlanarOrbit) {
  if (!Number.isFinite(trace.dt) || trace.dt <= 0 || trace.frames.length < 2) return null;
  const [u, v] = planes[plane];
  const points: PlanarPoint[] = [];
  let minRadius = Infinity;
  let maxRadius = 0;
  let angle = 0;

  for (const { t, bodies } of trace.frames) {
    const position = bodies[body]?.position;
    const origin = bodies[center]?.position;
    if (!position || !origin || !Number.isFinite(t)) return null;
    let displacement = sub(position, origin);
    if (typeof reference === 'string') {
      const rotation = bodies[reference]?.rotation;
      if (!rotation) return null;
      const magnitude = Math.hypot(...rotation);
      if (!Number.isFinite(magnitude) || magnitude === 0) return null;
      const unit = rotation.map((value) => value / magnitude) as Quat;
      displacement = rotate(quatConj(unit), displacement);
    }

    let x = displacement[u], y = displacement[v];
    if (reference && typeof reference !== 'string') {
      const from = bodies[reference.from]?.position;
      const to = bodies[reference.to]?.position;
      if (!from || !to) return null;
      const direction = sub(to, from);
      const length = Math.hypot(direction[u], direction[v]);
      if (!Number.isFinite(length) || length < minRadius_m) return null;
      const cos = direction[u] / length, sin = direction[v] / length;
      [x, y] = [cos * x + sin * y, -sin * x + cos * y];
    }

    const radius = Math.hypot(x, y);
    if (!Number.isFinite(radius) || radius < minRadius_m) return null;
    const previous = points.at(-1);
    if (previous) {
      if (t <= previous.t || t - previous.t > 1.5 * trace.dt) return null;
      const cross = previous.u_m * y - previous.v_m * x;
      const dot = previous.u_m * x + previous.v_m * y;
      const step = Math.atan2(cross, dot);
      if (Math.abs(step) > Math.PI - 1e-8) return null;
      angle += step;
    }
    minRadius = Math.min(minRadius, radius);
    maxRadius = Math.max(maxRadius, radius);
    points.push({ t, u_m: x, v_m: y });
  }

  return { points, signedTurns: angle / (2 * Math.PI), minRadius_m: minRadius, maxRadius_m: maxRadius };
}

import { extrudePoint, polygonArea } from '@protolab/parts';
import type { Shape, Vec2, Vec3 } from '@protolab/schema';

const epsilon = 1e-12;
const turn = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
const between = (point: Vec2, a: Vec2, b: Vec2) => point.every((v, axis) => v >= Math.min(a[axis], b[axis]) - epsilon && v <= Math.max(a[axis], b[axis]) + epsilon);

function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b);
  if (Math.abs(abC) <= epsilon && between(c, a, b) || Math.abs(abD) <= epsilon && between(d, a, b) ||
      Math.abs(cdA) <= epsilon && between(a, c, d) || Math.abs(cdB) <= epsilon && between(b, c, d)) return true;
  return (abC > epsilon && abD < -epsilon || abC < -epsilon && abD > epsilon) &&
    (cdA > epsilon && cdB < -epsilon || cdA < -epsilon && cdB > epsilon);
}

function convexProfiles(profile: Vec2[]): Vec2[][] {
  const points = profile.filter((point, i) => i === 0 || !same(point, profile[i - 1]));
  if (points.length > 1 && same(points[0], points[points.length - 1])) points.pop();
  // Removing collinear intermediate vertices leaves the rendered solid unchanged.
  for (let i = points.length - 1; i >= 0 && points.length > 3; i--) {
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    if (Math.abs(turn(previous, points[i], next)) <= epsilon && between(points[i], previous, next)) points.splice(i, 1);
  }
  if (points.length < 3) return [];
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(points[i], points[next], points[j], points[(j + 1) % points.length])) return [];
    }
  }
  const area = polygonArea(points);
  if (Math.abs(area) <= epsilon) return [];
  if (area < 0) points.reverse();
  if (points.every((point, i) => turn(points[(i + points.length - 1) % points.length], point, points[(i + 1) % points.length]) > epsilon)) return [points];

  const triangles: Vec2[][] = [];
  while (points.length > 3) {
    let ear = -1;
    for (let i = 0; i < points.length; i++) {
      const prev = (i + points.length - 1) % points.length, next = (i + 1) % points.length;
      const a = points[prev], b = points[i], c = points[next];
      if (turn(a, b, c) <= epsilon || points.some((p, j) => j !== prev && j !== i && j !== next &&
        turn(a, b, p) >= -epsilon && turn(b, c, p) >= -epsilon && turn(c, a, p) >= -epsilon)) continue;
      triangles.push([a, b, c]);
      ear = i;
      break;
    }
    if (ear < 0) return [];
    points.splice(ear, 1);
  }
  if (turn(points[0], points[1], points[2]) <= epsilon) return [];
  return [...triangles, points];
}

/** Convex volume cells for the same segmented solid as the viewer's extrude or lathe. */
export function profileCells(shape: Extract<Shape, { kind: 'extrude' | 'revolve' }>): Vec3[][] {
  const profiles = convexProfiles(shape.profile);
  if (shape.kind === 'extrude') return profiles.map((profile) => profile.flatMap((point) => [
    extrudePoint(shape.axis, point, -shape.depth / 2), extrudePoint(shape.axis, point, shape.depth / 2),
  ]));
  if (shape.profile.some(([radius]) => radius < 0)) return [];
  // A convex profile swept between adjacent angular rays is convex: in the basis
  // of those rays it is the profile at r = a + b, intersected with a,b >= 0.
  const lathePoint = ([r, h]: Vec2, angle: number): Vec3 => {
    const x = r * Math.sin(angle), z = r * Math.cos(angle);
    if (shape.axis === 'x') return [h, -x, z];
    if (shape.axis === 'z') return [x, -z, h];
    return [x, h, z];
  };
  const cells: Vec3[][] = [];
  for (let i = 0; i < shape.segments; i++) {
    const start = (i / shape.segments) * Math.PI * 2;
    const end = (((i + 1) % shape.segments) / shape.segments) * Math.PI * 2;
    for (const profile of profiles) cells.push(profile.flatMap((point) => [lathePoint(point, start), lathePoint(point, end)]));
  }
  return cells;
}

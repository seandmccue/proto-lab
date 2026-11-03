import type { Axis, Profile, Shape, Vec2, Vec3 } from '@protolab/schema';

// Browser-safe copies of the profile helpers in packages/parts/src/geometry.ts. The web app deliberately does not import
// '@protolab/parts': its index re-exports node-only modules (external/manifest.ts touches node:fs at load time).

export function polygonArea(p: Profile): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}
export function ensureCCW(p: Profile): Profile { return polygonArea(p) < 0 ? [...p].reverse() : p; }

/** Map a 2D profile point + depth coordinate into the shape's local 3D frame for extrusions (matches parts/geometry.ts). */
export function extrudePoint(axis: Axis, [u, v]: Vec2, w: number): Vec3 {
  return axis === 'z' ? [u, v, w] : axis === 'y' ? [u, w, v] : [w, u, v];
}

function profileBounds(p: Profile) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, maxX, minY, maxY };
}

/** Axis-aligned half extents of a shape in its own frame. */
export function shapeHalfExtents(s: Shape): Vec3 {
  const ax = (axis: Axis, along: number, across: number): Vec3 => axis === 'x' ? [along, across, across] : axis === 'y' ? [across, along, across] : [across, across, along];
  switch (s.kind) {
    case 'box': return [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2];
    case 'cylinder': return ax(s.axis, s.height / 2, s.radius);
    case 'sphere': return [s.radius, s.radius, s.radius];
    case 'capsule': return ax(s.axis, s.height / 2 + s.radius, s.radius);
    case 'ellipsoid': return [s.radii[0], s.radii[1], s.radii[2]];
    case 'extrude': { const b = profileBounds(s.profile); const e = Math.max(Math.abs(b.minX), Math.abs(b.maxX)), f = Math.max(Math.abs(b.minY), Math.abs(b.maxY)); return s.axis === 'z' ? [e, f, s.depth / 2] : s.axis === 'y' ? [e, s.depth / 2, f] : [s.depth / 2, e, f]; }
    case 'revolve': { const b = profileBounds(s.profile); const r = Math.max(Math.abs(b.minX), Math.abs(b.maxX)), h = Math.max(Math.abs(b.minY), Math.abs(b.maxY)); return ax(s.axis, h, r); }
  }
}

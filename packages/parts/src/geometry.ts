import type { Shape, Profile, Vec2, Vec3, Axis, GeometryPiece } from '@protolab/schema';
import { quatFromAxisAngle, QUAT_ID, rotate, add } from './math.ts';

// ---------- Profile helpers (2D, metres, counter-clockwise) ----------
export function polygonArea(p: Profile): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}
export function ensureCCW(p: Profile): Profile { return polygonArea(p) < 0 ? [...p].reverse() : p; }
export function profileBounds(p: Profile) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}
export function profileCentroid(p: Profile): Vec2 {
  let cx = 0, cy = 0; const a = polygonArea(p) || 1e-12;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; const f = x1 * y2 - x2 * y1; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  return [cx / (6 * a), cy / (6 * a)];
}

export const profiles = {
  rect(w: number, h: number): Profile { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; },
  roundedRect(w: number, h: number, r: number, seg = 4): Profile {
    r = Math.min(r, w / 2, h / 2); const pts: Vec2[] = [];
    const corners: Array<[number, number, number]> = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, 1.5 * Math.PI]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  },
  circle(r: number, n = 24): Profile { return Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Vec2); },
  ellipse(rx: number, ry: number, n = 32): Profile { return Array.from({ length: n }, (_, i) => [rx * Math.cos((2 * Math.PI * i) / n), ry * Math.sin((2 * Math.PI * i) / n)] as Vec2); },
  /** Annular arc band (curved panel section) between radii r0..r1 over angle span (rad), centred on +X. */
  arcBand(r0: number, r1: number, span: number, n = 12): Profile {
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) { const a = -span / 2 + (i / n) * span; pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]); }
    for (let i = n; i >= 0; i--) { const a = -span / 2 + (i / n) * span; pts.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }
    return pts;
  },
  /** Spur gear outline with visible teeth. */
  gear(teeth: number, module: number, n = 3): Profile {
    const pitch = (module * teeth) / 2, addendum = module, dedendum = 1.25 * module;
    const ro = pitch + addendum, ri = pitch - dedendum; const pts: Vec2[] = [];
    const step = (2 * Math.PI) / teeth;
    for (let t = 0; t < teeth; t++) {
      const a0 = t * step;
      const seq: Array<[number, number]> = [[ri, 0], [ri, 0.2], [ro, 0.3], [ro, 0.55], [ri, 0.65], [ri, 1.0]];
      for (const [r, f] of seq) { const a = a0 + f * step; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    }
    void n;
    return pts;
  },
  /** Butterfly-style wing outline: root at origin, span along +X, chord along Y. */
  wing(span: number, chord: number, kind: 'butterfly' | 'dragonfly' | 'blade' | 'bird' = 'butterfly'): Profile {
    const pts: Vec2[] = [];
    const N = 28;
    if (kind === 'butterfly') {
      // upper lobe (forewing) then lower lobe (hindwing), lobed outline
      for (let i = 0; i <= N; i++) { const u = i / N; const x = span * Math.sin((u * Math.PI) / 2); const y = chord * (0.55 * Math.sin(u * Math.PI) * (1 - 0.3 * u) + 0.05); pts.push([x, y]); }
      for (let i = N; i >= 0; i--) { const u = i / N; const x = span * 0.78 * Math.sin((u * Math.PI) / 2); const y = -chord * (0.5 * Math.sin(u * Math.PI) * (1 - 0.2 * u) + 0.03); pts.push([x, y]); }
      pts.push([0, -chord * 0.02]);
    } else if (kind === 'dragonfly') {
      for (let i = 0; i <= N; i++) { const u = i / N; pts.push([span * u, (chord / 2) * Math.sin(u * Math.PI) ** 0.6]); }
      for (let i = N; i >= 0; i--) { const u = i / N; pts.push([span * u, -(chord / 2) * Math.sin(u * Math.PI) ** 0.6]); }
    } else if (kind === 'bird') {
      for (let i = 0; i <= N; i++) { const u = i / N; pts.push([span * u, chord * (0.5 - 0.35 * u)]); }
      for (let i = N; i >= 0; i--) { const u = i / N; pts.push([span * u, -chord * (0.5 - 0.1 * u) * Math.sin(u * Math.PI) ** 0.3 - 0.02 * chord]); }
    } else {
      // tapered blade (propeller / windmill sail)
      for (let i = 0; i <= N; i++) { const u = i / N; pts.push([span * u, chord * (0.5 - 0.3 * u)]); }
      for (let i = N; i >= 0; i--) { const u = i / N; pts.push([span * u, -chord * (0.5 - 0.3 * u)]); }
    }
    return ensureCCW(dedupe(pts));
  },
  /** Hook / claw finger outline: root at origin, length along -Y, curving toward +X. */
  claw(length: number, width: number, curl = 0.35): Profile {
    const pts: Vec2[] = []; const N = 16;
    for (let i = 0; i <= N; i++) { const u = i / N; pts.push([curl * length * u * u + width / 2 * (1 - 0.5 * u), -length * u]); }
    for (let i = N; i >= 0; i--) { const u = i / N; pts.push([curl * length * u * u - width / 2 * (1 - 0.5 * u), -length * u]); }
    return ensureCCW(dedupe(pts));
  },
  /** I-beam section. */
  iBeam(w: number, h: number, t: number): Profile {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + t], [t / 2, -h / 2 + t], [t / 2, h / 2 - t], [w / 2, h / 2 - t], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, h / 2 - t], [-t / 2, h / 2 - t], [-t / 2, -h / 2 + t], [-w / 2, -h / 2 + t]];
  },
  /** Revolve profile (r, h) for a cone / frustum. */
  frustum(r0: number, r1: number, h: number): Profile { return [[0, -h / 2], [r0, -h / 2], [r1, h / 2], [0, h / 2]]; },
  /** Revolve profile for a rim / tyre cross-section. */
  rim(rOuter: number, rInner: number, width: number): Profile { return [[rInner, -width / 2], [rOuter, -width / 2], [rOuter, width / 2], [rInner, width / 2]]; },
  /** Revolve profile for a dome / bowl. */
  dome(r: number, h: number, n = 10): Profile { const pts: Vec2[] = [[0, 0]]; for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); pts.push([r * Math.cos(a), h * Math.sin(a)]); } return pts; },
};

function dedupe(p: Vec2[]): Vec2[] { const out: Vec2[] = []; for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) out.push(q); } if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop(); return out; }

// ---------- Volumes, bounds, hull points ----------
export function shapeVolume(s: Shape): number {
  switch (s.kind) {
    case 'box': return s.size[0] * s.size[1] * s.size[2];
    case 'cylinder': return Math.PI * s.radius ** 2 * s.height;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
    case 'capsule': return Math.PI * s.radius ** 2 * s.height + (4 / 3) * Math.PI * s.radius ** 3;
    case 'ellipsoid': return (4 / 3) * Math.PI * s.radii[0] * s.radii[1] * s.radii[2];
    case 'extrude': return Math.abs(polygonArea(s.profile)) * s.depth;
    case 'revolve': { // Pappus: V = 2π · r̄ · A for profile in (r, h)
      const a = Math.abs(polygonArea(s.profile)); const c = profileCentroid(s.profile); return 2 * Math.PI * Math.abs(c[0]) * a;
    }
  }
}

/** Axis-aligned half extents of a shape in its own frame. */
export function shapeHalfExtents(s: Shape): Vec3 {
  const ax = (axis: Axis, along: number, across: number): Vec3 => axis === 'x' ? [along, across, across] : axis === 'y' ? [across, along, across] : [across, across, along];
  switch (s.kind) {
    case 'box': return [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2];
    case 'cylinder': return ax(s.axis, s.height / 2, s.radius);
    case 'sphere': return [s.radius, s.radius, s.radius];
    case 'capsule': return ax(s.axis, s.height / 2 + s.radius, s.radius);
    case 'ellipsoid': return [...s.radii] as Vec3;
    case 'extrude': { const b = profileBounds(s.profile); const e = Math.max(Math.abs(b.minX), Math.abs(b.maxX)), f = Math.max(Math.abs(b.minY), Math.abs(b.maxY)); return s.axis === 'z' ? [e, f, s.depth / 2] : s.axis === 'y' ? [e, s.depth / 2, f] : [s.depth / 2, e, f]; }
    case 'revolve': { const b = profileBounds(s.profile); const r = Math.max(Math.abs(b.minX), Math.abs(b.maxX)), h = Math.max(Math.abs(b.minY), Math.abs(b.maxY)); return ax(s.axis, h, r); }
  }
}

/** Map a 2D profile point + depth coordinate into the shape's local 3D frame for extrusions. */
export function extrudePoint(axis: Axis, [u, v]: Vec2, w: number): Vec3 {
  return axis === 'z' ? [u, v, w] : axis === 'y' ? [u, w, v] : [w, u, v];
}

/** Sample points for a convex hull collider (extrude / revolve / ellipsoid). */
export function hullPoints(s: Shape): Vec3[] {
  if (s.kind === 'extrude') { const out: Vec3[] = []; for (const p of s.profile) { out.push(extrudePoint(s.axis, p, -s.depth / 2)); out.push(extrudePoint(s.axis, p, s.depth / 2)); } return out; }
  if (s.kind === 'revolve') {
    const out: Vec3[] = []; const n = Math.min(24, s.segments);
    for (const [r, h] of s.profile) for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; const x = r * Math.cos(a), z = r * Math.sin(a); out.push(s.axis === 'y' ? [x, h, z] : s.axis === 'x' ? [h, x, z] : [x, z, h]); }
    return out;
  }
  if (s.kind === 'ellipsoid') { const out: Vec3[] = []; for (let i = 0; i < 12; i++) for (let j = 1; j < 6; j++) { const a = (2 * Math.PI * i) / 12, b = (Math.PI * j) / 6; out.push([s.radii[0] * Math.cos(a) * Math.sin(b), s.radii[1] * Math.cos(b), s.radii[2] * Math.sin(a) * Math.sin(b)]); } out.push([0, s.radii[1], 0], [0, -s.radii[1], 0]); return out; }
  return [];
}

/** Rough world-space bounding radius of a piece list (for layout checks). */
export function piecesBoundingRadius(pieces: GeometryPiece[]): number {
  let r = 0;
  for (const p of pieces) { const h = shapeHalfExtents(p.shape); const c = p.offset.position; r = Math.max(r, Math.hypot(c[0], c[1], c[2]) + Math.hypot(h[0], h[1], h[2])); }
  return r;
}

export { quatFromAxisAngle, QUAT_ID, rotate, add };

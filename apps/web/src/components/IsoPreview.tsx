import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assembly, Transform, Trace } from '@protolab/schema';
import { ensureCCW, extrudePoint, shapeHalfExtents } from './shapeMath.ts';

/**
 * Dependency-free isometric SVG render of an assembly (painter's algorithm). Used for gallery cards so
 * the gallery stays animated without opening a WebGL context per card.
 */
type V = [number, number, number];
const YAW = 0.6, PITCH = 0.5;
const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
function view(p: V): V { // rotate world → view (x right, y up, z toward camera)
  const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
  return [x1, p[1] * cp - z1 * sp, p[1] * sp + z1 * cp];
}
const LIGHT: V = (() => { const l = view([0.5, 1, 0.4]); const n = Math.hypot(...l); return [l[0] / n, l[1] / n, l[2] / n]; })();

function rot(q: Transform['rotation'], p: V): V {
  const [qx, qy, qz, qw] = q; const [px, py, pz] = p;
  const tx = 2 * (qy * pz - qz * py), ty = 2 * (qz * px - qx * pz), tz = 2 * (qx * py - qy * px);
  return [px + qw * tx + (qy * tz - qz * ty), py + qw * ty + (qz * tx - qx * tz), pz + qw * tz + (qx * ty - qy * tx)];
}
function mulQ(a: Transform['rotation'], b: Transform['rotation']): Transform['rotation'] {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16); if (Number.isNaN(n)) return hex;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (0.55 + 0.5 * k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

interface Face { depth: number; points: V[]; color: string; kind: 'poly' | 'circle'; r?: number }

export function projectFaces(assembly: Assembly, frame?: Record<string, Transform>): Face[] {
  const partById = new Map(assembly.parts.map((p) => [p.id, p]));
  const faces: Face[] = [];
  for (const inst of assembly.instances) {
    const part = partById.get(inst.partId); if (!part) continue;
    const T = frame?.[inst.id] ?? inst.transform;
    for (const piece of part.geometry) {
      if (piece.role === 'fastener') continue;
      const q = mulQ(T.rotation, piece.offset.rotation);
      const c: V = [0, 0, 0]; const off = rot(T.rotation, piece.offset.position as V);
      c[0] = T.position[0] + off[0]; c[1] = T.position[1] + off[1]; c[2] = T.position[2] + off[2];
      const color = piece.color ?? '#aaa';
      const s = piece.shape;
      const toView = (local: V): V => { const wp = rot(q, local); return view([c[0] + wp[0], c[1] + wp[1], c[2] + wp[2]]); };
      // Push a lit, front-facing polygon; `normal` is the outward unit normal in piece-local space.
      const push = (points: V[], normal: V) => {
        const nv = view(rot(q, normal));
        if (nv[2] <= 0) return; // back face
        const depth = points.reduce((d, p) => d + p[2], 0) / points.length;
        const lit = Math.max(0, nv[0] * LIGHT[0] + nv[1] * LIGHT[1] + nv[2] * LIGHT[2]);
        faces.push({ depth, points, color: shade(color, lit), kind: 'poly' });
      };
      if (s.kind === 'sphere') { const vc = view(c); faces.push({ depth: vc[2], points: [vc], color: shade(color, 0.8), kind: 'circle', r: s.radius }); continue; }
      if (s.kind === 'extrude') { // real silhouette: profile polygon front + back, one quad per profile edge
        const prof = ensureCCW(s.profile), n = prof.length;
        const front = prof.map((p) => toView(extrudePoint(s.axis, p, s.depth / 2)));
        const back = prof.map((p) => toView(extrudePoint(s.axis, p, -s.depth / 2)));
        const ax = extrudePoint(s.axis, [0, 0], 1);
        push(front, ax); push([...back].reverse(), [-ax[0], -ax[1], -ax[2]]);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n; const dx = prof[j][0] - prof[i][0], dy = prof[j][1] - prof[i][1]; const l = Math.hypot(dx, dy) || 1;
          push([front[i], front[j], back[j], back[i]], extrudePoint(s.axis, [dy / l, -dx / l], 0));
        }
        continue;
      }
      // Everything else (box, cylinder, capsule, ellipsoid, revolve) draws as a box of its half extents.
      let half: V = shapeHalfExtents(s);
      if (s.kind === 'cylinder') half = [half[0] * 0.9, half[1] * 0.9, half[2] * 0.9];
      const axes: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (let a = 0; a < 3; a++) for (const sgn of [1, -1]) {
        const u = axes[(a + 1) % 3], w = axes[(a + 2) % 3];
        const corners: V[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([du, dw]) => {
          const local: V = [0, 0, 0];
          for (let k = 0; k < 3; k++) local[k] = axes[a][k] * sgn * half[a] + u[k] * du * half[(a + 1) % 3] + w[k] * dw * half[(a + 2) % 3];
          return toView(local);
        });
        push(corners, axes[a].map((v) => v * sgn) as V);
      }
    }
  }
  return faces.sort((a, b) => a.depth - b.depth);
}

export default function IsoPreview({ assembly, trace, playing, className }: { assembly: Assembly; trace?: Trace | null; playing?: boolean; className?: string }) {
  const [frameIdx, setFrameIdx] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!playing || !trace?.frames.length) { setFrameIdx(0); return; }
    let start = performance.now();
    const loop = (now: number) => {
      const t = ((now - start) / 1000) % (trace.frames[trace.frames.length - 1].t || 1);
      setFrameIdx(Math.min(trace.frames.length - 1, Math.floor(t / trace.dt)));
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, trace]);
  const frame = playing && trace?.frames[frameIdx] ? trace.frames[frameIdx].bodies : undefined;
  const faces = useMemo(() => projectFaces(assembly, frame), [assembly, frame]);
  const bounds = useMemo(() => {
    const f = projectFaces(assembly);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const face of f) for (const p of face.points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const w = maxX - minX || 0.1, h = maxY - minY || 0.1;
    return { minX: minX - w * 0.35, w: w * 1.7, minY: minY - h * 0.25, h: h * 1.5 };
  }, [assembly]);
  const body = frame?.body ?? assembly.instances.find((i) => i.id === 'body')?.transform;
  const shift = body ? view(body.position as V) : [0, 0, 0];
  const rest = assembly.instances.find((i) => i.id === 'body')?.transform;
  const restV = rest ? view(rest.position as V) : [0, 0, 0];
  const dx = playing ? shift[0] - restV[0] : 0; // follow the body horizontally while walking
  const sc = 1000;
  return (
    <svg viewBox={`${(bounds.minX + dx) * sc} ${-(bounds.minY + bounds.h) * sc} ${bounds.w * sc} ${bounds.h * sc}`} className={className} aria-hidden preserveAspectRatio="xMidYMid meet">
      <ellipse cx={(restV[0] + dx) * sc} cy={-(bounds.minY + bounds.h * 0.06) * sc} rx={bounds.w * sc * 0.3} ry={bounds.h * sc * 0.05} fill="#0f172a" opacity={0.08} />
      {faces.map((f, i) => f.kind === 'circle'
        ? <circle key={i} cx={f.points[0][0] * sc} cy={-f.points[0][1] * sc} r={(f.r ?? 0.005) * sc} fill={f.color} />
        : <polygon key={i} points={f.points.map((p) => `${p[0] * sc},${-p[1] * sc}`).join(' ')} fill={f.color} stroke="rgba(15,23,42,0.25)" strokeWidth={0.4} />)}
    </svg>
  );
}

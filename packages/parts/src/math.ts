import type { Quat, Transform, Vec3 } from '@protolab/schema';

export const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const QUAT_ID: Quat = [0, 0, 0, 1];

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = norm(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a; const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export function quatConj(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
export function rotate(q: Quat, p: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [px, py, pz] = p;
  // t = 2 * cross(q.xyz, p)
  const tx = 2 * (qy * pz - qz * py);
  const ty = 2 * (qz * px - qx * pz);
  const tz = 2 * (qx * py - qy * px);
  return [
    px + qw * tx + (qy * tz - qz * ty),
    py + qw * ty + (qz * tx - qx * tz),
    pz + qw * tz + (qx * ty - qy * tx),
  ];
}
export function transformPoint(t: Transform, p: Vec3): Vec3 { return add(rotate(t.rotation, p), t.position); }
export function transformDir(t: Transform, d: Vec3): Vec3 { return rotate(t.rotation, d); }
export function compose(a: Transform, b: Transform): Transform {
  // a * b : apply b then a
  return { position: transformPoint(a, b.position), rotation: quatMul(a.rotation, b.rotation) };
}
export function invert(t: Transform): Transform {
  const r = quatConj(t.rotation);
  return { position: scale(rotate(r, t.position), -1), rotation: r };
}
export function upVector(q: Quat): Vec3 { return rotate(q, [0, 1, 0]); }
export function tiltDeg(q: Quat): number {
  const u = upVector(q);
  return (Math.acos(Math.max(-1, Math.min(1, u[1]))) * 180) / Math.PI;
}

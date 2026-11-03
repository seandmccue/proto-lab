import { z } from 'zod';
import { Assembly, Instance, Joint, type PartDefinition, type Transform, type Vec3, type Quat, type Motor, type Drive, Controller, totalMass } from '@protolab/schema';
import { add, scale, sub, len, norm, rotate, quatMul, quatConj, quatFromAxisAngle, QUAT_ID, transformPoint, transformDir, compose, invert, cross, dot, quatFromEuler } from './math.ts';
import { piecesBoundingRadius } from './geometry.ts';

/**
 * Generic assembly-operations engine. A model (or a builder) emits structured operations; this
 * module validates and executes them against an assembly: place parts, mount parts onto connectors
 * (which computes the child's pose so the connectors coincide), create joints, mirror/polar patterns,
 * drives. No template knows what a "walker" or a "butterfly" is.
 */

export const Euler = z.tuple([z.number(), z.number(), z.number()]); // degrees, XYZ order
export const PlaceOp = z.object({
  op: z.literal('place'), id: z.string(), part: z.string(), label: z.string().optional(), group: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]), rotation_deg: Euler.optional(),
  anchored: z.boolean().optional(), free: z.boolean().optional(),
});
export const MountOp = z.object({
  op: z.literal('mount'), id: z.string(), part: z.string(), label: z.string().optional(), group: z.string().optional(),
  onto: z.string(), connector: z.string(), via: z.string().optional(),   // parent instance + connector; child connector (default: first compatible)
  joint: z.enum(['fixed', 'revolute', 'prismatic']).default('fixed'),
  spin_deg: z.number().default(0),          // rotation of the child about the mate axis
  offset_m: z.number().default(0),          // extra separation along the mate axis
  limits: z.tuple([z.number(), z.number()]).optional(),   // rad or m
  motor: z.object({ controlId: z.string(), stiffness: z.number().positive().default(5), damping: z.number().nonnegative().default(0.2) }).optional(),
  anchored: z.boolean().optional(),
});
export const ConnectOp = z.object({
  op: z.literal('connect'), a: z.string(), a_connector: z.string(), b: z.string(), b_connector: z.string(),
  joint: z.enum(['fixed', 'revolute', 'prismatic', 'spring']).default('revolute'), limits: z.tuple([z.number(), z.number()]).optional(),
  motor: z.object({ controlId: z.string(), stiffness: z.number().positive().default(5), damping: z.number().nonnegative().default(0.2) }).optional(),
  spring: z.object({ stiffness: z.number().positive(), damping: z.number().nonnegative().default(0.5), restLength_m: z.number().nonnegative().default(0) }).optional(),
});
export const PatternOp = z.object({
  op: z.literal('pattern'), instances: z.array(z.string()).min(1).max(40), kind: z.enum(['mirror', 'polar', 'linear']),
  plane: z.enum(['xy', 'yz', 'xz']).optional(),          // mirror
  axis: z.enum(['x', 'y', 'z']).optional(), center: z.tuple([z.number(), z.number(), z.number()]).optional(), count: z.number().int().min(2).max(12).optional(), // polar
  step: z.tuple([z.number(), z.number(), z.number()]).optional(),   // linear
  suffix: z.string().optional(),
  controlSuffix: z.boolean().default(true),
});
export const RemoveOp = z.object({ op: z.literal('remove'), id: z.string() });
export const MoveOp = z.object({ op: z.literal('move'), id: z.string(), position: z.tuple([z.number(), z.number(), z.number()]).optional(), rotation_deg: Euler.optional(), translate: z.tuple([z.number(), z.number(), z.number()]).optional() });
export const AssemblyOp = z.discriminatedUnion('op', [PlaceOp, MountOp, ConnectOp, PatternOp, RemoveOp, MoveOp]);
export type AssemblyOp = z.infer<typeof AssemblyOp>;

export type PartResolver = (id: string) => PartDefinition | undefined;
export interface Limits { maxInstances: number; maxMass_kg: number; maxSize_m: number }
export const DEFAULT_LIMITS: Limits = { maxInstances: 80, maxMass_kg: 5, maxSize_m: 1.5 };

export class AssemblyError extends Error { opIndex?: number; constructor(msg: string, opIndex?: number) { super(msg); this.opIndex = opIndex; } }

export function emptyAssembly(): Assembly { return Assembly.parse({ parts: [], instances: [], joints: [], controller: { drives: [] } }); }

function connectorOf(part: PartDefinition, id: string | undefined, want?: 'fixed' | 'revolute' | 'prismatic' | 'spring') {
  if (id) { const c = part.connectors.find((x) => x.id === id); if (!c) throw new AssemblyError(`Part "${part.id}" has no connector "${id}". Connectors: ${part.connectors.map((x) => x.id).join(', ') || 'none'}`); return c; }
  const c = part.connectors.find((x) => !want || x.kind === 'any' || x.kind === want || (want === 'spring' && x.kind === 'fixed')) ?? part.connectors[0];
  if (!c) throw new AssemblyError(`Part "${part.id}" has no connectors`);
  return c;
}

/** Quaternion rotating unit vector a onto unit vector b (shortest arc). */
export function quatFromTo(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d > 1 - 1e-9) return QUAT_ID;
  if (d < -1 + 1e-9) { // 180°: pick any perpendicular axis
    const axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return quatFromAxisAngle(norm(axis), Math.PI);
  }
  const c = cross(a, b); const w = 1 + d; const l = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / l, c[1] / l, c[2] / l, w / l];
}

/** Compute the child's world transform so its connector coincides with the parent's connector, axes facing. */
export function mateTransform(parentT: Transform, parentConn: { position: Vec3; axis: Vec3 }, childPart: PartDefinition, childConn: { position: Vec3; axis: Vec3 }, spin_rad: number, offset_m: number): Transform {
  const pPos = transformPoint(parentT, parentConn.position);
  const pAxis = norm(transformDir(parentT, parentConn.axis));
  const target = scale(pAxis, -1);                       // child axis must point back at the parent
  const q0 = quatFromTo(norm(childConn.axis), target);
  const q = quatMul(quatFromAxisAngle(pAxis, spin_rad), q0);
  // Keep the child's "up" sensible for 180° flips: already deterministic via quatFromTo.
  const childConnWorldOffset = rotate(q, childConn.position);
  const pos = sub(add(pPos, scale(pAxis, offset_m)), childConnWorldOffset);
  void childPart;
  return { position: pos, rotation: q };
}

export interface ApplyResult { assembly: Assembly; summary: string[] }

/** Apply a batch of ops. Fails atomically: on error the input assembly is unchanged and the failing op index is reported. */
export function applyOps(input: Assembly, ops: AssemblyOp[], resolve: PartResolver, limits: Limits = DEFAULT_LIMITS): ApplyResult {
  const a: Assembly = structuredClone(input);
  const summary: string[] = [];
  const partById = new Map(a.parts.map((p) => [p.id, p]));
  const usePart = (id: string, i: number) => {
    let p = partById.get(id);
    if (!p) { p = resolve(id); if (!p) throw new AssemblyError(`Unknown part "${id}"`, i); if (p.decorative) throw new AssemblyError(`Part "${id}" is decorative (no mechanical properties); it can be mounted with joint "fixed" onto structure but cannot carry joints or loads`, i); partById.set(id, p); a.parts.push(p); }
    return p;
  };
  const inst = (id: string, i: number) => { const x = a.instances.find((y) => y.id === id); if (!x) throw new AssemblyError(`Unknown instance "${id}"`, i); return x; };
  const unique = (id: string, i: number) => { if (a.instances.some((x) => x.id === id)) throw new AssemblyError(`Instance id "${id}" already exists`, i); if (!/^[a-zA-Z][\w-]{0,40}$/.test(id)) throw new AssemblyError(`Instance id "${id}" must be alphanumeric/underscore, ≤ 40 chars`, i); };

  ops.forEach((op, i) => {
    switch (op.op) {
      case 'place': {
        unique(op.id, i); const p = usePart(op.part, i);
        const rot = op.rotation_deg ? quatFromEuler(op.rotation_deg.map((d) => (d * Math.PI) / 180) as Vec3) : QUAT_ID;
        a.instances.push(Instance.parse({ id: op.id, partId: p.id, label: op.label ?? p.name, group: op.group, transform: { position: op.position, rotation: rot }, anchored: !!op.anchored, free: !!op.free }));
        summary.push(`placed ${op.id} (${p.name})${op.anchored ? ' anchored' : ''}${op.free ? ' free' : ''}`);
        break;
      }
      case 'mount': {
        unique(op.id, i); const p = usePart(op.part, i); const parent = inst(op.onto, i); const pp = partById.get(parent.partId)!;
        const pc = connectorOf(pp, op.connector);
        const cc = connectorOf(p, op.via, op.joint);
        if (op.joint === 'revolute' && pc.kind !== 'revolute' && pc.kind !== 'any' && cc.kind !== 'revolute' && cc.kind !== 'any') throw new AssemblyError(`Neither connector ${op.onto}.${pc.id} nor ${op.part}.${cc.id} is revolute`, i);
        if (op.joint === 'prismatic' && pc.kind !== 'prismatic' && pc.kind !== 'any' && cc.kind !== 'prismatic' && cc.kind !== 'any') throw new AssemblyError(`Neither connector is prismatic`, i);
        const T = mateTransform(parent.transform, pc, p, cc, (op.spin_deg * Math.PI) / 180, op.offset_m);
        a.instances.push(Instance.parse({ id: op.id, partId: p.id, label: op.label ?? p.name, group: op.group ?? parent.group, transform: T, anchored: !!op.anchored, free: false }));
        const axis = norm(transformDir(parent.transform, pc.axis));
        const anchor = transformPoint(parent.transform, pc.position);
        const motor: Motor | undefined = op.motor ? { controlId: op.motor.controlId, stiffness: op.motor.stiffness, damping: op.motor.damping, maxTorque_Nm: op.joint === 'revolute' ? (pp.limits.maxTorque_Nm ?? p.limits.maxTorque_Nm) : undefined, maxForce_N: op.joint === 'prismatic' ? (pp.limits.maxForce_N ?? p.limits.maxForce_N) : undefined } : undefined;
        a.joints.push(Joint.parse({ id: `j_${op.id}`, type: op.joint, a: { instanceId: parent.id, connectorId: pc.id }, b: { instanceId: op.id, connectorId: cc.id }, axis, anchor, limits: op.limits, motor }));
        summary.push(`mounted ${op.id} (${p.name}) on ${op.onto}.${pc.id} [${op.joint}${op.motor ? ' motor ' + op.motor.controlId : ''}]`);
        break;
      }
      case 'connect': {
        const ia = inst(op.a, i), ib = inst(op.b, i); const pa = partById.get(ia.partId)!, pb = partById.get(ib.partId)!;
        const ca = connectorOf(pa, op.a_connector), cb = connectorOf(pb, op.b_connector);
        const wa = transformPoint(ia.transform, ca.position), wb = transformPoint(ib.transform, cb.position);
        const gap = len(sub(wa, wb));
        if (op.joint !== 'spring' && gap > 0.02) throw new AssemblyError(`Connectors ${op.a}.${ca.id} and ${op.b}.${cb.id} are ${(gap * 1000).toFixed(0)} mm apart; move a part so they touch (≤ 20 mm) or use "mount"`, i);
        const axis = norm(transformDir(ia.transform, ca.axis));
        const motor: Motor | undefined = op.motor ? { controlId: op.motor.controlId, stiffness: op.motor.stiffness, damping: op.motor.damping, maxTorque_Nm: pa.limits.maxTorque_Nm ?? pb.limits.maxTorque_Nm, maxForce_N: pa.limits.maxForce_N ?? pb.limits.maxForce_N } : undefined;
        a.joints.push(Joint.parse({ id: `j_${op.a}_${op.b}_${a.joints.length}`, type: op.joint, a: { instanceId: ia.id, connectorId: ca.id }, b: { instanceId: ib.id, connectorId: cb.id }, axis, anchor: wa, limits: op.limits, motor, spring: op.joint === 'spring' ? { stiffness: op.spring?.stiffness ?? 200, damping: op.spring?.damping ?? 0.5, restLength_m: op.spring?.restLength_m ?? gap } : undefined }));
        summary.push(`connected ${op.a}.${ca.id} ↔ ${op.b}.${cb.id} [${op.joint}]`);
        break;
      }
      case 'pattern': {
        const srcIds = op.instances; const src = srcIds.map((id) => inst(id, i));
        const copies = op.kind === 'mirror' ? 1 : (op.count ?? 2) - 1;
        const srcSet = new Set(srcIds);
        const joints = a.joints.filter((j) => srcSet.has(j.a.instanceId) || srcSet.has(j.b.instanceId));
        const drivesByCtl = new Map(a.controller.drives.map((d) => [d.controlId, d]));
        for (let k = 1; k <= copies; k++) {
          const suffix = `${op.suffix ?? '_'}${k}`;
          const map = new Map<string, string>();
          for (const s of src) { const nid = `${s.id}${suffix}`; unique(nid, i); map.set(s.id, nid); }
          const xf = (T: Transform): Transform => {
            if (op.kind === 'mirror') {
              const plane = op.plane ?? 'xy'; const n: Vec3 = plane === 'xy' ? [0, 0, 1] : plane === 'yz' ? [1, 0, 0] : [0, 1, 0];
              const p = T.position; const pos = sub(p, scale(n, 2 * dot(p, n)));
              // mirror a rotation: reflect its axis-angle; for z-plane mirror negate x,y of the quaternion vector part... use: q' = M q M with M reflection
              const [qx, qy, qz, qw] = T.rotation;
              const rot: Quat = plane === 'xy' ? [-qx, -qy, qz, qw] : plane === 'yz' ? [qx, -qy, -qz, qw] : [-qx, qy, -qz, qw];
              return { position: pos, rotation: rot };
            }
            if (op.kind === 'polar') {
              const axis: Vec3 = op.axis === 'x' ? [1, 0, 0] : op.axis === 'z' ? [0, 0, 1] : [0, 1, 0]; const c = op.center ?? [0, 0, 0];
              const q = quatFromAxisAngle(axis, (2 * Math.PI * k) / (op.count ?? 2));
              return { position: add(rotate(q, sub(T.position, c)), c), rotation: quatMul(q, T.rotation) };
            }
            return { position: add(T.position, scale(op.step ?? [0, 0, 0], k)), rotation: T.rotation };
          };
          const mirrorMode = op.kind === 'mirror';
          for (const s of src) a.instances.push({ ...structuredClone(s), id: map.get(s.id)!, label: `${s.label} ${suffix.replace(/^_/, '')}`, group: s.group ? `${s.group}${suffix}` : undefined, transform: xf(s.transform) });
          for (const j of joints) {
            const na = map.get(j.a.instanceId) ?? j.a.instanceId, nb = map.get(j.b.instanceId) ?? j.b.instanceId;
            if (na === j.a.instanceId && nb === j.b.instanceId) continue;
            const ctl = j.motor && op.controlSuffix ? `${j.motor.controlId}${suffix}` : j.motor?.controlId;
            let axis = j.axis;
            const xfDir = (d: Vec3): Vec3 => {
              if (mirrorMode) { const plane = op.plane ?? 'xy'; const n: Vec3 = plane === 'xy' ? [0, 0, 1] : plane === 'yz' ? [1, 0, 0] : [0, 1, 0]; return sub(d, scale(n, 2 * dot(d, n))); }
              if (op.kind === 'polar') { const ax: Vec3 = op.axis === 'x' ? [1, 0, 0] : op.axis === 'z' ? [0, 0, 1] : [0, 1, 0]; return rotate(quatFromAxisAngle(ax, (2 * Math.PI * k) / (op.count ?? 2)), d); }
              return d;
            };
            if (axis) axis = xfDir(axis);
            const anchor = j.anchor ? xf({ position: j.anchor, rotation: QUAT_ID }).position : undefined;
            a.joints.push({ ...structuredClone(j), id: `${j.id}${suffix}`, a: { ...j.a, instanceId: na }, b: { ...j.b, instanceId: nb }, axis, anchor, motor: j.motor ? { ...j.motor, controlId: ctl! } : undefined });
            if (j.motor && ctl && drivesByCtl.has(j.motor.controlId) && !drivesByCtl.has(ctl)) {
              const d = structuredClone(drivesByCtl.get(j.motor.controlId)!); d.controlId = ctl;
              if (mirrorMode && d.profile.kind !== 'constant' && d.profile.kind !== 'step' && d.profile.kind !== 'ramp' && 'amplitude' in d.profile) {
                // Mirrored revolute joints about a mirrored axis keep the same sign convention; leave amplitude as-is.
              }
              a.controller.drives.push(d); drivesByCtl.set(ctl, d);
            }
          }
          summary.push(`${op.kind} pattern copy ${k}: ${src.map((s) => map.get(s.id)).join(', ')}`);
        }
        break;
      }
      case 'remove': {
        inst(op.id, i);
        a.instances = a.instances.filter((x) => x.id !== op.id);
        a.joints = a.joints.filter((j) => j.a.instanceId !== op.id && j.b.instanceId !== op.id);
        summary.push(`removed ${op.id}`);
        break;
      }
      case 'move': {
        const x = inst(op.id, i);
        if (op.position) { const d = sub(op.position, x.transform.position); x.transform.position = [...op.position]; for (const j of a.joints) if (j.anchor && j.a.instanceId === op.id) j.anchor = add(j.anchor, d); }
        if (op.translate) { x.transform.position = add(x.transform.position, op.translate); for (const j of a.joints) if (j.anchor && j.a.instanceId === op.id) j.anchor = add(j.anchor, op.translate); }
        if (op.rotation_deg) x.transform.rotation = quatFromEuler(op.rotation_deg.map((d) => (d * Math.PI) / 180) as Vec3);
        summary.push(`moved ${op.id}`);
        break;
      }
    }
  });
  // prune unused parts and orphaned drives
  const used = new Set(a.instances.map((x) => x.partId));
  a.parts = a.parts.filter((p) => used.has(p.id));
  const ctls = new Set(a.joints.filter((j) => j.motor).map((j) => j.motor!.controlId));
  a.controller.drives = a.controller.drives.filter((d) => ctls.has(d.controlId));
  validate(a, limits);
  return { assembly: a, summary };
}

export function validate(a: Assembly, limits: Limits = DEFAULT_LIMITS): void {
  if (a.instances.length > limits.maxInstances) throw new AssemblyError(`Too many components: ${a.instances.length} > ${limits.maxInstances}`);
  const m = totalMass(a);
  if (m > limits.maxMass_kg) throw new AssemblyError(`Assembly mass ${m.toFixed(3)} kg exceeds ${limits.maxMass_kg} kg`);
  const ids = new Set<string>();
  for (const x of a.instances) { if (ids.has(x.id)) throw new AssemblyError(`Duplicate instance id ${x.id}`); ids.add(x.id); }
  for (const j of a.joints) { if (!ids.has(j.a.instanceId) || !ids.has(j.b.instanceId)) throw new AssemblyError(`Joint ${j.id} references a missing instance`); if (j.a.instanceId === j.b.instanceId) throw new AssemblyError(`Joint ${j.id} connects an instance to itself`); }
  const ctls = new Set(a.joints.filter((j) => j.motor).map((j) => j.motor!.controlId));
  for (const d of a.controller.drives) if (!ctls.has(d.controlId)) throw new AssemblyError(`Drive "${d.controlId}" has no motorised joint with that controlId. Motorised joints: ${[...ctls].join(', ') || 'none'}`);
  // bounding size
  let r = 0; const partById = new Map(a.parts.map((p) => [p.id, p]));
  for (const x of a.instances) { const p = partById.get(x.partId); if (!p) continue; r = Math.max(r, len(x.transform.position) + piecesBoundingRadius(p.geometry)); }
  if (r * 2 > limits.maxSize_m * 2.5) throw new AssemblyError(`Assembly spans ~${(r * 2).toFixed(2)} m, larger than the ${limits.maxSize_m} m workspace`);
}

export function setDrives(a: Assembly, drives: Drive[]): Assembly {
  const next = structuredClone(a);
  const byId = new Map(next.controller.drives.map((d) => [d.controlId, d]));
  for (const d of drives) byId.set(d.controlId, d);
  next.controller = Controller.parse({ drives: [...byId.values()] });
  validate(next);
  return next;
}

/** Assembly summary for the model: instances, joints, motors, drives, mass, extents. */
export function summarize(a: Assembly) {
  const partById = new Map(a.parts.map((p) => [p.id, p]));
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const x of a.instances) { const p = partById.get(x.partId); const r = p ? piecesBoundingRadius(p.geometry) : 0; const [px, py, pz] = x.transform.position; minX = Math.min(minX, px - r); maxX = Math.max(maxX, px + r); minY = Math.min(minY, py - r); maxY = Math.max(maxY, py + r); minZ = Math.min(minZ, pz - r); maxZ = Math.max(maxZ, pz + r); }
  return {
    instances: a.instances.map((x) => ({ id: x.id, part: x.partId, group: x.group, position_m: x.transform.position.map((v) => +v.toFixed(4)), anchored: x.anchored || undefined, free: x.free || undefined })),
    joints: a.joints.map((j) => ({ id: j.id, type: j.type, a: `${j.a.instanceId}.${j.a.connectorId}`, b: `${j.b.instanceId}.${j.b.connectorId}`, axis: j.axis?.map((v) => +v.toFixed(3)), limits: j.limits, motor: j.motor ? { controlId: j.motor.controlId, rating: j.motor.maxTorque_Nm ?? j.motor.maxForce_N } : undefined })),
    drives: a.controller.drives,
    totalMass_kg: +totalMass(a).toFixed(4),
    extents_m: a.instances.length ? { x: [+minX.toFixed(3), +maxX.toFixed(3)], y: [+minY.toFixed(3), +maxY.toFixed(3)], z: [+minZ.toFixed(3), +maxZ.toFixed(3)] } : null,
    lowestPoint_m: a.instances.length ? +minY.toFixed(3) : null,
    note: 'Ground is the plane y = 0. Anchored instances are fixed to the world. Free instances have no joints.',
  };
}

export { compose, invert, quatConj };

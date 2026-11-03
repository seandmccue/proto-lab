import RAPIER from '@dimforge/rapier3d-compat';
import type { Assembly, Controller, Instance, Joint, Spec, TestResult, TestSpec, Trace, Transform, Vec3, Quat } from '@protolab/schema';
import { compose, invert, quatConj, quatFromAxisAngle, quatMul, rotate, tiltDeg, transformPoint, sub, len } from '@protolab/parts';

export const ENGINE = 'rapier3d-compat 0.14.0, fixed 1/240 s step, 30 Hz trace';
const DT = 1 / 240;
const TRACE_HZ = 30;

let ready: Promise<void> | null = null;
export function initSimulator(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export interface SimEnvironment { gravity_m_s2: number; groundFriction: number }

interface RigidGroup { rootId: string; members: Instance[] }

/** Instances connected by fixed joints become one rigid body (compound colliders). */
function rigidGroups(a: Assembly): RigidGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const union = (x: string, y: string) => { parent.set(find(x), find(y)); };
  for (const i of a.instances) parent.set(i.id, i.id);
  for (const j of a.joints) if (j.type === 'fixed') union(j.a.instanceId, j.b.instanceId);
  const groups = new Map<string, Instance[]>();
  for (const i of a.instances) { const r = find(i.id); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); }
  return [...groups.values()].map((members) => ({ rootId: members[0].id, members }));
}

function shapeVolume(s: Assembly['parts'][number]['geometry'][number]['shape']): number {
  switch (s.kind) {
    case 'box': return s.size[0] * s.size[1] * s.size[2];
    case 'cylinder': return Math.PI * s.radius * s.radius * s.height;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
  }
}

function axisRotation(axis: 'x' | 'y' | 'z'): Quat {
  if (axis === 'y') return [0, 0, 0, 1];
  if (axis === 'x') return quatFromAxisAngle([0, 0, 1], Math.PI / 2);
  return quatFromAxisAngle([1, 0, 0], Math.PI / 2);
}

function axisAngle(q: Quat, axis: Vec3): number {
  // signed rotation angle of q about the given unit axis (twist component)
  const [x, y, z, w] = q;
  const proj = x * axis[0] + y * axis[1] + z * axis[2];
  const twist: Quat = [axis[0] * proj, axis[1] * proj, axis[2] * proj, w];
  const n = Math.hypot(...twist) || 1;
  const ang = 2 * Math.atan2(proj / n, w / n);
  return Math.atan2(Math.sin(ang), Math.cos(ang));
}

export interface ControlTargets { [controlId: string]: number }

/** Deterministic open-loop controllers. Returns joint position targets at time t. */
export function controlTargets(ctl: Controller, t: number): ControlTargets {
  const out: ControlTargets = {};
  const w = 2 * Math.PI * ctl.frequency_hz;
  if (ctl.kind === 'gait') {
    // Crawl/trot generator: during the swing window the hip sweeps forward on a cosine and the knee
    // lifts on a raised-cosine bump; during stance the hip sweeps back linearly so all stance feet
    // move at the same speed relative to the body.
    const ramp = ctl.rampIn_s > 0 ? Math.min(1, t / ctl.rampIn_s) : 1;
    const d = ctl.swingDuty;
    const A = ramp * ctl.hipAmplitude_rad, K = ramp * ctl.kneeAmplitude_rad;
    for (const [id, phase] of Object.entries(ctl.phases)) {
      const frac = (((t * ctl.frequency_hz + phase / (2 * Math.PI)) % 1) + 1) % 1;
      const inSwing = frac < d / 2 || frac > 1 - d / 2;
      let hip: number, knee: number;
      if (inSwing) {
        const u = (frac < d / 2 ? frac + d / 2 : frac - (1 - d / 2)) / d; // 0..1 through the swing
        hip = -A + 2 * A * (0.5 - 0.5 * Math.cos(Math.PI * u));
        knee = K * Math.sin(Math.PI * u);
      } else {
        const p = (frac - d / 2) / (1 - d);
        hip = A - 2 * A * p;
        knee = 0;
      }
      if (id.startsWith('hip_')) out[id] = ctl.hipOffset_rad + hip;
      else if (id.startsWith('knee_')) out[id] = ctl.kneeOffset_rad + knee;
    }
  } else {
    const ramp = ctl.rampIn_s > 0 ? Math.min(1, t / ctl.rampIn_s) : 1;
    // Bob: all knees flex together; each hip rotates forward by half the extra flex so the foot stays
    // under the hip (equal leg segments) instead of sliding. Sway adds a small alternating hip motion.
    const bob = ramp * ctl.bobAmplitude_rad * (0.5 + 0.5 * Math.sin(2 * w * t));
    for (const [id, phase] of Object.entries(ctl.phases)) {
      if (id.startsWith('hip_')) out[id] = ctl.hipOffset_rad + 0.5 * bob + ramp * ctl.swayAmplitude_rad * Math.sin(w * t + phase);
      else if (id.startsWith('knee_')) out[id] = ctl.kneeOffset_rad + bob;
    }
  }
  return out;
}

export interface RunOptions { env: SimEnvironment; test: TestSpec; controller?: Controller; restOffsets?: ControlTargets }

export async function runTest(assembly: Assembly, opts: RunOptions): Promise<TestResult> {
  await initSimulator();
  const { env, test } = opts;
  const controller = opts.controller ?? assembly.controller;
  if (!controller) throw new Error('Assembly has no controller');

  const world = new RAPIER.World({ x: 0, y: -Math.abs(env.gravity_m_s2), z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;

  // Ground
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.05, 20).setFriction(env.groundFriction).setRestitution(0), ground);

  const partById = new Map(assembly.parts.map((p) => [p.id, p]));
  const instById = new Map(assembly.instances.map((i) => [i.id, i]));
  const groups = rigidGroups(assembly);
  const bodyOf = new Map<string, RAPIER.RigidBody>();       // instanceId -> body (group root body)
  const restRoot = new Map<string, Transform>();              // rootId -> root rest transform
  const localOffset = new Map<string, Transform>();           // instanceId -> transform relative to its root
  const failureReasons: string[] = [];

  for (const g of groups) {
    const root = instById.get(g.rootId)!;
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...root.transform.position)
      .setRotation({ x: root.transform.rotation[0], y: root.transform.rotation[1], z: root.transform.rotation[2], w: root.transform.rotation[3] })
      .setCanSleep(false));
    restRoot.set(g.rootId, root.transform);
    const invRoot = invert(root.transform);
    for (const inst of g.members) {
      const part = partById.get(inst.partId);
      if (!part) throw new Error(`Instance ${inst.id} references unknown part ${inst.partId}`);
      const rel = compose(invRoot, inst.transform);
      localOffset.set(inst.id, rel);
      bodyOf.set(inst.id, rb);
      const totalVol = part.geometry.reduce((s, gp) => s + shapeVolume(gp.shape), 0) || 1;
      for (const piece of part.geometry) {
        if (piece.role === 'decor' || piece.role === 'fastener') continue; // no collision for cosmetics
        const t = compose(rel, piece.offset);
        let desc: RAPIER.ColliderDesc;
        let rot = t.rotation;
        switch (piece.shape.kind) {
          case 'box': desc = RAPIER.ColliderDesc.cuboid(piece.shape.size[0] / 2, piece.shape.size[1] / 2, piece.shape.size[2] / 2); break;
          case 'sphere': desc = RAPIER.ColliderDesc.ball(piece.shape.radius); break;
          case 'cylinder': desc = RAPIER.ColliderDesc.cylinder(piece.shape.height / 2, piece.shape.radius); rot = quatMul(t.rotation, axisRotation(piece.shape.axis)); break;
        }
        desc.setTranslation(...t.position).setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] });
        desc.setMass(part.mass_kg * (shapeVolume(piece.shape) / totalVol));
        desc.setFriction(piece.role === 'contact' ? env.groundFriction : 0.4).setRestitution(0);
        // Legs on the same robot interpenetrate at rest (servo horn vs bar); only collide with ground + feet vs body.
        desc.setCollisionGroups(piece.role === 'contact' ? 0x00020004 : 0x00010004);
        world.createCollider(desc, rb);
      }
    }
  }
  // ground collides with everything
  ground.collider(0).setCollisionGroups(0x00040007);

  // Revolute joints with position motors
  interface MotorJoint { joint: Joint; raw: RAPIER.RevoluteImpulseJoint; b1: RAPIER.RigidBody; b2: RAPIER.RigidBody; axisWorld: Vec3; axisLocal2: Vec3; q1Rest: Quat; q2Rest: Quat; restAngle: number; peak: number; rating: number }
  const motors: MotorJoint[] = [];
  for (const j of assembly.joints) {
    if (j.type !== 'revolute') continue;
    const ia = instById.get(j.a.instanceId)!, ib = instById.get(j.b.instanceId)!;
    const b1 = bodyOf.get(ia.id)!, b2 = bodyOf.get(ib.id)!;
    if (b1 === b2) { failureReasons.push(`Joint ${j.id} connects instances of the same rigid group`); continue; }
    const pa = partById.get(ia.partId)!, pb = partById.get(ib.partId)!;
    const ca = pa.connectors.find((c) => c.id === j.a.connectorId)!;
    const cb = pb.connectors.find((c) => c.id === j.b.connectorId)!;
    const wa = transformPoint(ia.transform, ca.position);
    const wb = transformPoint(ib.transform, cb.position);
    const gap = len(sub(wa, wb));
    const anchor = wa;
    const axisWorld = j.axis ?? rotate(ia.transform.rotation, ca.axis);
    const rootA = [...restRoot.entries()].find(([, t]) => t === instById.get([...bodyOf.entries()].find(([, b]) => b === b1)![0])!.transform);
    const t1 = localRootTransform(b1), t2 = localRootTransform(b2);
    const a1 = transformPoint(invert(t1), anchor), a2 = transformPoint(invert(t2), anchor);
    const axisLocal1 = rotate(quatConj(t1.rotation), axisWorld);
    const axisLocal2 = rotate(quatConj(t2.rotation), axisWorld);
    const data = RAPIER.JointData.revolute({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: axisLocal1[0], y: axisLocal1[1], z: axisLocal1[2] });
    const raw = world.createImpulseJoint(data, b1, b2, true) as RAPIER.RevoluteImpulseJoint;
    const qRel = quatMul(quatConj(t1.rotation), t2.rotation);
    const restAngle = axisAngle(qRel, axisLocal1);
    if (j.limits_rad) raw.setLimits(j.limits_rad[0], j.limits_rad[1]);
    if (j.motor) {
      raw.configureMotorModel(RAPIER.MotorModel.ForceBased);
      raw.configureMotorPosition(restAngle, j.motor.stiffness, j.motor.damping);
    }
    motors.push({ joint: j, raw, b1, b2, axisWorld, axisLocal2, q1Rest: t1.rotation, q2Rest: t2.rotation, restAngle, peak: 0, rating: j.motor?.maxTorque_Nm ?? Infinity });
    void rootA; void axisLocal2; void gap;
  }
  function localRootTransform(b: RAPIER.RigidBody): Transform {
    const p = b.translation(), r = b.rotation();
    return { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w] };
  }

  // Simulate
  const bodyRoot = instById.get('body') ?? assembly.instances[0];
  const bodyRb = bodyOf.get(bodyRoot.id)!;
  const start = localRootTransform(bodyRb);
  const frames: Trace['frames'] = [];
  const steps = Math.round(test.duration_s / DT);
  const traceEvery = Math.round(1 / (TRACE_HZ * DT));
  let maxTilt = 0, minHeight = start.position[1], fell = false, fellAt = -1;
  let energy = 0;
  const prevAngle = new Map<string, number>();
  const settle = 0.25; // seconds of settling with rest targets before the controller starts

  const snapshot = (t: number) => {
    const bodies: Record<string, Transform> = {};
    for (const g of groups) {
      const rb = bodyOf.get(g.rootId)!;
      const T = localRootTransform(rb);
      for (const m of g.members) bodies[m.id] = compose(T, localOffset.get(m.id)!);
    }
    frames.push({ t: +t.toFixed(4), bodies });
  };
  snapshot(0);

  for (let s = 1; s <= steps; s++) {
    const t = s * DT;
    const ct = t - settle;
    const targets = ct > 0 ? controlTargets(controller, ct) : null;
    for (const m of motors) {
      if (!m.joint.motor) continue;
      const t1 = localRootTransform(m.b1), t2 = localRootTransform(m.b2);
      const axisL1 = rotate(quatConj(m.q1Rest), m.axisWorld);
      const qRel = quatMul(quatConj(t1.rotation), t2.rotation);
      const angle = axisAngle(qRel, axisL1);
      const target = targets?.[m.joint.motor.controlId];
      const tgt = target === undefined ? m.restAngle : target;
      // relative angular velocity about the axis (world)
      const w1 = m.b1.angvel(), w2 = m.b2.angvel();
      const ax = rotate(t1.rotation, axisL1);
      const relVel = (w2.x - w1.x) * ax[0] + (w2.y - w1.y) * ax[1] + (w2.z - w1.z) * ax[2];
      const torque = m.joint.motor.stiffness * (tgt - angle) - m.joint.motor.damping * relVel;
      if (ct > 0) m.peak = Math.max(m.peak, Math.abs(torque));
      const pa = prevAngle.get(m.joint.id);
      if (pa !== undefined) energy += Math.abs(torque * (angle - pa));
      prevAngle.set(m.joint.id, angle);
      m.raw.configureMotorPosition(tgt, m.joint.motor.stiffness, m.joint.motor.damping);
    }
    world.step();
    const T = localRootTransform(bodyRb);
    const tilt = tiltDeg(T.rotation);
    maxTilt = Math.max(maxTilt, tilt);
    minHeight = Math.min(minHeight, T.position[1]);
    if (!fell && (tilt > 60 || T.position[1] < start.position[1] * 0.45)) { fell = true; fellAt = +t.toFixed(2); }
    if (s % traceEvery === 0) snapshot(t);
  }

  const end = localRootTransform(bodyRb);
  const distance = end.position[0] - start.position[0];
  const drift = Math.abs(end.position[2] - start.position[2]);
  const metrics: Record<string, number> = {
    distance_m: +distance.toFixed(4),
    speed_m_s: +(distance / (test.duration_s - settle)).toFixed(4),
    lateralDrift_m: +drift.toFixed(4),
    maxTilt_deg: +maxTilt.toFixed(2),
    finalTilt_deg: +tiltDeg(end.rotation).toFixed(2),
    minBodyHeight_m: +minHeight.toFixed(4),
    startBodyHeight_m: +start.position[1].toFixed(4),
    fell: fell ? 1 : 0,
    fellAt_s: fellAt,
    energyProxy_J: +energy.toFixed(4),
    duration_s: test.duration_s,
  };
  const hips = motors.filter((m) => m.joint.id.startsWith('hip_')), knees = motors.filter((m) => m.joint.id.startsWith('knee_'));
  const peak = (ms: MotorJoint[]) => ms.reduce((x, m) => Math.max(x, m.peak), 0);
  const rating = (ms: MotorJoint[]) => ms.reduce((x, m) => Math.min(x, m.rating), Infinity);
  metrics.peakHipTorque_Nm = +peak(hips).toFixed(4);
  metrics.peakKneeTorque_Nm = +peak(knees).toFixed(4);
  metrics.hipServoRating_Nm = rating(hips) === Infinity ? 0 : rating(hips);
  metrics.kneeServoRating_Nm = rating(knees) === Infinity ? 0 : rating(knees);

  if (fell) failureReasons.push(`Robot fell at t=${fellAt.toFixed(2)} s (tilt ${metrics.maxTilt_deg}°, min body height ${metrics.minBodyHeight_m} m)`);
  if (maxTilt > test.targets.maxTilt_deg && !fell) failureReasons.push(`Body tilt ${metrics.maxTilt_deg}° exceeds limit ${test.targets.maxTilt_deg}°`);
  if (test.kind === 'walk' && test.targets.minDistance_m !== undefined && distance < test.targets.minDistance_m) failureReasons.push(`Walked ${distance.toFixed(3)} m, target ${test.targets.minDistance_m} m`);
  if (test.kind === 'dance' && test.targets.maxDrift_m !== undefined && Math.hypot(distance, drift) > test.targets.maxDrift_m) failureReasons.push(`Drifted ${Math.hypot(distance, drift).toFixed(3)} m while dancing, limit ${test.targets.maxDrift_m} m`);
  if (metrics.peakHipTorque_Nm > metrics.hipServoRating_Nm) failureReasons.push(`Hip torque demand ${metrics.peakHipTorque_Nm} N·m exceeds servo rating ${metrics.hipServoRating_Nm} N·m`);
  if (metrics.peakKneeTorque_Nm > metrics.kneeServoRating_Nm) failureReasons.push(`Knee torque demand ${metrics.peakKneeTorque_Nm} N·m exceeds servo rating ${metrics.kneeServoRating_Nm} N·m`);

  world.free();
  return {
    testId: test.id,
    kind: test.kind,
    passed: failureReasons.length === 0,
    metrics,
    failureReasons,
    engine: ENGINE,
    trace: { dt: 1 / TRACE_HZ, frames },
  };
}

export function walkTest(spec: Spec, id = 'walk_1'): TestSpec {
  return { id, kind: 'walk', duration_s: spec.targets.duration_s, targets: { minDistance_m: spec.targets.walkDistance_m, maxTilt_deg: spec.targets.maxTilt_deg } };
}
export function danceTest(spec: Spec, id = 'dance_1'): TestSpec {
  return { id, kind: 'dance', duration_s: Math.min(spec.targets.duration_s, 5), targets: { maxTilt_deg: spec.targets.maxTilt_deg, maxDrift_m: 0.08 } };
}

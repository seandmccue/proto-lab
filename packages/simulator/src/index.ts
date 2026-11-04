import { receiverChecks } from '@protolab/schema';
import RAPIER from '@dimforge/rapier3d-compat';
import { measureFollowerTiming } from './follower-timing.ts';
import { measurePlanarOrbit } from './planar-orbit.ts';
import { measureIndexedMotion } from './indexed-motion.ts';
import { measureEndIn } from './end-in.ts';
import { auditFixedGeometry, auditStandalonePart, colliderAt, isPhysicalPiece } from './compound-geometry.ts';
import { inspectAssemblyIntegrity } from './assembly-integrity.ts';
import { inspectMotorizedPropellers, inspectSampledRotorClearance } from './sampled-rotor-clearance.ts';
import type { Assembly, Instance, Joint, PartDefinition, TestResult, TestSpec, Trace, Transform, Vec3, Quat, Drive, DriveProfile, Controller } from '@protolab/schema';
import { compose, invert, quatConj, quatMul, rotate, tiltDeg, transformPoint, sub, len, shapeVolume, norm, dot } from '@protolab/parts';

export type { CompoundGeometryIssue } from './compound-geometry.ts';
export type { AssemblyIntegrityIssue } from './assembly-integrity.ts';
export type { SampledRotorClearance, SampledRotorClearanceIssue } from './sampled-rotor-clearance.ts';

export const ENGINE = 'rapier3d-compat 0.14.0, fixed 1/240 s step, 30 Hz trace';
const DT = 1 / 240;
const TRACE_HZ = 30;

let ready: Promise<void> | null = null;
export function initSimulator(): Promise<void> { if (!ready) ready = RAPIER.init(); return ready; }

export interface SimEnvironment { gravity_m_s2: number; groundFriction: number }

// ---------- drive profiles ----------
export function driveValue(p: DriveProfile, t: number, ramp: number): number {
  switch (p.kind) {
    case 'constant': return ramp * p.value;
    case 'sine': return ramp * (p.offset + p.amplitude * Math.sin(2 * Math.PI * p.frequency_hz * t + p.phase)); // the ramp blends the whole target from the assembled pose, so an offset cannot slam the joint at t = 0
    case 'ramp': { const u = Math.max(0, Math.min(1, (t - p.start_s) / p.duration_s)); return p.from + (p.to - p.from) * u; }
    case 'step': return t < p.at_s ? p.before : p.after;
    case 'gait': {
      const d = p.swingDuty; const frac = (((t * p.frequency_hz + p.phase / (2 * Math.PI)) % 1) + 1) % 1;
      const inSwing = frac < d / 2 || frac > 1 - d / 2; const A = ramp * p.amplitude;
      if (p.role === 'lift') { if (!inSwing) return p.offset; const u = (frac < d / 2 ? frac + d / 2 : frac - (1 - d / 2)) / d; return p.offset + A * Math.sin(Math.PI * u); }
      if (inSwing) { const u = (frac < d / 2 ? frac + d / 2 : frac - (1 - d / 2)) / d; return p.offset - A + 2 * A * (0.5 - 0.5 * Math.cos(Math.PI * u)); }
      const s = (frac - d / 2) / (1 - d); return p.offset + A - 2 * A * s;
    }
  }
}
export function controlTargets(ctl: Controller, t: number): Record<string, { value: number; mode: 'position' | 'velocity' }> {
  const out: Record<string, { value: number; mode: 'position' | 'velocity' }> = {};
  for (const d of ctl.drives) {
    // Blend in over rampIn_s, but never approach a far-away initial position target faster than ~0.6 rad/s (or m/s):
    // a servo commanded 0.55 rad away from the assembled pose at t = 0 would otherwise spike the controller demand.
    const p0 = d.mode === 'position' ? Math.abs(driveValue(d.profile, 0, 1)) : 0;
    const dur = Math.max(d.rampIn_s, p0 / 0.6);
    const ramp = dur > 0 ? Math.min(1, t / dur) : 1;
    out[d.controlId] = { value: driveValue(d.profile, t, ramp), mode: d.mode };
  }
  return out;
}

// ---------- rigid groups ----------
interface RigidGroup { rootId: string; members: Instance[]; anchored: boolean }
function rigidGroups(a: Assembly): RigidGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const union = (x: string, y: string) => { parent.set(find(x), find(y)); };
  for (const i of a.instances) parent.set(i.id, i.id);
  for (const j of a.joints) if (j.type === 'fixed') union(j.a.instanceId, j.b.instanceId);
  const groups = new Map<string, Instance[]>();
  for (const i of a.instances) { const r = find(i.id); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); }
  return [...groups.values()].map((members) => ({ rootId: members[0].id, members, anchored: members.some((m) => m.anchored) }));
}

/** Audit physical support and fixed attachments in the assembled pose. */
export async function auditAssemblyIntegrity(assembly: Assembly) {
  await initSimulator();
  return inspectAssemblyIntegrity(assembly);
}

/** Return the controls for driven propeller groups without running a simulation. */
export function motorizedPropellerControls(assembly: Assembly): string[] {
  return [...inspectMotorizedPropellers(assembly, rigidGroups(assembly)).controls];
}

/** Independently inspect propeller clearance at the original recorded poses. */
export async function auditSampledRotorClearance(assembly: Assembly, trace: Trace) {
  await initSimulator();
  return inspectSampledRotorClearance(assembly, trace, rigidGroups(assembly));
}

/** Flag custom parts whose collision geometry has disconnected regions at rest. */
export async function auditCompoundGeometry(assembly: Assembly) {
  await initSimulator();
  return auditFixedGeometry(rigidGroups(assembly).map((group) => group.members), assembly.parts);
}

/** Inspect a part before other pieces can bridge it in an assembly. */
export async function auditPartGeometry(part: PartDefinition) {
  await initSimulator();
  return auditStandalonePart(part);
}

function axisAngle(q: Quat, axis: Vec3): number {
  const [x, y, z, w] = q; const proj = x * axis[0] + y * axis[1] + z * axis[2];
  const n = Math.hypot(proj, w) || 1; const ang = 2 * Math.atan2(proj / n, w / n); return Math.atan2(Math.sin(ang), Math.cos(ang));
}

export interface RunOptions {
  env: SimEnvironment;
  test: TestSpec;
  controller?: Controller;
  /** Observe ground contact for extra instances without changing the authored test or solver. */
  additionalNoGroundContact?: string[];
}

export async function runTest(assembly: Assembly, opts: RunOptions): Promise<TestResult> {
  await initSimulator();
  const { env, test } = opts;
  const controller = opts.controller ?? assembly.controller;
  const world = new RAPIER.World({ x: 0, y: -Math.abs(env.gravity_m_s2), z: 0 });
  world.timestep = DT; world.integrationParameters.numSolverIterations = 8;
  const events = new RAPIER.EventQueue(true);

  // Ground: group 4; structure: group 1; contact pieces: group 2; free bodies: group 8. Parts of the same machine do not collide
  // with each other except declared clearance pairs (group 16 each side) and free bodies, which collide with everything.
  const GROUND = 0x0004, STRUCT = 0x0001, CONTACT = 0x0002, FREE = 0x0008, CLEAR = 0x0010;
  const groups = (mem: number, filt: number) => ((mem & 0xffff) << 16) | (filt & 0xffff);
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  const groundCol = world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.05, 30).setFriction(env.groundFriction).setRestitution(0).setCollisionGroups(groups(GROUND, 0xffff)), ground);

  const partById = new Map(assembly.parts.map((p) => [p.id, p]));
  const instById = new Map(assembly.instances.map((i) => [i.id, i]));
  const rgroups = rigidGroups(assembly);
  const bodyOf = new Map<string, RAPIER.RigidBody>();
  const localOffset = new Map<string, Transform>();
  const colliderOwner = new Map<number, string>(); // collider handle -> instance id
  const failureReasons: string[] = []; const notes: string[] = [];
  const clearSet = new Set<string>(test.kind === 'motion' ? test.measure.clearancePairs.flat() : []);
  // Two parts joined by a bearing touch each other at that bearing by construction; that is not a clearance violation.
  const joined = new Set<string>(assembly.joints.map((j) => [j.a.instanceId, j.b.instanceId].sort().join('|')));
  const noGround = new Set<string>(test.kind === 'motion' ? test.measure.noGroundContact : []);
  const automaticNoGround = new Set(opts.additionalNoGroundContact);
  for (const id of noGround) automaticNoGround.delete(id);

  for (const g of rgroups) {
    const root = instById.get(g.rootId)!;
    // Every rigid body starts with an identity rotation (world-aligned frame) so that joint axes are the same in both
    // bodies' local frames at rest; the instance rotations live in the collider offsets instead.
    const desc = (g.anchored ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(...root.transform.position).setCanSleep(false);
    const rb = world.createRigidBody(desc);
    const invRoot = invert({ position: root.transform.position, rotation: [0, 0, 0, 1] });
    for (const inst of g.members) {
      const part = partById.get(inst.partId); if (!part) throw new Error(`Instance ${inst.id} references unknown part ${inst.partId}`);
      const rel = compose(invRoot, inst.transform);
      localOffset.set(inst.id, rel); bodyOf.set(inst.id, rb);
      const totalVol = part.geometry.reduce((s, gp) => s + shapeVolume(gp.shape), 0) || 1;
      let any = false;
      for (const piece of part.geometry) {
        if (!isPhysicalPiece(piece)) continue;
        const cd = colliderAt(piece.shape, compose(rel, piece.offset));
        if (!cd) continue;
        cd.setMass(Math.max(1e-5, part.mass_kg * (shapeVolume(piece.shape) / totalVol)));
        cd.setFriction(piece.friction ?? (piece.role === 'contact' || piece.role === 'payload' ? env.groundFriction : 0.5)).setRestitution(piece.role === 'payload' ? 0.2 : 0);
        const isFree = inst.free, isClear = clearSet.has(inst.id);
        const mem = (isFree ? FREE : piece.role === 'contact' ? CONTACT : STRUCT) | (isClear ? CLEAR : 0);
        const filt = isFree ? 0xffff : GROUND | FREE | (isClear ? CLEAR : 0);   // free bodies collide with everything
        cd.setCollisionGroups(groups(mem, filt)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const col = world.createCollider(cd, rb); colliderOwner.set(col.handle, inst.id); any = true;
      }
      if (!any) { const col = world.createCollider(RAPIER.ColliderDesc.ball(0.002).setMass(part.mass_kg).setTranslation(...rel.position).setCollisionGroups(groups(0, 0)), rb); colliderOwner.set(col.handle, inst.id); }
    }
  }

  // joints
  interface SimJoint { joint: Joint; raw: RAPIER.ImpulseJoint; b1: RAPIER.RigidBody; b2: RAPIER.RigidBody; axisL1: Vec3; axisWorld: Vec3; restAngle: number; restOffset: Vec3; peak: number; rating: number; satSteps: number; peakRate: number; cycles: number; lastDir: number; angle: number; lastAngle: number; revs: number; minA: number; maxA: number }
  const sims: SimJoint[] = [];
  const rootT = (b: RAPIER.RigidBody): Transform => { const p = b.translation(), r = b.rotation(); return { position: [p.x, p.y, p.z], rotation: [r.x, r.y, r.z, r.w] }; };
  for (const j of assembly.joints) {
    if (j.type === 'fixed') continue;
    const ia = instById.get(j.a.instanceId)!, ib = instById.get(j.b.instanceId)!;
    const b1 = bodyOf.get(ia.id)!, b2 = bodyOf.get(ib.id)!;
    if (b1 === b2) { notes.push(`Joint ${j.id} connects two instances already rigidly joined; ignored`); continue; }
    const pa = partById.get(ia.partId)!, pb = partById.get(ib.partId)!;
    const ca = pa.connectors.find((c) => c.id === j.a.connectorId)!, cb = pb.connectors.find((c) => c.id === j.b.connectorId)!;
    const wa = j.anchor ?? transformPoint(ia.transform, ca.position), wb = transformPoint(ib.transform, cb.position);
    const axisWorld = norm(j.axis ?? rotate(ia.transform.rotation, ca.axis));
    const t1 = rootT(b1), t2 = rootT(b2);   // identity rotations at rest
    const a1 = sub(wa, t1.position), a2 = sub(j.type === 'spring' ? wb : wa, t2.position);
    const axisL1 = axisWorld, axisL2 = axisWorld;
    let data: RAPIER.JointData;
    if (j.type === 'revolute') data = RAPIER.JointData.revolute({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: axisL1[0], y: axisL1[1], z: axisL1[2] });
    else if (j.type === 'prismatic') data = RAPIER.JointData.prismatic({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: axisL1[0], y: axisL1[1], z: axisL1[2] });
    else { data = RAPIER.JointData.spring(j.spring?.restLength_m ?? len(sub(wa, wb)), j.spring?.stiffness ?? 200, j.spring?.damping ?? 0.5, { x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }); }
    const raw = world.createImpulseJoint(data, b1, b2, true);
    raw.setContactsEnabled(false); // the two parts share a bearing: their hub and boss may overlap, they must not collide
    const restAngle = 0; // joint coordinates are measured from the assembled rest pose
    const restOffset = sub(t2.position, t1.position);
    if (j.limits && j.type !== 'spring') (raw as RAPIER.RevoluteImpulseJoint).setLimits(j.limits[0], j.limits[1]);
    if (j.motor && (j.type === 'revolute' || j.type === 'prismatic')) {
      const m = raw as RAPIER.RevoluteImpulseJoint; m.configureMotorModel(RAPIER.MotorModel.ForceBased); m.configureMotorPosition(restAngle, j.motor.stiffness, j.motor.damping);
    }
    sims.push({ joint: j, raw, b1, b2, axisL1, axisWorld, restAngle, restOffset, peak: 0, rating: j.motor?.maxTorque_Nm ?? j.motor?.maxForce_N ?? Infinity, satSteps: 0, peakRate: 0, cycles: 0, lastDir: 0, angle: restAngle, lastAngle: restAngle, revs: 0, minA: restAngle, maxA: restAngle });
    void axisL2;
  }
  // Note: Rapier's JS revolute takes one local axis for both bodies; valid when both bodies share the axis frame at rest (true for our mates).

  // measurement setup
  const baseId = test.kind === 'walk' ? test.base : test.kind === 'motion' ? test.measure.base : test.kind === 'grip' ? test.holder : undefined;
  const baseRb = baseId ? bodyOf.get(baseId) : undefined;
  if (!assembly.instances.length) failureReasons.push('There are no parts to test');
  for (const id of automaticNoGround) {
    if (!instById.has(id)) failureReasons.push(`Automatic ground check instance "${id}" not found`);
  }
  if (baseId && !baseRb) failureReasons.push(`Base instance "${baseId}" not found`);
  const projRb = test.kind === 'launch' ? bodyOf.get(test.projectile) : undefined;
  if (test.kind === 'launch' && !projRb) failureReasons.push(`Projectile instance "${test.projectile}" not found`);
  const payRb = test.kind === 'grip' ? bodyOf.get(test.payload) : undefined;
  if (test.kind === 'grip' && !payRb) failureReasons.push(`Payload instance "${test.payload}" not found`);
  const ctlJoints = new Map(sims.filter((s) => s.joint.motor).map((s) => [s.joint.motor!.controlId, s]));
  const motionMeasure = test.kind === 'motion' ? test.measure : undefined;
  const uprightTilt = new Map((motionMeasure?.uprightInstances ?? []).map((id) => [id, 0]));
  const linearTravel = (motionMeasure?.linearTravel ?? []).map((target) => ({
    ...target, coordinate: target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2, min: Infinity, max: -Infinity,
  }));
  const synchronizedTravel = motionMeasure?.synchronizedTravel;
  const liftPayload = motionMeasure?.payload;
  if (test.kind === 'motion') {
    const { measure, criteria } = test;
    const measured = sims.filter(({ joint }) => joint.motor && (!measure.joints.length || measure.joints.includes(joint.motor.controlId)));
    for (const id of measure.joints) if (!measured.some(({ joint }) => joint.motor?.controlId === id)) failureReasons.push(`Measured motor "${id}" not found`);
    const jointThreshold = criteria.minJointAmplitude_rad !== undefined || criteria.minJointRate_rad_s !== undefined || criteria.minRevolutions !== undefined;
    const baseThreshold = criteria.maxBaseTilt_deg !== undefined || criteria.maxBaseDrift_m !== undefined;
    const liftThreshold = criteria.minPayloadLift_m !== undefined || criteria.maxPayloadReturnError_m !== undefined;
    const retentionThreshold = criteria.maxPayloadSeparation_m !== undefined;
    const tiltThreshold = criteria.maxInstanceTilt_deg !== undefined;
    if (jointThreshold && !measured.length) failureReasons.push('A joint threshold needs a measurable motorized joint');
    for (const { joint } of measure.jointSwing ?? []) {
      if (ctlJoints.get(joint)?.joint.type !== 'revolute') {
        failureReasons.push(`Swing joint "${joint}" must be a motorized revolute joint`);
      }
    }
    if (baseThreshold && !baseRb) failureReasons.push('A base threshold needs a base instance');
    if (tiltThreshold && !uprightTilt.size) failureReasons.push('An instance tilt threshold needs uprightInstances');
    for (const id of uprightTilt.keys()) if (!instById.has(id)) failureReasons.push(`Upright instance "${id}" not found`);
    for (const { instance } of linearTravel) if (!instById.has(instance)) failureReasons.push(`Travel instance "${instance}" not found`);
    if (synchronizedTravel) {
      const { instances } = synchronizedTravel;
      if (new Set(instances).size !== instances.length) failureReasons.push('Synchronized travel needs different instances');
      for (const id of instances) if (!instById.has(id)) failureReasons.push(`Synchronized travel instance "${id}" not found`);
    }
    const endIn = measure.endIn;
    for (const { check: target } of receiverChecks(endIn)) {
      if (target.instance === target.receiver) failureReasons.push('End-in target and receiver must be different instances');
      for (const id of [target.instance, target.receiver]) if (!instById.has(id)) failureReasons.push(`End-in instance "${id}" not found`);
    }
    const indexed = measure.indexedMotion;
    if (indexed) {
      if (ctlJoints.get(indexed.input)?.joint.type !== 'revolute') failureReasons.push(`Indexed motion input "${indexed.input}" must be a motorized revolute joint`);
      if (indexed.body === indexed.center) failureReasons.push('Indexed motion marker and center must be different instances');
      for (const id of [indexed.body, indexed.center]) if (!instById.has(id)) failureReasons.push(`Indexed motion instance "${id}" not found`);
      if (indexed.stepTolerance_deg >= indexed.step_deg / 2 || indexed.maxDwellDrift_deg >= indexed.step_deg / 2) {
        failureReasons.push('Indexed motion step tolerance and dwell drift must be less than half a step');
      }
    }
    if (measure.followerTiming) {
      const { shaft, followers, minPhaseGap_deg, maxPhaseGap_deg } = measure.followerTiming;
      if (!sims.some(({ joint }) => joint.type === 'revolute' && joint.motor?.controlId === shaft)) {
        failureReasons.push(`Follower timing shaft "${shaft}" must be a motorized revolute joint`);
      }
      if (new Set(followers).size !== followers.length) failureReasons.push('Follower timing needs different instances for each follower');
      if (maxPhaseGap_deg !== undefined && maxPhaseGap_deg < minPhaseGap_deg) {
        failureReasons.push('Follower timing maximum phase gap must be at least the minimum phase gap');
      }
      for (const id of followers) if (!instById.has(id)) failureReasons.push(`Follower timing instance "${id}" not found`);
    }
    const orbits = measure.orbits ?? [];
    if (new Set(orbits.map(({ body }) => body)).size !== orbits.length) failureReasons.push('Each orbit must measure a different body');
    for (const { body, center, reference, minRadius_m, maxRadius_m } of orbits) {
      if (body === center) failureReasons.push(`Orbit body "${body}" must differ from its center`);
      const references = typeof reference === 'string' ? [reference] : reference ? [reference.from, reference.to] : [];
      if (reference && typeof reference !== 'string' && reference.from === reference.to) {
        failureReasons.push(`Orbit reference for "${body}" needs two different instances`);
      }
      for (const id of new Set([body, center, ...references])) {
        if (!instById.has(id)) failureReasons.push(`Orbit instance "${id}" not found`);
      }
      if (minRadius_m !== undefined && maxRadius_m !== undefined && maxRadius_m < minRadius_m) {
        failureReasons.push(`Orbit maximum radius for "${body}" must be at least the minimum radius`);
      }
    }
    if (liftThreshold && !liftPayload) failureReasons.push('A payload height threshold needs a payload instance');
    if (retentionThreshold && !liftPayload?.holder) failureReasons.push('A retention threshold needs a payload and holder instance');
    if (liftPayload) {
      if (!instById.has(liftPayload.instance)) failureReasons.push(`Payload instance "${liftPayload.instance}" not found`);
      if (liftPayload.holder && !instById.has(liftPayload.holder)) failureReasons.push(`Holder instance "${liftPayload.holder}" not found`);
      if (liftPayload.holder === liftPayload.instance) failureReasons.push('Payload and holder must be different instances');
    }
    for (const id of new Set([...measure.clearancePairs.flat(), ...measure.noGroundContact])) {
      if (!instById.has(id)) failureReasons.push(`Contact check instance "${id}" not found`);
    }
    if (!jointThreshold && !measure.jointSwing?.length && !baseThreshold && !tiltThreshold && !liftThreshold && !retentionThreshold && !linearTravel.length && !synchronizedTravel && !orbits.length && !indexed && !endIn && !measure.followerTiming && !measure.clearancePairs.length && !measure.noGroundContact.length && !(criteria.torqueWithinRating && measured.some(({ rating }) => Number.isFinite(rating)))) {
      failureReasons.push('Motion test needs at least one measurable criterion');
    }
  }
  let support: RAPIER.Collider | null = null;
  if (test.kind === 'grip' && payRb) { const p = payRb.translation(); const pi = instById.get(test.payload)!; const pp = partById.get(pi.partId)!; const h = pp.dimensions_m[1] / 2; const sb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y - h - 0.005, p.z)); support = world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 0.005, 0.05).setFriction(0.3).setCollisionGroups(groups(GROUND, FREE)), sb); }
  if (failureReasons.length) { events.free(); world.free(); return { testId: test.id, kind: test.kind, passed: false, metrics: {}, failureReasons, notes, engine: ENGINE, trace: { dt: 1 / TRACE_HZ, frames: [] } }; }

  const start = baseRb ? rootT(baseRb) : rootT(bodyOf.get(assembly.instances[0].id)!);
  const projStart = projRb ? rootT(projRb) : null; const payStart = payRb ? rootT(payRb) : null; const holderStart = test.kind === 'grip' ? rootT(bodyOf.get(test.holder)!) : null;
  const frames: Trace['frames'] = []; const steps = Math.round(test.duration_s / DT); const traceEvery = Math.round(1 / (TRACE_HZ * DT));
  let maxTilt = 0, minHeight = start.position[1], fell = false, fellAt = -1, energy = 0;
  const settle = 0.25;
  let payloadGrounded = false;
  const instancePose = (id: string) => compose(rootT(bodyOf.get(id)!), localOffset.get(id)!);
  const syncCoordinate = synchronizedTravel?.axis === 'x' ? 0 : synchronizedTravel?.axis === 'y' ? 1 : 2;
  const syncTracks = synchronizedTravel?.instances.map((instance) => ({
    instance, start: instancePose(instance).position[syncCoordinate], min: 0, max: 0,
  })) ?? [];
  let peakSyncSpread = 0;
  const payloadStartHeight = liftPayload ? instancePose(liftPayload.instance).position[1] : 0;
  let payloadHeight = payloadStartHeight, maxPayloadHeight = payloadStartHeight, maxPayloadSeparation = 0;
  const trackMotionInstances = () => {
    for (const [id, maxTilt] of uprightTilt) uprightTilt.set(id, Math.max(maxTilt, tiltDeg(instancePose(id).rotation)));
    for (const travel of linearTravel) {
      const position = instancePose(travel.instance).position[travel.coordinate];
      travel.min = Math.min(travel.min, position);
      travel.max = Math.max(travel.max, position);
    }
    if (syncTracks.length) {
      const displacements = syncTracks.map((track) => {
        const displacement = instancePose(track.instance).position[syncCoordinate] - track.start;
        track.min = Math.min(track.min, displacement);
        track.max = Math.max(track.max, displacement);
        return displacement;
      });
      peakSyncSpread = Math.max(peakSyncSpread, Math.max(...displacements) - Math.min(...displacements));
    }
    if (liftPayload) {
      const load = instancePose(liftPayload.instance).position;
      payloadHeight = load[1];
      maxPayloadHeight = Math.max(maxPayloadHeight, payloadHeight);
      if (liftPayload.holder) maxPayloadSeparation = Math.max(maxPayloadSeparation, len(sub(load, instancePose(liftPayload.holder).position)));
    }
  };
  let clearanceHit: string | null = null, groundHit: string | null = null, landing: Vec3 | null = null, maxProjHeight = projStart?.position[1] ?? 0, released = false;
  const automaticGroundHits = new Map<string, number>();
  const snapshot = (t: number) => {
    const bodies: Record<string, Transform> = {}; const joints: Record<string, number> = {};
    for (const g of rgroups) { const T = rootT(bodyOf.get(g.rootId)!); for (const m of g.members) bodies[m.id] = compose(T, localOffset.get(m.id)!); }
    for (const s of sims) if (s.joint.motor) joints[s.joint.motor.controlId] = +s.angle.toFixed(4);
    frames.push({ t: +t.toFixed(4), bodies, joints });
  };
  snapshot(0);
  trackMotionInstances();

  for (let n = 1; n <= steps; n++) {
    const t = n * DT, ct = t - settle;
    const targets = ct > 0 ? controlTargets(controller, ct) : null;
    for (const s of sims) {
      if (s.joint.type === 'spring') continue;
      const t1 = rootT(s.b1), t2 = rootT(s.b2);
      let angle: number;
      if (s.joint.type === 'revolute') { const qRel = quatMul(quatConj(t1.rotation), t2.rotation); const raw = axisAngle(qRel, s.axisL1); let d = raw - (s.lastAngle - 2 * Math.PI * s.revs); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; angle = s.lastAngle + d; }
      else { const ax = rotate(t1.rotation, s.axisL1); angle = dot(sub(sub(t2.position, t1.position), rotate(t1.rotation, s.restOffset)), ax); }
      const prevAngle = s.angle;
      if (ct > 0) { const rate = Math.abs(angle - prevAngle) / DT; s.peakRate = Math.max(s.peakRate, rate); const dir = Math.sign(angle - prevAngle); if (dir !== 0 && s.lastDir !== 0 && dir !== s.lastDir && rate > 0.02) s.cycles += 0.5; if (dir !== 0) s.lastDir = dir; }
      s.lastAngle = angle; s.angle = angle; s.revs = Math.floor((angle - s.restAngle) / (2 * Math.PI)); s.minA = Math.min(s.minA, angle); s.maxA = Math.max(s.maxA, angle);
      if (!s.joint.motor) continue;
      const tg = targets?.[s.joint.motor.controlId];
      const m = s.raw as RAPIER.RevoluteImpulseJoint;
      const w1 = s.b1.angvel(), w2 = s.b2.angvel(); const ax = rotate(t1.rotation, s.axisL1);
      const relVel = s.joint.type === 'revolute' ? (w2.x - w1.x) * ax[0] + (w2.y - w1.y) * ax[1] + (w2.z - w1.z) * ax[2] : (() => { const v1 = s.b1.linvel(), v2 = s.b2.linvel(); return (v2.x - v1.x) * ax[0] + (v2.y - v1.y) * ax[1] + (v2.z - v1.z) * ax[2]; })();
      // Demand = what the controller asks for; the applied effort is saturated at the motor rating (a real servo stalls).
      let effort: number; const rating = s.rating;
      if (tg?.mode === 'velocity') {
        const factor = s.joint.motor.damping + s.joint.motor.stiffness; effort = factor * (tg.value - relVel);
        const f = Number.isFinite(rating) && Math.abs(effort) > rating ? rating / Math.abs(tg.value - relVel || 1e-6) : factor;
        m.configureMotorVelocity(tg.value, f);
      } else {
        const target = tg ? tg.value : s.restAngle; const err = target - angle;
        effort = s.joint.motor.stiffness * err - s.joint.motor.damping * relVel;
        const k = Number.isFinite(rating) && Math.abs(s.joint.motor.stiffness * err) > rating ? rating / Math.max(1e-6, Math.abs(err)) : s.joint.motor.stiffness;
        m.configureMotorPosition(target, k, s.joint.motor.damping);
      }
      if (ct > 0) { s.peak = Math.max(s.peak, Math.abs(effort)); if (Number.isFinite(rating) && Math.abs(effort) > rating) s.satSteps++; }
      energy += Math.abs(Math.min(Math.abs(effort), rating) * (angle - prevAngle));
    }
    world.step(events);
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const i1 = colliderOwner.get(h1), i2 = colliderOwner.get(h2);
      const isG = h1 === groundCol.handle || h2 === groundCol.handle;
      if (isG) { const other = h1 === groundCol.handle ? i2 : i1; if (other && noGround.has(other) && !groundHit) groundHit = other;
        if (other && automaticNoGround.has(other) && !automaticGroundHits.has(other)) automaticGroundHits.set(other, t);
        if (test.kind === 'grip' && other === test.payload && t >= test.supportUntil_s && !payloadGrounded) payloadGrounded = true; // a payload that lands on the floor was not held
        if (test.kind === 'launch' && other === test.projectile && released && !landing) { const p = projRb!.translation(); landing = [p.x, p.y, p.z]; } }
      else if (i1 && i2 && !clearanceHit && test.kind === 'motion' && !joined.has([i1, i2].sort().join('|'))) { for (const [a, b] of test.measure.clearancePairs) if ((a === i1 && b === i2) || (a === i2 && b === i1)) clearanceHit = `${i1} touched ${i2}`; }
    });
    if (support && test.kind === 'grip' && t >= test.supportUntil_s) { world.removeCollider(support, false); support = null; }
    if (baseRb) { const T = rootT(baseRb); const tilt = tiltDeg(T.rotation); maxTilt = Math.max(maxTilt, tilt); minHeight = Math.min(minHeight, T.position[1]); if (!fell && !instById.get(baseId!)!.anchored && (tilt > 60 || T.position[1] < start.position[1] * 0.45)) { fell = true; fellAt = +t.toFixed(2); } }
    if (projRb) { const p = projRb.translation(); maxProjHeight = Math.max(maxProjHeight, p.y); if (!released && ct > 0 && len(sub([p.x, p.y, p.z], projStart!.position)) > 0.08) released = true; }
    trackMotionInstances();
    if (n % traceEvery === 0) snapshot(t);
  }

  const metrics: Record<string, number> = { duration_s: test.duration_s, energyProxy_J: +energy.toFixed(4) };
  if (baseRb) { const end = rootT(baseRb); metrics.baseDisplacement_m = +len(sub(end.position, start.position)).toFixed(4); metrics.maxTilt_deg = +maxTilt.toFixed(2); metrics.fell = fell ? 1 : 0; metrics.fellAt_s = fellAt; metrics.minBaseHeight_m = +minHeight.toFixed(4); }
  const jointStats = (ids: string[]) => ids.map((id) => ctlJoints.get(id)).filter(Boolean) as SimJoint[];
  const reportJoint = (s: SimJoint, prefix: string) => { const rev = s.joint.type === 'revolute'; metrics[`${prefix}.amplitude_${rev ? 'rad' : 'm'}`] = +(s.maxA - s.minA).toFixed(4); metrics[`${prefix}.revolutions`] = +((s.maxA - s.minA) / (2 * Math.PI)).toFixed(3); metrics[`${prefix}.peakRate_${rev ? 'rad_s' : 'm_s'}`] = +s.peakRate.toFixed(3); metrics[`${prefix}.cycles_hz`] = +(s.cycles / Math.max(0.1, test.duration_s - settle)).toFixed(2); metrics[`${prefix}.peak${rev ? 'Torque_Nm' : 'Force_N'}`] = +s.peak.toFixed(4); metrics[`${prefix}.rating`] = s.rating === Infinity ? 0 : s.rating; };
  // A motor is overloaded when it sits at its rating for a meaningful share of the run or the demand is far past it.
  // A brief transient a few percent over (saturated < 3 % of steps) is reported as a note, not a failure, so a
  // borderline design does not burn a whole iteration on a 1 % overshoot.
  const torqueFail: string[] = []; const torqueNotes: string[] = []; const activeSteps = Math.max(1, steps - Math.round(settle / DT));
  for (const s of sims) if (s.joint.motor && s.rating !== Infinity && s.peak > s.rating) {
    const satFrac = s.satSteps / activeSteps; const line = `${s.joint.motor.controlId}: demand ${s.peak.toFixed(3)} > rating ${s.rating} (saturated ${Math.round(100 * satFrac)} % of the time)`;
    if (satFrac >= 0.03 || s.peak > s.rating * 1.5) torqueFail.push(line); else torqueNotes.push(line);
  }
  const allMotor = sims.filter((s) => s.joint.motor);
  metrics.peakMotorEffort = +Math.max(0, ...allMotor.map((s) => s.peak)).toFixed(4);
  metrics.motorSaturation_fraction = +(allMotor.length ? Math.max(...allMotor.map((s) => s.satSteps / activeSteps)) : 0).toFixed(3);
  const saturationNote = () => { if (torqueFail.length) notes.push(`Motor saturation (applied torque was capped at the rating): ${torqueFail.slice(0, 3).join('; ')}`); if (torqueNotes.length) notes.push(`Brief peaks over rating (tolerated, < 3 % of the run): ${torqueNotes.slice(0, 3).join('; ')}`); };

  switch (test.kind) {
    case 'walk': {
      const end = rootT(baseRb!); const ax = test.direction === 'x' ? 0 : test.direction === 'y' ? 1 : 2; const signedDist = end.position[ax] - start.position[ax];
      const dist = test.signed ? signedDist : Math.abs(signedDist);
      metrics.distance_m = +dist.toFixed(4); metrics.signedDistance_m = +signedDist.toFixed(4); metrics.travelSign = Math.sign(signedDist); metrics.speed_m_s = +(dist / (test.duration_s - settle)).toFixed(4); metrics.lateralDrift_m = +Math.abs(end.position[ax === 0 ? 2 : 0] - start.position[ax === 0 ? 2 : 0]).toFixed(4);
      const hips = allMotor.filter((s) => /hip/i.test(s.joint.motor!.controlId)), knees = allMotor.filter((s) => /knee/i.test(s.joint.motor!.controlId));
      if (hips.length) { metrics.peakHipTorque_Nm = +Math.max(...hips.map((s) => s.peak)).toFixed(4); metrics.hipServoRating_Nm = Math.min(...hips.map((s) => s.rating)); }
      if (knees.length) { metrics.peakKneeTorque_Nm = +Math.max(...knees.map((s) => s.peak)).toFixed(4); metrics.kneeServoRating_Nm = Math.min(...knees.map((s) => s.rating)); }
      if (fell) failureReasons.push(`Fell at t=${fellAt.toFixed(2)} s (tilt ${metrics.maxTilt_deg}°, min base height ${metrics.minBaseHeight_m} m)`);
      if (!fell && maxTilt > test.maxTilt_deg) failureReasons.push(`Tilt ${metrics.maxTilt_deg}° exceeds limit ${test.maxTilt_deg}°`);
      if (dist < test.minDistance_m) failureReasons.push(`Walked ${dist.toFixed(3)} m, target ${test.minDistance_m} m`);
      if (!test.signed && signedDist < 0 && dist >= test.minDistance_m) notes.push(`Travelled ${Math.abs(signedDist).toFixed(3)} m toward −${test.direction}; the test accepts either sense. Flip the hip drive signs to reverse.`);
      if (torqueFail.length) failureReasons.push(`Motor demand exceeds rating: ${torqueFail.slice(0, 3).join('; ')}`);
      break;
    }
    case 'motion': {
      const js = jointStats(test.measure.joints.length ? test.measure.joints : [...ctlJoints.keys()]);
      for (const s of js) reportJoint(s, s.joint.motor!.controlId);
      const c = test.criteria;
      for (const { joint, minEachWay_rad } of test.measure.jointSwing ?? []) {
        const { minA, maxA } = ctlJoints.get(joint)!;
        metrics[`${joint}.minSwing_rad`] = +minA.toFixed(4);
        metrics[`${joint}.maxSwing_rad`] = +maxA.toFixed(4);
        if (minA > -minEachWay_rad || maxA < minEachWay_rad) {
          failureReasons.push(`${joint} swung from ${minA.toFixed(3)} to ${maxA.toFixed(3)} rad, target ±${minEachWay_rad} rad`);
        }
      }
      if (c.minJointAmplitude_rad !== undefined) for (const s of js) if (s.maxA - s.minA < c.minJointAmplitude_rad) failureReasons.push(`${s.joint.motor!.controlId} amplitude ${(s.maxA - s.minA).toFixed(3)} < ${c.minJointAmplitude_rad}`);
      if (c.minRevolutions !== undefined) for (const s of js) if ((s.maxA - s.minA) / (2 * Math.PI) < c.minRevolutions) failureReasons.push(`${s.joint.motor!.controlId} turned ${((s.maxA - s.minA) / (2 * Math.PI)).toFixed(2)} rev < ${c.minRevolutions}`);
      if (c.minJointRate_rad_s !== undefined) for (const s of js) if (s.peakRate < c.minJointRate_rad_s) failureReasons.push(`${s.joint.motor!.controlId} peak rate ${s.peakRate.toFixed(2)} rad/s < ${c.minJointRate_rad_s}`);
      if (baseRb && c.maxBaseTilt_deg !== undefined && maxTilt > c.maxBaseTilt_deg) failureReasons.push(`Base tilt ${metrics.maxTilt_deg}° exceeds ${c.maxBaseTilt_deg}°`);
      if (baseRb && c.maxBaseDrift_m !== undefined && metrics.baseDisplacement_m > c.maxBaseDrift_m) failureReasons.push(`Base drifted ${metrics.baseDisplacement_m} m > ${c.maxBaseDrift_m} m`);
      if (baseRb && fell) failureReasons.push(`Base fell over at t=${fellAt} s`);
      for (const { instance, axis, minTravel_m, min, max } of linearTravel) {
        const travel = max - min;
        metrics[`${instance}.travel_${axis}_m`] = +travel.toFixed(4);
        if (travel < minTravel_m) failureReasons.push(`${instance} travelled ${travel.toFixed(3)} m along ${axis}, target ${minTravel_m} m`);
      }
      if (synchronizedTravel) {
        const minTravel = Math.min(...syncTracks.map(({ min, max }) => max - min));
        metrics.synchronizedMinTravel_m = +minTravel.toFixed(5);
        metrics.synchronizedMaxSpread_m = +peakSyncSpread.toFixed(5);
        if (minTravel < synchronizedTravel.minTravel_m) {
          failureReasons.push(`Shortest synchronized travel was ${(minTravel * 1000).toFixed(1)} mm, target ${synchronizedTravel.minTravel_m * 1000} mm`);
        }
        if (peakSyncSpread > synchronizedTravel.maxSpread_m) {
          failureReasons.push(`Synchronized displacement spread reached ${(peakSyncSpread * 1000).toFixed(1)} mm, limit ${synchronizedTravel.maxSpread_m * 1000} mm`);
        }
      }
      for (const orbit of test.measure.orbits ?? []) {
        const { body, center, minTurns, direction } = orbit;
        const path = measurePlanarOrbit({ frames, dt: 1 / TRACE_HZ }, orbit);
        if (!path) {
          failureReasons.push(`Orbit of "${body}" around "${center}" could not be measured from the trace`);
          continue;
        }
        const { signedTurns, minRadius_m, maxRadius_m } = path;
        metrics[`${body}.orbitSignedTurns`] = +signedTurns.toFixed(3);
        metrics[`${body}.orbitMinRadius_m`] = +minRadius_m.toFixed(4);
        metrics[`${body}.orbitMaxRadius_m`] = +maxRadius_m.toFixed(4);
        const turns = direction === 'positive' ? signedTurns : direction === 'negative' ? -signedTurns : Math.abs(signedTurns);
        if (turns < minTurns) failureReasons.push(`${body} completed ${turns.toFixed(2)} ${direction ? direction + ' ' : ''}orbit turns, target ${minTurns}`);
        if (orbit.minRadius_m !== undefined && minRadius_m < orbit.minRadius_m) {
          failureReasons.push(`${body} orbit radius fell to ${minRadius_m.toFixed(3)} m, minimum ${orbit.minRadius_m} m`);
        }
        if (orbit.maxRadius_m !== undefined && maxRadius_m > orbit.maxRadius_m) {
          failureReasons.push(`${body} orbit radius reached ${maxRadius_m.toFixed(3)} m, maximum ${orbit.maxRadius_m} m`);
        }
      }
      for (const { check: endIn, holdKey, marginKey } of receiverChecks(test.measure.endIn)) {
        const result = measureEndIn({ frames, dt: 1 / TRACE_HZ }, endIn);
        if (!result) {
          failureReasons.push(`Final receiver occupancy for ${endIn.instance} in ${endIn.receiver} could not be measured from the trace`);
        } else {
          metrics[holdKey] = +result.hold_s.toFixed(4);
          metrics[marginKey] = +result.finalMargin_m.toFixed(5);
          if (result.hold_s + 1e-8 < endIn.minHold_s) {
            const center = endIn.centerOffset_m ?? [0, 0, 0];
            const mm = (meters: number) => (meters * 1000).toFixed(2);
            const position = result.finalLocalPosition_m.map(mm).join(', ');
            const bounds = endIn.halfExtents_m.map((half, axis) =>
              `${'XYZ'[axis]} [${mm(center[axis] - half)}, ${mm(center[axis] + half)}]`).join(', ');
            failureReasons.push(`${endIn.instance} ended inside ${endIn.receiver} for ${result.hold_s.toFixed(2)} s, target ${endIn.minHold_s} s. Final center in receiver-local XYZ [${position}] mm, allowed bounds ${bounds} mm`);
          }
        }
      }
      const indexed = test.measure.indexedMotion;
      if (indexed) {
        const result = measureIndexedMotion({ frames, dt: 1 / TRACE_HZ }, indexed);
        if (!result) {
          failureReasons.push('Indexed motion could not be measured from the recorded input and marker');
        } else {
          metrics.indexedConsecutiveSteps = result.consecutiveSteps;
          if (result.consecutiveSteps < indexed.minSteps) {
            failureReasons.push(`Measured ${result.consecutiveSteps} consecutive ${indexed.step_deg}° steps with dwell, target ${indexed.minSteps}`);
          }
        }
      }
      const timing = test.measure.followerTiming;
      if (timing) {
        const cycles = measureFollowerTiming({ frames, dt: 1 / TRACE_HZ }, timing);
        metrics.followerCycles = cycles.length;
        if (cycles.length < timing.minCycles) failureReasons.push(`Follower timing recorded ${cycles.length} complete turns after startup, target ${timing.minCycles}`);
        if (cycles.length) {
          const gap = Math.min(...cycles.map(({ phaseGap_deg }) => phaseGap_deg));
          metrics.followerPhaseGap_deg = +gap.toFixed(2);
          if (gap < timing.minPhaseGap_deg) failureReasons.push(`Follower peaks were only ${gap.toFixed(1)}° apart, target ${timing.minPhaseGap_deg}°`);
          if (timing.followers.length === 3 || timing.maxPhaseGap_deg !== undefined) {
            const maxGap = Math.max(...cycles.flatMap(({ phaseGaps_deg }) => phaseGaps_deg));
            metrics.followerMaxPhaseGap_deg = +maxGap.toFixed(2);
            if (timing.maxPhaseGap_deg !== undefined && maxGap > timing.maxPhaseGap_deg) {
              failureReasons.push(`Follower peaks were up to ${maxGap.toFixed(1)}° apart, limit ${timing.maxPhaseGap_deg}°`);
            }
          }
          for (const [index, id] of timing.followers.entries()) {
            const readings = cycles.map(({ flags }) => flags[index]);
            const stroke = Math.min(...readings.map(({ stroke_m }) => stroke_m));
            const dwell = Math.min(...readings.map(({ lowDwell_s }) => lowDwell_s));
            metrics[`${id}.cycleStroke_m`] = +stroke.toFixed(4);
            metrics[`${id}.lowDwell_s`] = +dwell.toFixed(3);
            if (stroke < timing.minStroke_m) failureReasons.push(`${id} travelled ${stroke.toFixed(3)} m in its shortest stroke, target ${timing.minStroke_m} m`);
            if (timing.minLowDwell_s !== undefined && dwell < timing.minLowDwell_s) failureReasons.push(`${id} stayed low ${dwell.toFixed(2)} s in its shortest dwell, target ${timing.minLowDwell_s} s`);
          }
        }
      }
      if (uprightTilt.size) {
        metrics.maxInstanceTilt_deg = +Math.max(...uprightTilt.values()).toFixed(2);
        for (const [id, tilt] of uprightTilt) {
          metrics[`${id}.maxTilt_deg`] = +tilt.toFixed(2);
          if (c.maxInstanceTilt_deg !== undefined && tilt > c.maxInstanceTilt_deg) failureReasons.push(`${id} tilted ${tilt.toFixed(2)}°, limit ${c.maxInstanceTilt_deg}°`);
        }
      }
      if (liftPayload) {
        const lift = maxPayloadHeight - payloadStartHeight;
        const returnError = Math.abs(payloadHeight - payloadStartHeight);
        metrics.payloadLift_m = +lift.toFixed(4);
        metrics.payloadMaxHeight_m = +maxPayloadHeight.toFixed(4);
        metrics.payloadReturnError_m = +returnError.toFixed(4);
        if (liftPayload.holder) metrics.payloadSeparation_m = +maxPayloadSeparation.toFixed(4);
        if (c.minPayloadLift_m !== undefined && lift < c.minPayloadLift_m) failureReasons.push(`Payload lifted ${lift.toFixed(3)} m, target ${c.minPayloadLift_m} m`);
        if (c.maxPayloadSeparation_m !== undefined && maxPayloadSeparation > c.maxPayloadSeparation_m) failureReasons.push(`Payload reached ${maxPayloadSeparation.toFixed(3)} m from the holder, limit ${c.maxPayloadSeparation_m} m`);
        if (c.maxPayloadReturnError_m !== undefined && returnError > c.maxPayloadReturnError_m) failureReasons.push(`Payload ended ${returnError.toFixed(3)} m from its starting height, limit ${c.maxPayloadReturnError_m} m`);
      }
      if (clearanceHit) { metrics.clearanceViolation = 1; failureReasons.push(`Clearance violated: ${clearanceHit}`); } else metrics.clearanceViolation = 0;
      if (groundHit) { metrics.groundContactViolation = 1; failureReasons.push(`${groundHit} touched the ground`); } else metrics.groundContactViolation = 0;
      if (c.torqueWithinRating && torqueFail.length) { failureReasons.push(`Motor demand exceeds rating: ${torqueFail.slice(0, 3).join('; ')}`); if (torqueNotes.length) saturationNote(); } else saturationNote();
      break;
    }
    case 'launch': {
      const ax = test.direction === 'x' ? 0 : test.direction === 'y' ? 1 : 2; const pEnd = projRb!.translation(); const end: Vec3 = [pEnd.x, pEnd.y, pEnd.z];
      const land = landing ?? end; const dist = land[ax] - projStart!.position[ax];
      metrics.released = released ? 1 : 0; metrics.landingDistance_m = +dist.toFixed(4); metrics.maxHeight_m = +(maxProjHeight - projStart!.position[1]).toFixed(4); metrics.targetError_m = +Math.abs(dist - test.targetDistance_m).toFixed(4); metrics.landed = landing ? 1 : 0;
      if (!released) failureReasons.push('Projectile never left the launcher');
      else if (!landing) failureReasons.push('Projectile had not landed when the test ended');
      else if (Math.abs(dist - test.targetDistance_m) > test.tolerance_m) failureReasons.push(`Landed at ${dist.toFixed(3)} m; target ${test.targetDistance_m} ± ${test.tolerance_m} m`);
      saturationNote();
      break;
    }
    case 'grip': {
      const pe = payRb!.translation(), he = rootT(bodyOf.get(test.holder)!); const sep = len(sub([pe.x, pe.y, pe.z], he.position)) - len(sub(payStart!.position, holderStart!.position));
      metrics.payloadSeparation_m = +Math.abs(sep).toFixed(4); metrics.payloadHeight_m = +pe.y.toFixed(4); metrics.payloadDrop_m = +(payStart!.position[1] - pe.y).toFixed(4);
      const js = jointStats([...ctlJoints.keys()]); for (const s of js) reportJoint(s, s.joint.motor!.controlId);
      metrics.payloadGrounded = payloadGrounded ? 1 : 0;
      if (payloadGrounded) {
        const drop = (payStart!.position[1] - pe.y).toFixed(3);
        failureReasons.push(Math.abs(sep) < 0.03
          ? `Payload is on the ground after the support was removed at ${test.supportUntil_s} s: it slid ${drop} m down while still between the fingers (separation ${Math.abs(sep).toFixed(3)} m), so the grip did not carry its weight. Close the fingers to a tighter angle than the payload width, raise finger stiffness or servo torque, or raise the holder so the payload hangs clear of the floor; do not re-run the same drives.`
          : `Payload fell to the ground after the support was removed at ${test.supportUntil_s} s (dropped ${drop} m)`);
      }
      else if (Math.abs(sep) > test.maxSeparation_m || payStart!.position[1] - pe.y > test.maxSeparation_m) failureReasons.push(`Payload slipped: separation ${Math.abs(sep).toFixed(3)} m, dropped ${(payStart!.position[1] - pe.y).toFixed(3)} m (limit ${test.maxSeparation_m} m)`);
      saturationNote();
      break;
    }
  }
  if (automaticNoGround.size) {
    metrics.automaticGroundContactChecks = automaticNoGround.size;
    metrics.automaticGroundContactViolation = automaticGroundHits.size ? 1 : 0;
    for (const [id, time] of [...automaticGroundHits].slice(0, 3)) {
      failureReasons.push(`Automatic ground check: ${id} touched the ground at ${time.toFixed(2)} s`);
    }
    if (automaticGroundHits.size > 3) {
      failureReasons.push(`Automatic ground check: ${automaticGroundHits.size - 3} more parts touched the ground`);
    }
  }
  world.free();
  return { testId: test.id, kind: test.kind, passed: failureReasons.length === 0, metrics, failureReasons, notes, engine: ENGINE, trace: { dt: 1 / TRACE_HZ, frames } };
}

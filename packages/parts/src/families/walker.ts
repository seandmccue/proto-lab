import type { Assembly, Instance, Joint, PartDefinition, GaitController, DanceController, Vec3 } from '@protolab/schema';
import { generatePart } from '../generators.ts';
import { getPart } from '../catalog.ts';
import { add, quatFromAxisAngle, QUAT_ID, scale, transformPoint, v } from '../math.ts';

/**
 * Bounded legged-walker family. The model/planner chooses these parameters; the builder places
 * real catalog parts and connects them with validated joints. Legs swing in the X–Y (sagittal)
 * plane about Z axes; walking direction is +X.
 */
export interface WalkerParams {
  legCount: 4 | 6;
  chassisPartId: string;       // body_frame catalog id (or custom part id)
  hipServoPartId: string;      // servo_motor
  kneeServoPartId: string;     // servo_motor
  upperLegPartId: string;      // leg_segment
  lowerLegPartId: string;      // leg_segment
  footPartId: string;          // foot_pad
  hipOffset_rad: number;       // rest hip angle (positive = forward)
  kneeFlex_rad: number;        // rest knee flexion (positive = foot pulled back)
  gait: {
    frequency_hz: number;
    hipAmplitude_rad: number;
    kneeAmplitude_rad: number;
    stiffness: number;
    damping: number;
  };
  shell: boolean;              // add cosmetic shell + eyes
}

export const WALKER_PARAM_RANGES = {
  hipOffset_rad: { min: -0.6, max: 0.6, default: 0.0, unit: 'rad', description: 'Rest hip angle; positive swings leg forward' },
  kneeFlex_rad: { min: 0.0, max: 1.4, default: 0.5, unit: 'rad', description: 'Rest knee flexion; 0 = straight leg' },
  'gait.frequency_hz': { min: 0.3, max: 4, default: 1.5, unit: 'Hz', description: 'Stride frequency' },
  'gait.hipAmplitude_rad': { min: 0.05, max: 0.9, default: 0.35, unit: 'rad', description: 'Hip swing amplitude' },
  'gait.kneeAmplitude_rad': { min: 0.0, max: 1.0, default: 0.4, unit: 'rad', description: 'Knee lift during swing' },
  'gait.stiffness': { min: 1, max: 200, default: 30, unit: 'N·m/rad', description: 'Position-servo stiffness' },
  'gait.damping': { min: 0, max: 20, default: 1.5, unit: 'N·m·s/rad', description: 'Position-servo damping' },
} as const;

export const DEFAULT_WALKER: WalkerParams = {
  legCount: 4,
  chassisPartId: 'chassis-quad-160',
  hipServoPartId: 'servo-mg90s',
  kneeServoPartId: 'servo-mg90s',
  upperLegPartId: 'leg-bar-60',
  lowerLegPartId: 'leg-bar-60',
  footPartId: 'foot-pad-12',
  hipOffset_rad: 0,
  kneeFlex_rad: 0.5,
  gait: { frequency_hz: 1.5, hipAmplitude_rad: 0.35, kneeAmplitude_rad: 0.4, stiffness: 30, damping: 1.5 },
  shell: true,
};

export type PartResolver = (id: string) => PartDefinition | undefined;

function resolve(id: string, extra: PartResolver | undefined, kindWanted: string): PartDefinition {
  const p = extra?.(id) ?? getPart(id);
  if (!p) throw new Error(`Unknown part id "${id}"`);
  if (p.kind !== kindWanted) throw new Error(`Part "${id}" is a ${p.kind}, expected ${kindWanted}`);
  return p;
}

export function buildWalker(params: WalkerParams, extraParts?: PartResolver): Assembly {
  const chassis = resolve(params.chassisPartId, extraParts, 'body_frame');
  const hipServo = resolve(params.hipServoPartId, extraParts, 'servo_motor');
  const kneeServo = resolve(params.kneeServoPartId, extraParts, 'servo_motor');
  const upper = resolve(params.upperLegPartId, extraParts, 'leg_segment');
  const lower = resolve(params.lowerLegPartId, extraParts, 'leg_segment');
  const foot = resolve(params.footPartId, extraParts, 'foot_pad');
  const pairs = params.legCount / 2;
  if (Math.round(chassis.params.legPairs) !== pairs) throw new Error(`Chassis "${chassis.id}" has ${chassis.params.legPairs} leg pairs but legCount=${params.legCount}`);

  const parts = new Map<string, PartDefinition>();
  const use = (p: PartDefinition) => { parts.set(p.id, p); return p; };
  [chassis, hipServo, kneeServo, upper, lower, foot].forEach(use);

  const instances: Instance[] = [];
  const joints: Joint[] = [];
  const phases: Record<string, number> = {};

  const L1 = upper.params.length, L2 = lower.params.length;
  const th = params.hipOffset_rad, flex = params.kneeFlex_rad;
  const servoD = hipServo.dimensions_m[2];          // depth along Z
  const kneeD = kneeServo.dimensions_m[2];
  const hornOut = (s: PartDefinition) => s.connectors.find((c) => c.id === 'horn')!.position[2];

  // Leg kinematics in the sagittal plane (rotation about Z). Upper leg hangs from the hip horn.
  const upperDir: Vec3 = [Math.sin(th), -Math.cos(th), 0];
  const lowerAng = th - flex;
  const lowerDir: Vec3 = [Math.sin(lowerAng), -Math.cos(lowerAng), 0];
  const body: Instance = { id: 'body', partId: chassis.id, label: 'Chassis', transform: { position: [0, 0, 0], rotation: QUAT_ID }, group: 'body' };
  instances.push(body);

  const sides: Array<['L' | 'R', number]> = [['L', 1], ['R', -1]];
  for (let i = 0; i < pairs; i++) {
    for (const [side, sgn] of sides) {
      const legId = `${side}${i}`;
      const hipConn = chassis.connectors.find((c) => c.id === `hip_${legId}`)!;
      const hipPoint = transformPoint(body.transform, hipConn.position);
      // Hip servo: case mounted to chassis side, horn pointing outward (local +Z → world sgn*Z)
      const servoRot = sgn === 1 ? QUAT_ID : quatFromAxisAngle([0, 1, 0], Math.PI);
      const servoPos = add(hipPoint, v(0, 0, sgn * servoD / 2));
      const hipServoInst: Instance = { id: `hip_servo_${legId}`, partId: hipServo.id, label: `Hip servo ${legId}`, transform: { position: servoPos, rotation: servoRot }, group: `leg_${legId}` };
      instances.push(hipServoInst);
      joints.push({ id: `fix_hip_servo_${legId}`, type: 'fixed', a: { instanceId: 'body', connectorId: hipConn.id }, b: { instanceId: hipServoInst.id, connectorId: 'mount' } });

      // Upper leg pivot at horn tip, rotated by hip angle about world Z
      const hornWorld = transformPoint(hipServoInst.transform, hipServo.connectors.find((c) => c.id === 'horn')!.position);
      const pivot = add(hornWorld, v(0, 0, sgn * upper.params.thickness / 2));
      const upperRot = quatFromAxisAngle([0, 0, 1], th);
      const upperInst: Instance = { id: `upper_leg_${legId}`, partId: upper.id, label: `Upper leg ${legId}`, transform: { position: pivot, rotation: upperRot }, group: `leg_${legId}` };
      instances.push(upperInst);
      const hipCtl = `hip_${legId}`;
      joints.push({
        id: `hip_${legId}`, type: 'revolute', a: { instanceId: hipServoInst.id, connectorId: 'horn' }, b: { instanceId: upperInst.id, connectorId: 'pivot' },
        axis: [0, 0, 1], limits_rad: [-1.2, 1.2],
        motor: { controlId: hipCtl, maxTorque_Nm: hipServo.limits.maxTorque_Nm ?? 1, stiffness: params.gait.stiffness, damping: params.gait.damping },
      });

      // Knee servo fixed to the upper leg tip, horn facing outward
      const knee = add(pivot, scale(upperDir, L1));
      const kneeServoPos = add(knee, v(0, 0, sgn * (upper.params.thickness / 2 + kneeD / 2)));
      const kneeServoInst: Instance = { id: `knee_servo_${legId}`, partId: kneeServo.id, label: `Knee servo ${legId}`, transform: { position: kneeServoPos, rotation: servoRot }, group: `leg_${legId}` };
      instances.push(kneeServoInst);
      joints.push({ id: `fix_knee_servo_${legId}`, type: 'fixed', a: { instanceId: upperInst.id, connectorId: 'tip' }, b: { instanceId: kneeServoInst.id, connectorId: 'mount' } });

      // Lower leg pivot at the knee horn, rotated by (hip − flex). Axis −Z so positive = flexion.
      const kneeHorn = add(kneeServoPos, v(0, 0, sgn * (hornOut(kneeServo) + lower.params.thickness / 2)));
      const lowerRot = quatFromAxisAngle([0, 0, 1], lowerAng);
      const lowerInst: Instance = { id: `lower_leg_${legId}`, partId: lower.id, label: `Lower leg ${legId}`, transform: { position: kneeHorn, rotation: lowerRot }, group: `leg_${legId}` };
      instances.push(lowerInst);
      const kneeCtl = `knee_${legId}`;
      joints.push({
        id: `knee_${legId}`, type: 'revolute', a: { instanceId: kneeServoInst.id, connectorId: 'horn' }, b: { instanceId: lowerInst.id, connectorId: 'pivot' },
        axis: [0, 0, -1], limits_rad: [-0.2, 2.2],
        motor: { controlId: kneeCtl, maxTorque_Nm: kneeServo.limits.maxTorque_Nm ?? 1, stiffness: params.gait.stiffness, damping: params.gait.damping },
      });

      // Foot pad under the lower leg tip
      const tip = add(kneeHorn, scale(lowerDir, L2));
      const footInst: Instance = { id: `foot_${legId}`, partId: foot.id, label: `Foot ${legId}`, transform: { position: add(tip, v(0, -foot.params.radius, 0)), rotation: QUAT_ID }, group: `leg_${legId}` };
      instances.push(footInst);
      joints.push({ id: `fix_foot_${legId}`, type: 'fixed', a: { instanceId: lowerInst.id, connectorId: 'tip' }, b: { instanceId: footInst.id, connectorId: 'mount' } });

      // Gait phase: trot (quadruped) or tripod (hexapod). Diagonal pairs move together.
      const phase = ((i + (side === 'L' ? 0 : 1)) % 2) * Math.PI;
      phases[hipCtl] = phase;
      phases[kneeCtl] = phase;
    }
  }

  // Shift everything so the lowest foot point sits exactly on the ground (y = 0).
  const lowestFoot = Math.min(...instances.filter((x) => x.partId === foot.id).map((x) => x.transform.position[1] - foot.params.radius));
  for (const inst of instances) inst.transform.position[1] -= lowestFoot;

  if (params.shell) {
    const shell = use(generatePart('shell_panel', { length: chassis.params.length * 1.06, width: chassis.params.width * 1.12, thickness: 0.002 }, `shell:${chassis.id}`));
    const eye = use(getPart('eye-dome-18')!);
    const topY = body.transform.position[1] + chassis.params.height / 2;
    instances.push({ id: 'shell_top', partId: shell.id, label: 'Shell panel', transform: { position: [0, topY + 0.001, 0], rotation: QUAT_ID }, group: 'body' });
    joints.push({ id: 'fix_shell', type: 'fixed', a: { instanceId: 'body', connectorId: 'top' }, b: { instanceId: 'shell_top', connectorId: 'mount' } });
    const fx = chassis.params.length / 2 + eye.params.radius * 0.6;
    for (const [n, z] of [['eye_l', chassis.params.width * 0.25], ['eye_r', -chassis.params.width * 0.25]] as const) {
      instances.push({ id: n, partId: eye.id, label: n === 'eye_l' ? 'Eye (left)' : 'Eye (right)', transform: { position: [fx, body.transform.position[1] + chassis.params.height * 0.15, z], rotation: QUAT_ID }, group: 'body' });
      joints.push({ id: `fix_${n}`, type: 'fixed', a: { instanceId: 'body', connectorId: 'front' }, b: { instanceId: n, connectorId: 'mount' } });
    }
  }

  const controller: GaitController = {
    kind: 'gait',
    frequency_hz: params.gait.frequency_hz,
    hipAmplitude_rad: params.gait.hipAmplitude_rad,
    kneeAmplitude_rad: params.gait.kneeAmplitude_rad,
    hipOffset_rad: th,
    kneeOffset_rad: flex,
    kneeLag_rad: Math.PI / 2,
    phases,
  };

  return {
    family: 'legged_walker',
    familyParams: flattenWalkerParams(params),
    parts: [...parts.values()],
    instances,
    joints,
    controller,
  };
}

export function danceController(base: GaitController, opts: { frequency_hz?: number; bobAmplitude_rad?: number; swayAmplitude_rad?: number } = {}): DanceController {
  const phases: Record<string, number> = {};
  for (const k of Object.keys(base.phases)) phases[k] = base.phases[k];
  return { kind: 'dance', frequency_hz: opts.frequency_hz ?? 2, bobAmplitude_rad: opts.bobAmplitude_rad ?? 0.35, swayAmplitude_rad: opts.swayAmplitude_rad ?? 0.25, phases };
}

export function flattenWalkerParams(p: WalkerParams): Record<string, number> {
  return {
    legCount: p.legCount,
    hipOffset_rad: p.hipOffset_rad,
    kneeFlex_rad: p.kneeFlex_rad,
    'gait.frequency_hz': p.gait.frequency_hz,
    'gait.hipAmplitude_rad': p.gait.hipAmplitude_rad,
    'gait.kneeAmplitude_rad': p.gait.kneeAmplitude_rad,
    'gait.stiffness': p.gait.stiffness,
    'gait.damping': p.gait.damping,
    shell: p.shell ? 1 : 0,
  };
}

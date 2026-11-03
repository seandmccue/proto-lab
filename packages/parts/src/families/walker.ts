import type { Assembly, Drive } from '@protolab/schema';
import { getPart } from '../catalog.ts';
import { applyOps, emptyAssembly, setDrives, type AssemblyOp, type PartResolver } from '../assembly.ts';

/**
 * Legged walker expressed purely as generic assembly operations. This is the regression anchor for
 * the ops engine (the original walking demo) and the seed for the deterministic planner. The model
 * is never required to use it; it builds walkers (and everything else) from the same operations.
 */
export interface WalkerParams {
  legCount: 4 | 6;
  chassisPartId: string; hipServoPartId: string; kneeServoPartId: string; upperLegPartId: string; lowerLegPartId: string; footPartId: string;
  hipOffset_rad: number; kneeFlex_rad: number;
  gait: { frequency_hz: number; hipAmplitude_rad: number; kneeAmplitude_rad: number; stiffness: number; damping: number; gaitType: 'crawl' | 'trot' | 'tripod'; swingDuty: number };
  shell: boolean;
  dance?: { frequency_hz: number; bobAmplitude_rad: number; swayAmplitude_rad: number };
}
export const DEFAULT_DANCE = { frequency_hz: 1.6, bobAmplitude_rad: 0.3, swayAmplitude_rad: 0.1 };
export const DEFAULT_WALKER: WalkerParams = {
  legCount: 4, chassisPartId: 'chassis-quad-160', hipServoPartId: 'servo-mg90s', kneeServoPartId: 'servo-mg90s', upperLegPartId: 'leg-bar-60', lowerLegPartId: 'leg-bar-60', footPartId: 'foot-pad-12',
  hipOffset_rad: 0, kneeFlex_rad: 0.5, gait: { frequency_hz: 1.0, hipAmplitude_rad: 0.3, kneeAmplitude_rad: 0.5, stiffness: 3, damping: 0.1, gaitType: 'crawl', swingDuty: 0.22 }, shell: true,
};
export const WALKER_PARAM_RANGES = {
  hipOffset_rad: { min: -0.6, max: 0.6, default: 0.0, unit: 'rad', description: 'Rest hip angle; positive swings leg forward' },
  kneeFlex_rad: { min: 0.0, max: 1.4, default: 0.5, unit: 'rad', description: 'Rest knee flexion; 0 = straight leg' },
  'gait.frequency_hz': { min: 0.3, max: 4, default: 1.0, unit: 'Hz', description: 'Stride frequency' },
  'gait.hipAmplitude_rad': { min: 0.05, max: 0.9, default: 0.3, unit: 'rad', description: 'Hip swing amplitude' },
  'gait.kneeAmplitude_rad': { min: 0.0, max: 1.0, default: 0.5, unit: 'rad', description: 'Knee lift during swing' },
  'gait.stiffness': { min: 0.2, max: 50, default: 3, unit: 'N·m/rad', description: 'Position-servo stiffness' },
  'gait.damping': { min: 0, max: 5, default: 0.1, unit: 'N·m·s/rad', description: 'Position-servo damping' },
  'gait.swingDuty': { min: 0.1, max: 0.5, default: 0.22, unit: '', description: 'Fraction of the stride a leg is in the air' },
} as const;

export function legPhase(gait: 'crawl' | 'trot' | 'tripod', pairs: number, pairIndex: number, side: 'L' | 'R'): number {
  if (gait === 'crawl') { const legs = pairs * 2; const order = side === 'L' ? pairIndex : pairs + pairIndex; return (order / legs) * 2 * Math.PI; }
  return ((pairIndex + (side === 'L' ? 0 : 1)) % 2) * Math.PI;
}

/** The ops that build a walker. Legs swing about Z (sagittal plane); walking direction is +X. */
export function walkerOps(p: WalkerParams, resolve: PartResolver = getPart): { ops: AssemblyOp[]; drives: Drive[] } {
  const chassis = resolve(p.chassisPartId); if (!chassis) throw new Error(`Unknown chassis ${p.chassisPartId}`);
  const upper = resolve(p.upperLegPartId)!, lower = resolve(p.lowerLegPartId)!, foot = resolve(p.footPartId)!;
  const pairs = p.legCount / 2;
  if (Math.round(chassis.params.legPairs) !== pairs) throw new Error(`Chassis "${chassis.id}" has ${chassis.params.legPairs} leg pairs but legCount=${p.legCount}`);
  const L1 = upper.params.length, L2 = lower.params.length, th = p.hipOffset_rad, flex = p.kneeFlex_rad;
  const dropY = L1 * Math.cos(th) + L2 * Math.cos(th - flex);           // hip to foot centre
  const bodyY = dropY + foot.params.radius * 2;                           // foot sphere bottom on the ground
  const ops: AssemblyOp[] = [{ op: 'place', id: 'body', part: chassis.id, label: 'Chassis', group: 'body', position: [0, bodyY, 0] }];
  const drives: Drive[] = [];
  const hipDeg = (th * 180) / Math.PI, kneeDeg = (-flex * 180) / Math.PI;
  for (let i = 0; i < pairs; i++) for (const side of ['L', 'R'] as const) {
    const leg = `${side}${i}`, g = `leg_${leg}`, sgn = side === 'L' ? 1 : -1;
    // hip servo on the chassis side; horn points outward (±Z). Upper leg pivots on the horn; its "pivot" connector axis is −Z
    // so the mated leg hangs with +X forward on both sides. Spin sets the rest hip angle (about the horn axis, outward).
    ops.push({ op: 'mount', id: `hip_servo_${leg}`, part: p.hipServoPartId, label: `Hip servo ${leg}`, group: g, onto: 'body', connector: `hip_${leg}`, via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 });
    ops.push({ op: 'mount', id: `upper_leg_${leg}`, part: p.upperLegPartId, label: `Upper leg ${leg}`, group: g, onto: `hip_servo_${leg}`, connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: sgn * hipDeg, offset_m: 0, limits: [-1.2, 1.2], motor: { controlId: `hip_${leg}`, stiffness: p.gait.stiffness, damping: p.gait.damping } });
    ops.push({ op: 'mount', id: `knee_servo_${leg}`, part: p.kneeServoPartId, label: `Knee servo ${leg}`, group: g, onto: `upper_leg_${leg}`, connector: 'tip_side', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 });
    ops.push({ op: 'mount', id: `lower_leg_${leg}`, part: p.lowerLegPartId, label: `Lower leg ${leg}`, group: g, onto: `knee_servo_${leg}`, connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: sgn * (hipDeg + kneeDeg), offset_m: 0, limits: [-2.2, 2.2], motor: { controlId: `knee_${leg}`, stiffness: p.gait.stiffness, damping: p.gait.damping } });
    ops.push({ op: 'mount', id: `foot_${leg}`, part: p.footPartId, label: `Foot ${leg}`, group: g, onto: `lower_leg_${leg}`, connector: 'tip', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 });
    const phase = legPhase(p.gait.gaitType, pairs, i, side);
    // Joint angles are measured from the assembled rest pose (0 = as mounted). The revolute axis is the parent's connector axis
    // (outward ±Z): positive on the left (+Z) swings the leg forward; on the right (−Z) the sign flips, so mirror the amplitude.
    drives.push({ controlId: `hip_${leg}`, mode: 'position', rampIn_s: 0.6, profile: { kind: 'gait', role: 'swing', amplitude: sgn * p.gait.hipAmplitude_rad, offset: 0, frequency_hz: p.gait.frequency_hz, phase, swingDuty: p.gait.swingDuty } });
    drives.push({ controlId: `knee_${leg}`, mode: 'position', rampIn_s: 0.6, profile: { kind: 'gait', role: 'lift', amplitude: -sgn * p.gait.kneeAmplitude_rad, offset: 0, frequency_hz: p.gait.frequency_hz, phase, swingDuty: p.gait.swingDuty } });
  }
  if (p.shell) {
    ops.push({ op: 'mount', id: 'shell_top', part: 'shell-panel-170x90', label: 'Shell panel', group: 'body', onto: 'body', connector: 'top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0.001 });
    ops.push({ op: 'mount', id: 'eye_l', part: 'eye-dome-18', label: 'Eye (left)', group: 'body', onto: 'body', connector: 'front_top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 });
    ops.push({ op: 'move', id: 'eye_l', translate: [0, 0, chassis.params.width * 0.25] });
    ops.push({ op: 'mount', id: 'eye_r', part: 'eye-dome-18', label: 'Eye (right)', group: 'body', onto: 'body', connector: 'front_top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 });
    ops.push({ op: 'move', id: 'eye_r', translate: [0, 0, -chassis.params.width * 0.25] });
  }
  return { ops, drives };
}

export function flattenWalkerParams(p: WalkerParams): Record<string, number> {
  const d = p.dance ?? DEFAULT_DANCE;
  return { legCount: p.legCount, hipOffset_rad: p.hipOffset_rad, kneeFlex_rad: p.kneeFlex_rad, 'gait.frequency_hz': p.gait.frequency_hz, 'gait.hipAmplitude_rad': p.gait.hipAmplitude_rad, 'gait.kneeAmplitude_rad': p.gait.kneeAmplitude_rad, 'gait.stiffness': p.gait.stiffness, 'gait.damping': p.gait.damping, 'gait.swingDuty': p.gait.swingDuty, 'gait.gaitType': p.gait.gaitType === 'crawl' ? 0 : p.gait.gaitType === 'trot' ? 1 : 2, 'dance.frequency_hz': d.frequency_hz, 'dance.bobAmplitude_rad': d.bobAmplitude_rad, 'dance.swayAmplitude_rad': d.swayAmplitude_rad, shell: p.shell ? 1 : 0 };
}

export function buildWalker(p: WalkerParams, resolve: PartResolver = getPart): Assembly {
  const { ops, drives } = walkerOps(p, resolve);
  let a = applyOps(emptyAssembly(), ops, resolve).assembly;
  a = setDrives(a, drives);
  // Lift so the lowest foot touches the ground exactly (mates may differ slightly from the analytic drop).
  const foot = resolve(p.footPartId)!;
  const lowest = Math.min(...a.instances.filter((x) => x.partId === foot.id).map((x) => x.transform.position[1] - foot.params.radius));
  for (const inst of a.instances) inst.transform.position[1] -= lowest;
  for (const j of a.joints) if (j.anchor) j.anchor = [j.anchor[0], j.anchor[1] - lowest, j.anchor[2]];
  a.family = 'legged_walker'; a.familyParams = flattenWalkerParams(p); a.familyConfig = { ...p };
  return a;
}

/** Dance drives: knees bob together with hip compensation; small alternating hip sway. */
export function danceDrives(p: WalkerParams): Drive[] {
  const d = { ...DEFAULT_DANCE, ...(p.dance ?? {}) };
  const pairs = p.legCount / 2; const drives: Drive[] = [];
  for (let i = 0; i < pairs; i++) for (const side of ['L', 'R'] as const) {
    const leg = `${side}${i}`, sgn = side === 'L' ? 1 : -1; const phase = legPhase(p.gait.gaitType, pairs, i, side);
    // knee: offset + bob·(0.5+0.5·sin(2wt)); hip: offset + 0.5·bob·(…) + sway·sin(wt+phase). Expressed as two sines each.
    drives.push({ controlId: `knee_${leg}`, mode: 'position', rampIn_s: 0.4, profile: { kind: 'sine', amplitude: -sgn * d.bobAmplitude_rad * 0.5, offset: -sgn * d.bobAmplitude_rad * 0.5, frequency_hz: 2 * d.frequency_hz, phase: 0 } });
    drives.push({ controlId: `hip_${leg}`, mode: 'position', rampIn_s: 0.4, profile: { kind: 'sine', amplitude: sgn * d.swayAmplitude_rad, offset: sgn * 0.25 * d.bobAmplitude_rad, frequency_hz: d.frequency_hz, phase } });
  }
  return drives;
}

import type { PartDefinition, PartCategory } from '@protolab/schema';
import { generatePart } from './generators.ts';

interface Preset { id: string; kind: string; params: Record<string, number> }

/** Curated catalog: ~40 functional primitives with real parameters. IDs are stable. */
const PRESETS: Preset[] = [
  // motors
  { id: 'servo-micro-sg90', kind: 'servo_motor', params: { size: 0.023, torque: 0.18, speed: 10 } },
  { id: 'servo-mg90s', kind: 'servo_motor', params: { size: 0.023, torque: 0.22, speed: 10 } },
  { id: 'servo-mg996r', kind: 'servo_motor', params: { size: 0.04, torque: 1.1, speed: 7 } },
  { id: 'servo-ds3218', kind: 'servo_motor', params: { size: 0.04, torque: 2.0, speed: 6.5 } },
  { id: 'servo-high-torque-35', kind: 'servo_motor', params: { size: 0.045, torque: 3.5, speed: 5 } },
  // frames
  { id: 'chassis-quad-120', kind: 'body_frame', params: { length: 0.12, width: 0.06, height: 0.04, legPairs: 2 } },
  { id: 'chassis-quad-160', kind: 'body_frame', params: { length: 0.16, width: 0.08, height: 0.05, legPairs: 2 } },
  { id: 'chassis-quad-220', kind: 'body_frame', params: { length: 0.22, width: 0.1, height: 0.06, legPairs: 2 } },
  { id: 'chassis-hex-200', kind: 'body_frame', params: { length: 0.2, width: 0.08, height: 0.05, legPairs: 3 } },
  { id: 'beam-50', kind: 'beam', params: { length: 0.05, width: 0.01, height: 0.01 } },
  { id: 'beam-100', kind: 'beam', params: { length: 0.1, width: 0.01, height: 0.01 } },
  { id: 'beam-200', kind: 'beam', params: { length: 0.2, width: 0.012, height: 0.012 } },
  { id: 'plate-80x50', kind: 'plate', params: { length: 0.08, width: 0.05, thickness: 0.004 } },
  { id: 'plate-120x80', kind: 'plate', params: { length: 0.12, width: 0.08, thickness: 0.004 } },
  { id: 'leg-bar-40', kind: 'leg_segment', params: { length: 0.04, width: 0.012, thickness: 0.004 } },
  { id: 'leg-bar-60', kind: 'leg_segment', params: { length: 0.06, width: 0.012, thickness: 0.004 } },
  { id: 'leg-bar-80', kind: 'leg_segment', params: { length: 0.08, width: 0.014, thickness: 0.004 } },
  { id: 'leg-bar-100', kind: 'leg_segment', params: { length: 0.1, width: 0.015, thickness: 0.005 } },
  // pads / contact
  { id: 'foot-pad-8', kind: 'foot_pad', params: { radius: 0.008 } },
  { id: 'foot-pad-12', kind: 'foot_pad', params: { radius: 0.012 } },
  { id: 'foot-pad-16', kind: 'foot_pad', params: { radius: 0.016 } },
  // brackets / fasteners
  { id: 'bracket-20', kind: 'bracket', params: { size: 0.02, thickness: 0.002 } },
  { id: 'bracket-30', kind: 'bracket', params: { size: 0.03, thickness: 0.002 } },
  { id: 'screw-m3x8', kind: 'screw', params: { length: 0.008, radius: 0.0015 } },
  { id: 'screw-m3x12', kind: 'screw', params: { length: 0.012, radius: 0.0015 } },
  { id: 'screw-m4x16', kind: 'screw', params: { length: 0.016, radius: 0.002 } },
  // shafts / bearings / gears
  { id: 'shaft-3x60', kind: 'shaft', params: { length: 0.06, radius: 0.003 } },
  { id: 'shaft-5x100', kind: 'shaft', params: { length: 0.1, radius: 0.005 } },
  { id: 'bearing-608', kind: 'bearing', params: { outerRadius: 0.011, width: 0.007 } },
  { id: 'bearing-623', kind: 'bearing', params: { outerRadius: 0.005, width: 0.004 } },
  { id: 'gear-20t-m1', kind: 'gear', params: { teeth: 20, module: 0.001, thickness: 0.005 } },
  { id: 'gear-40t-m1', kind: 'gear', params: { teeth: 40, module: 0.001, thickness: 0.005 } },
  { id: 'gear-12t-m05', kind: 'gear', params: { teeth: 12, module: 0.0005, thickness: 0.004 } },
  { id: 'pulley-15', kind: 'pulley', params: { radius: 0.015 } },
  // wheels / joints / springs
  { id: 'wheel-60', kind: 'wheel', params: { radius: 0.03, width: 0.012 } },
  { id: 'wheel-100', kind: 'wheel', params: { radius: 0.05, width: 0.02 } },
  { id: 'hinge-30', kind: 'hinge', params: { length: 0.03 } },
  { id: 'spring-500', kind: 'spring', params: { length: 0.04, radius: 0.006, stiffness: 500 } },
  { id: 'spring-2000', kind: 'spring', params: { length: 0.06, radius: 0.008, stiffness: 2000 } },
  // grippers / shells
  { id: 'gripper-finger-50', kind: 'gripper_finger', params: { length: 0.05 } },
  { id: 'shell-panel-170x90', kind: 'shell_panel', params: { length: 0.17, width: 0.09, thickness: 0.002 } },
  { id: 'eye-dome-18', kind: 'eye_module', params: { radius: 0.009 } },
];

let cache: PartDefinition[] | null = null;
export function catalog(): PartDefinition[] {
  if (!cache) cache = PRESETS.map((p) => generatePart(p.kind, p.params, p.id));
  return cache;
}

export function getPart(id: string): PartDefinition | undefined {
  return catalog().find((p) => p.id === id);
}

export function searchCatalog(query: string, opts: { category?: PartCategory; kind?: string; limit?: number } = {}): PartDefinition[] {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const scored = catalog()
    .filter((p) => (!opts.category || p.category === opts.category) && (!opts.kind || p.kind === opts.kind))
    .map((p) => {
      const hay = `${p.id} ${p.name} ${p.kind} ${p.category} ${p.description}`.toLowerCase();
      const score = terms.length === 0 ? 1 : terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  return scored.slice(0, opts.limit ?? 20).map((x) => x.p);
}

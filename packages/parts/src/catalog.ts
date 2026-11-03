import type { PartDefinition, PartCategory } from '@protolab/schema';
import { generatePart } from './generators.ts';

interface Preset { id: string; kind: string; params: Record<string, number> }

/** Curated catalog of functional components with real parameters. IDs are stable. */
const PRESETS: Preset[] = [
  // structural
  { id: 'beam-50', kind: 'beam', params: { length: 0.05, width: 0.01, height: 0.01 } }, { id: 'beam-100', kind: 'beam', params: { length: 0.1, width: 0.01, height: 0.01 } }, { id: 'beam-200', kind: 'beam', params: { length: 0.2, width: 0.012, height: 0.012 } }, { id: 'beam-300', kind: 'beam', params: { length: 0.3, width: 0.015, height: 0.015 } }, { id: 'beam-500', kind: 'beam', params: { length: 0.5, width: 0.02, height: 0.02 } },
  { id: 'rod-100', kind: 'rod', params: { length: 0.1, radius: 0.003 } }, { id: 'rod-200', kind: 'rod', params: { length: 0.2, radius: 0.004 } }, { id: 'rod-400', kind: 'rod', params: { length: 0.4, radius: 0.005 } },
  { id: 'plate-50x50', kind: 'plate', params: { length: 0.05, width: 0.05, thickness: 0.003 } }, { id: 'plate-80x50', kind: 'plate', params: { length: 0.08, width: 0.05, thickness: 0.004 } }, { id: 'plate-120x80', kind: 'plate', params: { length: 0.12, width: 0.08, thickness: 0.004 } }, { id: 'plate-200x150', kind: 'plate', params: { length: 0.2, width: 0.15, thickness: 0.005 } }, { id: 'base-plate-300x200', kind: 'plate', params: { length: 0.3, width: 0.2, thickness: 0.008 } }, { id: 'base-plate-500x300', kind: 'plate', params: { length: 0.5, width: 0.3, thickness: 0.01 } },
  { id: 'chassis-quad-120', kind: 'body_frame', params: { length: 0.12, width: 0.06, height: 0.04, legPairs: 2 } }, { id: 'chassis-quad-160', kind: 'body_frame', params: { length: 0.16, width: 0.08, height: 0.05, legPairs: 2 } }, { id: 'chassis-quad-220', kind: 'body_frame', params: { length: 0.22, width: 0.1, height: 0.06, legPairs: 2 } }, { id: 'chassis-hex-200', kind: 'body_frame', params: { length: 0.2, width: 0.08, height: 0.05, legPairs: 3 } }, { id: 'chassis-octo-240', kind: 'body_frame', params: { length: 0.24, width: 0.1, height: 0.05, legPairs: 4 } },
  { id: 'enclosure-100x60', kind: 'enclosure', params: { length: 0.1, width: 0.06, height: 0.04 } }, { id: 'enclosure-60x40', kind: 'enclosure', params: { length: 0.06, width: 0.04, height: 0.03 } },
  { id: 'curved-panel-r60', kind: 'curved_panel', params: { radius: 0.06, span: 1.5708, width: 0.08, thickness: 0.002 } }, { id: 'curved-panel-r120', kind: 'curved_panel', params: { radius: 0.12, span: 2.0, width: 0.12, thickness: 0.002 } },
  { id: 'bracket-20', kind: 'bracket', params: { size: 0.02, width: 0.02, thickness: 0.002 } }, { id: 'bracket-40', kind: 'bracket', params: { size: 0.04, width: 0.03, thickness: 0.003 } },
  { id: 'tower-150', kind: 'tower', params: { height: 0.15, baseWidth: 0.12, legWidth: 0.01 } }, { id: 'tower-300', kind: 'tower', params: { height: 0.3, baseWidth: 0.2, legWidth: 0.012 } }, { id: 'tower-500', kind: 'tower', params: { height: 0.5, baseWidth: 0.35, legWidth: 0.015 } },
  // rotational
  { id: 'shaft-3x60', kind: 'shaft', params: { length: 0.06, radius: 0.003 } }, { id: 'shaft-5x100', kind: 'shaft', params: { length: 0.1, radius: 0.005 } }, { id: 'shaft-8x200', kind: 'shaft', params: { length: 0.2, radius: 0.004 } }, { id: 'axle-10x300', kind: 'shaft', params: { length: 0.3, radius: 0.005 } },
  { id: 'gear-12t-m1', kind: 'gear', params: { teeth: 12, module: 0.001, thickness: 0.005 } }, { id: 'gear-20t-m1', kind: 'gear', params: { teeth: 20, module: 0.001, thickness: 0.005 } }, { id: 'gear-40t-m1', kind: 'gear', params: { teeth: 40, module: 0.001, thickness: 0.005 } }, { id: 'gear-60t-m1', kind: 'gear', params: { teeth: 60, module: 0.001, thickness: 0.006 } }, { id: 'gear-30t-m2', kind: 'gear', params: { teeth: 30, module: 0.002, thickness: 0.008 } },
  { id: 'bearing-608', kind: 'bearing', params: { outerRadius: 0.011, width: 0.007 } }, { id: 'bearing-623', kind: 'bearing', params: { outerRadius: 0.005, width: 0.004 } }, { id: 'bearing-6004', kind: 'bearing', params: { outerRadius: 0.021, width: 0.012 } },
  { id: 'wheel-40', kind: 'wheel', params: { radius: 0.02, width: 0.01 } }, { id: 'wheel-60', kind: 'wheel', params: { radius: 0.03, width: 0.012 } }, { id: 'wheel-100', kind: 'wheel', params: { radius: 0.05, width: 0.02 } },
  { id: 'spoked-wheel-200', kind: 'big_wheel', params: { radius: 0.1, spokes: 6, spokeWidth: 0.006 } }, { id: 'spoked-wheel-400', kind: 'big_wheel', params: { radius: 0.2, spokes: 8, spokeWidth: 0.008 } }, { id: 'spoked-wheel-600', kind: 'big_wheel', params: { radius: 0.3, spokes: 12, spokeWidth: 0.01 } },
  { id: 'pulley-15', kind: 'pulley', params: { radius: 0.015, width: 0.008 } }, { id: 'pulley-30', kind: 'pulley', params: { radius: 0.03, width: 0.01 } },
  { id: 'flywheel-100', kind: 'flywheel', params: { radius: 0.05, thickness: 0.01 } },
  // motion
  { id: 'hinge-30', kind: 'hinge', params: { length: 0.03, leaf: 0.02 } }, { id: 'hinge-80', kind: 'hinge', params: { length: 0.08, leaf: 0.03 } }, { id: 'hinge-150', kind: 'hinge', params: { length: 0.15, leaf: 0.04 } },
  { id: 'slider-100', kind: 'slider', params: { length: 0.1, width: 0.015 } }, { id: 'slider-250', kind: 'slider', params: { length: 0.25, width: 0.02 } }, { id: 'carriage-20', kind: 'carriage', params: { size: 0.02 } }, { id: 'carriage-30', kind: 'carriage', params: { size: 0.03 } },
  { id: 'link-40', kind: 'link', params: { length: 0.04, width: 0.012, thickness: 0.004 } }, { id: 'link-80', kind: 'link', params: { length: 0.08, width: 0.012, thickness: 0.004 } }, { id: 'link-150', kind: 'link', params: { length: 0.15, width: 0.015, thickness: 0.005 } },
  { id: 'leg-bar-40', kind: 'leg_segment', params: { length: 0.04, width: 0.012, thickness: 0.004 } }, { id: 'leg-bar-60', kind: 'leg_segment', params: { length: 0.06, width: 0.012, thickness: 0.004 } }, { id: 'leg-bar-80', kind: 'leg_segment', params: { length: 0.08, width: 0.014, thickness: 0.004 } }, { id: 'leg-bar-100', kind: 'leg_segment', params: { length: 0.1, width: 0.015, thickness: 0.005 } },
  { id: 'crank-30', kind: 'crank', params: { throw: 0.03, width: 0.012, thickness: 0.005 } }, { id: 'crank-60', kind: 'crank', params: { throw: 0.06, width: 0.015, thickness: 0.006 } },
  { id: 'eccentric-disc-40', kind: 'eccentric_disc', params: { radius: 0.02, throw: 0.01, thickness: 0.006 } },
  { id: 'eccentric-disc-70', kind: 'eccentric_disc', params: { radius: 0.035, throw: 0.02, thickness: 0.008 } },
  { id: 'clevis-12', kind: 'clevis', params: { gap: 0.012, rise: 0.016, wall: 0.003 } },
  { id: 'clevis-20', kind: 'clevis', params: { gap: 0.02, rise: 0.026, wall: 0.004 } },
  { id: 'bell-crank-30x40', kind: 'bell_crank', params: { input: 0.03, output: 0.04, width: 0.01, thickness: 0.004 } },
  { id: 'bell-crank-50x65', kind: 'bell_crank', params: { input: 0.05, output: 0.065, width: 0.014, thickness: 0.006 } },
  { id: 'cylinder-20x50', kind: 'piston', params: { bore: 0.02, stroke: 0.05 } },
  // actuation
  { id: 'servo-micro-sg90', kind: 'servo_motor', params: { size: 0.023, torque: 0.18, speed: 10 } }, { id: 'servo-mg90s', kind: 'servo_motor', params: { size: 0.023, torque: 0.22, speed: 10 } }, { id: 'servo-mg996r', kind: 'servo_motor', params: { size: 0.04, torque: 1.1, speed: 7 } }, { id: 'servo-ds3218', kind: 'servo_motor', params: { size: 0.04, torque: 2.0, speed: 6.5 } }, { id: 'servo-high-torque-35', kind: 'servo_motor', params: { size: 0.045, torque: 3.5, speed: 5 } }, { id: 'servo-giant-8', kind: 'servo_motor', params: { size: 0.065, torque: 8, speed: 4 } },
  { id: 'gearmotor-n20', kind: 'dc_motor', params: { diameter: 0.012, length: 0.03, torque: 0.1, speed: 30 } }, { id: 'gearmotor-25', kind: 'dc_motor', params: { diameter: 0.025, length: 0.06, torque: 0.5, speed: 20 } }, { id: 'gearmotor-37', kind: 'dc_motor', params: { diameter: 0.037, length: 0.08, torque: 2.0, speed: 10 } }, { id: 'gearmotor-50', kind: 'dc_motor', params: { diameter: 0.05, length: 0.1, torque: 6.0, speed: 6 } },
  { id: 'spring-200', kind: 'spring', params: { length: 0.04, radius: 0.006, stiffness: 200 } }, { id: 'spring-500', kind: 'spring', params: { length: 0.04, radius: 0.006, stiffness: 500 } }, { id: 'spring-2000', kind: 'spring', params: { length: 0.06, radius: 0.008, stiffness: 2000 } }, { id: 'spring-8000', kind: 'spring', params: { length: 0.08, radius: 0.012, stiffness: 8000 } },
  { id: 'actuator-50', kind: 'linear_actuator', params: { stroke: 0.05, force: 100 } }, { id: 'actuator-150', kind: 'linear_actuator', params: { stroke: 0.15, force: 300 } },
  // specialised
  { id: 'marker-tip-8', kind: 'marker_tip', params: { diameter: 0.008, length: 0.016 } },
  { id: 'marker-tip-12', kind: 'marker_tip', params: { diameter: 0.012, length: 0.024 } },
  { id: 'wing-butterfly-120', kind: 'wing', params: { span: 0.12, chord: 0.09, thickness: 0.001, style: 0, side: 0 } }, { id: 'wing-butterfly-120-left', kind: 'wing', params: { span: 0.12, chord: 0.09, thickness: 0.001, style: 0, side: 1 } }, { id: 'wing-butterfly-200', kind: 'wing', params: { span: 0.2, chord: 0.15, thickness: 0.0012, style: 0, side: 0 } }, { id: 'wing-butterfly-200-left', kind: 'wing', params: { span: 0.2, chord: 0.15, thickness: 0.0012, style: 0, side: 1 } }, { id: 'wing-dragonfly-150', kind: 'wing', params: { span: 0.15, chord: 0.03, thickness: 0.0008, style: 1, side: 0 } }, { id: 'wing-dragonfly-150-left', kind: 'wing', params: { span: 0.15, chord: 0.03, thickness: 0.0008, style: 1, side: 1 } }, { id: 'wing-bird-250', kind: 'wing', params: { span: 0.25, chord: 0.1, thickness: 0.0015, style: 2, side: 0 } }, { id: 'wing-bird-250-left', kind: 'wing', params: { span: 0.25, chord: 0.1, thickness: 0.0015, style: 2, side: 1 } },
  { id: 'body-butterfly-80', kind: 'insect_body', params: { length: 0.08, radius: 0.008, wingPairs: 1, torque: 0.3 } }, { id: 'body-dragonfly-100', kind: 'insect_body', params: { length: 0.1, radius: 0.006, wingPairs: 2, torque: 0.2 } }, { id: 'body-bird-160', kind: 'insect_body', params: { length: 0.16, radius: 0.02, wingPairs: 1, torque: 0.8 } }, { id: 'sail-blade-300', kind: 'wing', params: { span: 0.3, chord: 0.08, thickness: 0.003, style: 3 } },
  { id: 'propeller-3x200', kind: 'propeller', params: { radius: 0.1, blades: 3, chord: 0.02, pitch: 0.3 } }, { id: 'rotor-4x400', kind: 'propeller', params: { radius: 0.2, blades: 4, chord: 0.04, pitch: 0.25 } }, { id: 'windmill-4x600', kind: 'propeller', params: { radius: 0.3, blades: 4, chord: 0.08, pitch: 0.4 } },
  { id: 'gripper-finger-50', kind: 'gripper_finger', params: { length: 0.05, width: 0.012, thickness: 0.006 } }, { id: 'gripper-finger-90', kind: 'gripper_finger', params: { length: 0.09, width: 0.015, thickness: 0.008 } },
  { id: 'gondola-40', kind: 'gondola', params: { width: 0.04, height: 0.04 } }, { id: 'gondola-70', kind: 'gondola', params: { width: 0.07, height: 0.06 } },
  { id: 'foot-pad-8', kind: 'foot_pad', params: { radius: 0.008 } }, { id: 'foot-pad-12', kind: 'foot_pad', params: { radius: 0.012 } }, { id: 'foot-pad-16', kind: 'foot_pad', params: { radius: 0.016 } },
  { id: 'track-150', kind: 'track_module', params: { length: 0.15, height: 0.04, width: 0.03 } },
  { id: 'shell-panel-170x90', kind: 'shell_panel', params: { length: 0.17, width: 0.09, thickness: 0.002 } }, { id: 'eye-dome-18', kind: 'eye_module', params: { radius: 0.009 } },
  { id: 'screw-m3x8', kind: 'screw', params: { length: 0.008, radius: 0.0015 } }, { id: 'screw-m4x16', kind: 'screw', params: { length: 0.016, radius: 0.002 } },
  { id: 'foam-ball-60', kind: 'ball', params: { radius: 0.03, density: 40 } }, { id: 'wood-ball-40', kind: 'ball', params: { radius: 0.02, density: 600 } }, { id: 'block-40', kind: 'block', params: { length: 0.04, width: 0.04, height: 0.04, density: 600 } }, { id: 'foam-pizza-80', kind: 'disc', params: { radius: 0.04, thickness: 0.008, density: 60 } },
  { id: 'tray-45', kind: 'tray', params: { radius: 0.045, depth: 0.012 } }, { id: 'counterweight-500g', kind: 'counterweight', params: { mass: 0.5 } }, { id: 'counterweight-2kg', kind: 'counterweight', params: { mass: 2 } },
];

let cache: PartDefinition[] | null = null;
export function catalog(): PartDefinition[] {
  if (!cache) cache = PRESETS.map((p) => generatePart(p.kind, p.params, p.id));
  return cache;
}
export function getPart(id: string): PartDefinition | undefined { return catalog().find((p) => p.id === id); }

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

import { PartDefinition, type GeometryPiece, type Connector, type Vec3 } from '@protolab/schema';
import { QUAT_ID, quatFromAxisAngle } from './math.ts';

export type ParamSpec = Record<string, { min: number; max: number; default: number; unit: string; description: string }>;
export interface GeneratorInfo {
  kind: string;
  name: string;
  category: PartDefinition['category'];
  description: string;
  params: ParamSpec;
}
type Gen = (params: Record<string, number>, id: string) => PartDefinition;

const SOURCE = { kind: 'parametric' as const, license: 'CC0-1.0', creator: 'ProtoLab parametric library' };
const STEEL = 7850, ALU = 2700, PLA = 1240, RUBBER = 1100;
const COLORS = { titanium: '#b7bcc4', aluminium: '#cfd4da', motor: '#3a3f47', rubber: '#2b2b2b', shell: '#f2f4f7', brass: '#c8a951', steel: '#8d939b' };

const pieceAt = (shape: GeometryPiece['shape'], pos: Vec3, color: string, role: GeometryPiece['role'] = 'structure', rot = QUAT_ID): GeometryPiece =>
  ({ shape, offset: { position: pos, rotation: rot }, color, role });

function finish(base: Omit<PartDefinition, 'source' | 'limits' | 'cost_usd'> & Partial<Pick<PartDefinition, 'limits' | 'cost_usd'>>): PartDefinition {
  return PartDefinition.parse({ limits: {}, cost_usd: 0, ...base, source: SOURCE });
}
const boxMass = (l: number, w: number, h: number, density: number) => l * w * h * density;
const cylMass = (r: number, h: number, density: number) => Math.PI * r * r * h * density;

export const GENERATORS: Record<string, GeneratorInfo & { generate: Gen }> = {
  beam: {
    kind: 'beam', name: 'Rigid beam', category: 'frames',
    description: 'Rectangular aluminium beam with fixed mounts at both ends. Length along +X.',
    params: {
      length: { min: 0.02, max: 0.6, default: 0.1, unit: 'm', description: 'Length along X' },
      width: { min: 0.004, max: 0.05, default: 0.01, unit: 'm', description: 'Width (Z)' },
      height: { min: 0.004, max: 0.05, default: 0.01, unit: 'm', description: 'Height (Y)' },
    },
    generate: (p, id) => finish({
      id, kind: 'beam', name: `Beam ${(p.length * 1000).toFixed(0)}×${(p.width * 1000).toFixed(0)}×${(p.height * 1000).toFixed(0)} mm`, category: 'frames',
      description: 'Rigid aluminium beam.', params: p, mass_kg: boxMass(p.length, p.width, p.height, ALU), dimensions_m: [p.length, p.height, p.width], material: 'aluminium 6061',
      geometry: [pieceAt({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.aluminium)],
      connectors: [
        { id: 'end_a', position: [-p.length / 2, 0, 0], axis: [-1, 0, 0], kind: 'fixed' },
        { id: 'end_b', position: [p.length / 2, 0, 0], axis: [1, 0, 0], kind: 'fixed' },
      ], cost_usd: 1.5,
    }),
  },
  plate: {
    kind: 'plate', name: 'Mounting plate', category: 'frames',
    description: 'Flat plate with fixed mounts on top and bottom faces.',
    params: {
      length: { min: 0.02, max: 0.4, default: 0.08, unit: 'm', description: 'Length (X)' },
      width: { min: 0.02, max: 0.4, default: 0.05, unit: 'm', description: 'Width (Z)' },
      thickness: { min: 0.002, max: 0.02, default: 0.004, unit: 'm', description: 'Thickness (Y)' },
    },
    generate: (p, id) => finish({
      id, kind: 'plate', name: `Plate ${(p.length * 1000).toFixed(0)}×${(p.width * 1000).toFixed(0)} mm`, category: 'frames',
      description: 'Flat aluminium mounting plate.', params: p, mass_kg: boxMass(p.length, p.width, p.thickness, ALU), dimensions_m: [p.length, p.thickness, p.width], material: 'aluminium 6061',
      geometry: [pieceAt({ kind: 'box', size: [p.length, p.thickness, p.width] }, [0, 0, 0], COLORS.aluminium)],
      connectors: [
        { id: 'top', position: [0, p.thickness / 2, 0], axis: [0, 1, 0], kind: 'fixed' },
        { id: 'bottom', position: [0, -p.thickness / 2, 0], axis: [0, -1, 0], kind: 'fixed' },
      ], cost_usd: 2,
    }),
  },
  body_frame: {
    kind: 'body_frame', name: 'Chassis frame', category: 'frames',
    description: 'Box chassis with hip mount points on both sides for legPairs leg pairs. Connectors hip_L{i}/hip_R{i}.',
    params: {
      length: { min: 0.06, max: 0.5, default: 0.16, unit: 'm', description: 'Length (X, walking direction)' },
      width: { min: 0.03, max: 0.3, default: 0.08, unit: 'm', description: 'Width (Z)' },
      height: { min: 0.02, max: 0.2, default: 0.05, unit: 'm', description: 'Height (Y)' },
      legPairs: { min: 2, max: 3, default: 2, unit: '', description: 'Number of leg pairs (2 = quadruped, 3 = hexapod)' },
    },
    generate: (p, id) => {
      const pairs = Math.round(p.legPairs);
      const connectors: Connector[] = [];
      const margin = p.length * 0.15;
      for (let i = 0; i < pairs; i++) {
        const x = pairs === 1 ? 0 : p.length / 2 - margin - (i * (p.length - 2 * margin)) / (pairs - 1);
        connectors.push({ id: `hip_L${i}`, position: [x, 0, p.width / 2], axis: [0, 0, 1], kind: 'fixed' });
        connectors.push({ id: `hip_R${i}`, position: [x, 0, -p.width / 2], axis: [0, 0, -1], kind: 'fixed' });
      }
      connectors.push({ id: 'top', position: [0, p.height / 2, 0], axis: [0, 1, 0], kind: 'fixed' });
      connectors.push({ id: 'front', position: [p.length / 2, 0, 0], axis: [1, 0, 0], kind: 'fixed' });
      // shell-like frame: hollow look via thin walls, mass of a 1.5 mm aluminium shell + internal rails
      const shellMass = 2 * (p.length * p.width + p.length * p.height + p.width * p.height) * 0.0015 * ALU;
      return finish({
        id, kind: 'body_frame', name: `Chassis ${(p.length * 1000).toFixed(0)}×${(p.width * 1000).toFixed(0)}×${(p.height * 1000).toFixed(0)} mm`, category: 'frames',
        description: `Aluminium chassis frame for ${pairs} leg pairs.`, params: p, mass_kg: shellMass, dimensions_m: [p.length, p.height, p.width], material: 'aluminium 6061 sheet',
        geometry: [pieceAt({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.titanium)],
        connectors, cost_usd: 12,
      });
    },
  },
  servo_motor: {
    kind: 'servo_motor', name: 'Servo motor', category: 'motors',
    description: 'Hobby servo: rectangular case with output horn. Connector "mount" fixes the case; "horn" is a revolute output about the local Z axis.',
    params: {
      size: { min: 0.012, max: 0.06, default: 0.023, unit: 'm', description: 'Case length (X); height and depth scale with it' },
      torque: { min: 0.1, max: 6, default: 1.5, unit: 'N·m', description: 'Stall torque' },
      speed: { min: 2, max: 20, default: 8, unit: 'rad/s', description: 'No-load speed' },
    },
    generate: (p, id) => {
      const L = p.size, H = p.size * 0.9, D = p.size * 0.55;
      const mass = 0.009 + p.torque * 0.02; // 9 g micro servo .. ~130 g high torque
      return finish({
        id, kind: 'servo_motor', name: `Servo ${p.torque.toFixed(1)} N·m`, category: 'motors',
        description: `${p.torque.toFixed(1)} N·m, ${p.speed.toFixed(0)} rad/s hobby servo.`, params: p, mass_kg: mass, dimensions_m: [L, H, D], material: 'nylon case, metal gears',
        geometry: [
          pieceAt({ kind: 'box', size: [L, H, D] }, [0, 0, 0], COLORS.motor, 'motor'),
          pieceAt({ kind: 'cylinder', radius: L * 0.16, height: D * 0.4, axis: 'z' }, [0, 0, D / 2 + D * 0.2], COLORS.brass, 'motor'),
        ],
        connectors: [
          { id: 'mount', position: [0, 0, -D / 2], axis: [0, 0, -1], kind: 'fixed' },
          { id: 'horn', position: [0, 0, D / 2 + D * 0.4], axis: [0, 0, 1], kind: 'revolute' },
        ],
        limits: { maxTorque_Nm: p.torque, maxSpeed_rad_s: p.speed }, cost_usd: 4 + p.torque * 6,
      });
    },
  },
  leg_segment: {
    kind: 'leg_segment', name: 'Leg segment', category: 'frames',
    description: 'Flat bar with a revolute pivot at the top ("pivot") and a mount at the bottom ("tip"). Length runs down −Y from the pivot.',
    params: {
      length: { min: 0.02, max: 0.3, default: 0.06, unit: 'm', description: 'Pivot-to-tip length' },
      width: { min: 0.004, max: 0.03, default: 0.012, unit: 'm', description: 'Bar width (X)' },
      thickness: { min: 0.002, max: 0.02, default: 0.004, unit: 'm', description: 'Bar thickness (Z)' },
    },
    generate: (p, id) => finish({
      id, kind: 'leg_segment', name: `Leg bar ${(p.length * 1000).toFixed(0)} mm`, category: 'frames',
      description: 'Aluminium leg bar with pivot hole.', params: p, mass_kg: boxMass(p.length, p.width, p.thickness, ALU), dimensions_m: [p.width, p.length, p.thickness], material: 'aluminium 6061',
      geometry: [
        pieceAt({ kind: 'box', size: [p.width, p.length, p.thickness] }, [0, -p.length / 2, 0], COLORS.titanium),
        pieceAt({ kind: 'cylinder', radius: p.width * 0.7, height: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.steel),
      ],
      connectors: [
        { id: 'pivot', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' },
        { id: 'tip', position: [0, -p.length, 0], axis: [0, -1, 0], kind: 'fixed' },
      ], cost_usd: 1.2,
    }),
  },
  foot_pad: {
    kind: 'foot_pad', name: 'Rubber foot pad', category: 'pads',
    description: 'Spherical rubber contact pad. Connector "mount" on top.',
    params: { radius: { min: 0.004, max: 0.03, default: 0.01, unit: 'm', description: 'Pad radius' } },
    generate: (p, id) => finish({
      id, kind: 'foot_pad', name: `Foot pad Ø${(p.radius * 2000).toFixed(0)} mm`, category: 'pads',
      description: 'High-friction rubber pad.', params: p, mass_kg: (4 / 3) * Math.PI * p.radius ** 3 * RUBBER, dimensions_m: [p.radius * 2, p.radius * 2, p.radius * 2], material: 'rubber, 60A',
      geometry: [pieceAt({ kind: 'sphere', radius: p.radius }, [0, 0, 0], COLORS.rubber, 'contact')],
      connectors: [{ id: 'mount', position: [0, p.radius, 0], axis: [0, 1, 0], kind: 'fixed' }], cost_usd: 0.4,
    }),
  },
  bracket: {
    kind: 'bracket', name: 'L-bracket', category: 'brackets',
    description: 'Right-angle bracket joining two faces.',
    params: { size: { min: 0.01, max: 0.08, default: 0.02, unit: 'm', description: 'Leg length of the L' }, thickness: { min: 0.001, max: 0.006, default: 0.002, unit: 'm', description: 'Sheet thickness' } },
    generate: (p, id) => finish({
      id, kind: 'bracket', name: `L-bracket ${(p.size * 1000).toFixed(0)} mm`, category: 'brackets',
      description: 'Steel L-bracket.', params: p, mass_kg: 2 * p.size * p.size * p.thickness * STEEL, dimensions_m: [p.size, p.size, p.size], material: 'steel',
      geometry: [
        pieceAt({ kind: 'box', size: [p.size, p.thickness, p.size] }, [0, 0, 0], COLORS.steel),
        pieceAt({ kind: 'box', size: [p.thickness, p.size, p.size] }, [-p.size / 2, p.size / 2, 0], COLORS.steel),
      ],
      connectors: [
        { id: 'face_a', position: [0, -p.thickness / 2, 0], axis: [0, -1, 0], kind: 'fixed' },
        { id: 'face_b', position: [-p.size / 2 - p.thickness / 2, p.size / 2, 0], axis: [-1, 0, 0], kind: 'fixed' },
      ], cost_usd: 0.6,
    }),
  },
  shell_panel: {
    kind: 'shell_panel', name: 'Shell panel', category: 'shells',
    description: 'Cosmetic printed shell panel. No structural role.',
    params: {
      length: { min: 0.02, max: 0.5, default: 0.17, unit: 'm', description: 'Length (X)' },
      width: { min: 0.02, max: 0.3, default: 0.09, unit: 'm', description: 'Width (Z)' },
      thickness: { min: 0.001, max: 0.004, default: 0.002, unit: 'm', description: 'Thickness' },
    },
    generate: (p, id) => finish({
      id, kind: 'shell_panel', name: `Shell panel ${(p.length * 1000).toFixed(0)}×${(p.width * 1000).toFixed(0)} mm`, category: 'shells',
      description: 'PLA cosmetic shell.', params: p, mass_kg: boxMass(p.length, p.width, p.thickness, PLA), dimensions_m: [p.length, p.thickness, p.width], material: 'PLA',
      geometry: [pieceAt({ kind: 'box', size: [p.length, p.thickness, p.width] }, [0, 0, 0], COLORS.shell, 'shell')],
      connectors: [{ id: 'mount', position: [0, -p.thickness / 2, 0], axis: [0, -1, 0], kind: 'fixed' }], cost_usd: 3,
    }),
  },
  eye_module: {
    kind: 'eye_module', name: 'Eye module', category: 'shells',
    description: 'Decorative LED eye dome. No structural role.',
    params: { radius: { min: 0.004, max: 0.03, default: 0.009, unit: 'm', description: 'Dome radius' } },
    generate: (p, id) => finish({
      id, kind: 'eye_module', name: `Eye dome Ø${(p.radius * 2000).toFixed(0)} mm`, category: 'shells',
      description: 'Translucent dome with LED.', params: p, mass_kg: 0.004, dimensions_m: [p.radius * 2, p.radius * 2, p.radius * 2], material: 'acrylic',
      geometry: [pieceAt({ kind: 'sphere', radius: p.radius }, [0, 0, 0], '#49a3ff', 'decor')],
      connectors: [{ id: 'mount', position: [-p.radius, 0, 0], axis: [-1, 0, 0], kind: 'fixed' }], cost_usd: 1.5,
    }),
  },
  shaft: {
    kind: 'shaft', name: 'Steel shaft', category: 'shafts',
    description: 'Round steel shaft along X with revolute ends.',
    params: { length: { min: 0.01, max: 0.4, default: 0.06, unit: 'm', description: 'Length' }, radius: { min: 0.0015, max: 0.01, default: 0.003, unit: 'm', description: 'Radius' } },
    generate: (p, id) => finish({
      id, kind: 'shaft', name: `Shaft Ø${(p.radius * 2000).toFixed(0)}×${(p.length * 1000).toFixed(0)} mm`, category: 'shafts',
      description: 'Ground steel shaft.', params: p, mass_kg: cylMass(p.radius, p.length, STEEL), dimensions_m: [p.length, p.radius * 2, p.radius * 2], material: 'steel',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'x' }, [0, 0, 0], COLORS.steel)],
      connectors: [
        { id: 'end_a', position: [-p.length / 2, 0, 0], axis: [-1, 0, 0], kind: 'revolute' },
        { id: 'end_b', position: [p.length / 2, 0, 0], axis: [1, 0, 0], kind: 'revolute' },
      ], cost_usd: 1,
    }),
  },
  gear: {
    kind: 'gear', name: 'Spur gear', category: 'gears',
    description: 'Spur gear; pitch radius = module × teeth / 2. Revolute bore along Z.',
    params: { teeth: { min: 8, max: 80, default: 20, unit: '', description: 'Tooth count' }, module: { min: 0.0005, max: 0.002, default: 0.001, unit: 'm', description: 'Module' }, thickness: { min: 0.002, max: 0.02, default: 0.005, unit: 'm', description: 'Face width' } },
    generate: (p, id) => { const r = (p.module * p.teeth) / 2; return finish({
      id, kind: 'gear', name: `Gear ${Math.round(p.teeth)}T m${(p.module * 1000).toFixed(1)}`, category: 'gears',
      description: `${Math.round(p.teeth)}-tooth spur gear, pitch Ø${(r * 2000).toFixed(1)} mm.`, params: p, mass_kg: cylMass(r, p.thickness, STEEL) * 0.8, dimensions_m: [r * 2, r * 2, p.thickness], material: 'steel',
      geometry: [pieceAt({ kind: 'cylinder', radius: r, height: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.brass)],
      connectors: [{ id: 'bore', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' }], cost_usd: 2.5,
    }); },
  },
  wheel: {
    kind: 'wheel', name: 'Rubber wheel', category: 'wheels',
    description: 'Rubber-tyred wheel with revolute hub along Z.',
    params: { radius: { min: 0.01, max: 0.1, default: 0.03, unit: 'm', description: 'Radius' }, width: { min: 0.005, max: 0.04, default: 0.012, unit: 'm', description: 'Width' } },
    generate: (p, id) => finish({
      id, kind: 'wheel', name: `Wheel Ø${(p.radius * 2000).toFixed(0)} mm`, category: 'wheels',
      description: 'Rubber-tyred wheel.', params: p, mass_kg: cylMass(p.radius, p.width, RUBBER) * 0.6, dimensions_m: [p.radius * 2, p.radius * 2, p.width], material: 'rubber / nylon hub',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.radius, height: p.width, axis: 'z' }, [0, 0, 0], COLORS.rubber, 'contact')],
      connectors: [{ id: 'hub', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' }], cost_usd: 2,
    }),
  },
  bearing: {
    kind: 'bearing', name: 'Ball bearing', category: 'bearings',
    description: 'Radial ball bearing. Outer race fixed, inner race revolute along Z.',
    params: { outerRadius: { min: 0.004, max: 0.03, default: 0.008, unit: 'm', description: 'Outer radius' }, width: { min: 0.002, max: 0.012, default: 0.004, unit: 'm', description: 'Width' } },
    generate: (p, id) => finish({
      id, kind: 'bearing', name: `Bearing Ø${(p.outerRadius * 2000).toFixed(0)} mm`, category: 'bearings',
      description: 'Shielded radial bearing.', params: p, mass_kg: cylMass(p.outerRadius, p.width, STEEL) * 0.5, dimensions_m: [p.outerRadius * 2, p.outerRadius * 2, p.width], material: 'steel',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.outerRadius, height: p.width, axis: 'z' }, [0, 0, 0], COLORS.steel)],
      connectors: [
        { id: 'outer', position: [0, p.outerRadius, 0], axis: [0, 1, 0], kind: 'fixed' },
        { id: 'inner', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' },
      ], limits: { maxLoad_N: 200 }, cost_usd: 1.2,
    }),
  },
  hinge: {
    kind: 'hinge', name: 'Hinge', category: 'joints',
    description: 'Two-leaf hinge; leaves fixed, pin revolute along X.',
    params: { length: { min: 0.01, max: 0.1, default: 0.03, unit: 'm', description: 'Pin length' } },
    generate: (p, id) => finish({
      id, kind: 'hinge', name: `Hinge ${(p.length * 1000).toFixed(0)} mm`, category: 'joints',
      description: 'Steel butt hinge.', params: p, mass_kg: 0.004 * p.length / 0.03, dimensions_m: [p.length, 0.006, 0.02], material: 'steel',
      geometry: [pieceAt({ kind: 'cylinder', radius: 0.003, height: p.length, axis: 'x' }, [0, 0, 0], COLORS.steel), pieceAt({ kind: 'box', size: [p.length, 0.001, 0.02] }, [0, -0.002, 0], COLORS.steel)],
      connectors: [
        { id: 'leaf_a', position: [0, -0.003, 0.01], axis: [0, -1, 0], kind: 'fixed' },
        { id: 'leaf_b', position: [0, -0.003, -0.01], axis: [0, -1, 0], kind: 'revolute' },
      ], cost_usd: 0.8,
    }),
  },
  spring: {
    kind: 'spring', name: 'Compression spring', category: 'springs',
    description: 'Helical compression spring along Y.',
    params: { length: { min: 0.01, max: 0.15, default: 0.04, unit: 'm', description: 'Free length' }, radius: { min: 0.003, max: 0.02, default: 0.006, unit: 'm', description: 'Coil radius' }, stiffness: { min: 50, max: 5000, default: 500, unit: 'N/m', description: 'Spring rate' } },
    generate: (p, id) => finish({
      id, kind: 'spring', name: `Spring ${p.stiffness.toFixed(0)} N/m`, category: 'springs',
      description: 'Music-wire compression spring.', params: p, mass_kg: 0.003 * (p.length / 0.04), dimensions_m: [p.radius * 2, p.length, p.radius * 2], material: 'music wire',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'y' }, [0, 0, 0], COLORS.steel)],
      connectors: [
        { id: 'end_a', position: [0, p.length / 2, 0], axis: [0, 1, 0], kind: 'fixed' },
        { id: 'end_b', position: [0, -p.length / 2, 0], axis: [0, -1, 0], kind: 'fixed' },
      ], cost_usd: 0.5,
    }),
  },
  screw: {
    kind: 'screw', name: 'Machine screw', category: 'fasteners',
    description: 'Metric machine screw.',
    params: { length: { min: 0.004, max: 0.04, default: 0.01, unit: 'm', description: 'Length' }, radius: { min: 0.001, max: 0.003, default: 0.0015, unit: 'm', description: 'Thread radius' } },
    generate: (p, id) => finish({
      id, kind: 'screw', name: `M${(p.radius * 2000).toFixed(0)}×${(p.length * 1000).toFixed(0)} screw`, category: 'fasteners',
      description: 'Stainless machine screw.', params: p, mass_kg: cylMass(p.radius, p.length, STEEL) + 0.0003, dimensions_m: [p.radius * 2, p.length, p.radius * 2], material: 'stainless steel',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'y' }, [0, -p.length / 2, 0], COLORS.steel, 'fastener'), pieceAt({ kind: 'cylinder', radius: p.radius * 1.8, height: p.radius * 1.5, axis: 'y' }, [0, p.radius * 0.75, 0], COLORS.steel, 'fastener')],
      connectors: [{ id: 'head', position: [0, 0, 0], axis: [0, 1, 0], kind: 'fixed' }], cost_usd: 0.05,
    }),
  },
  gripper_finger: {
    kind: 'gripper_finger', name: 'Gripper finger', category: 'grippers',
    description: 'Curved finger with pad; revolute root along Z.',
    params: { length: { min: 0.02, max: 0.15, default: 0.05, unit: 'm', description: 'Length' } },
    generate: (p, id) => finish({
      id, kind: 'gripper_finger', name: `Gripper finger ${(p.length * 1000).toFixed(0)} mm`, category: 'grippers',
      description: 'PLA finger with rubber pad.', params: p, mass_kg: boxMass(p.length, 0.01, 0.006, PLA), dimensions_m: [0.01, p.length, 0.006], material: 'PLA + rubber',
      geometry: [pieceAt({ kind: 'box', size: [0.01, p.length, 0.006] }, [0, -p.length / 2, 0], COLORS.shell), pieceAt({ kind: 'box', size: [0.012, 0.01, 0.007] }, [0, -p.length + 0.005, 0], COLORS.rubber, 'contact')],
      connectors: [{ id: 'root', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' }], cost_usd: 1,
    }),
  },
  pulley: {
    kind: 'pulley', name: 'Pulley', category: 'wheels',
    description: 'Grooved pulley with revolute bore along Z.',
    params: { radius: { min: 0.005, max: 0.05, default: 0.015, unit: 'm', description: 'Radius' } },
    generate: (p, id) => finish({
      id, kind: 'pulley', name: `Pulley Ø${(p.radius * 2000).toFixed(0)} mm`, category: 'wheels',
      description: 'Nylon pulley.', params: p, mass_kg: cylMass(p.radius, 0.008, PLA), dimensions_m: [p.radius * 2, p.radius * 2, 0.008], material: 'nylon',
      geometry: [pieceAt({ kind: 'cylinder', radius: p.radius, height: 0.008, axis: 'z' }, [0, 0, 0], COLORS.shell)],
      connectors: [{ id: 'bore', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' }], cost_usd: 0.9,
    }),
  },
};

export class ParamError extends Error {}

/** Validate params against the generator's spec (fill defaults, reject out-of-range) and generate the part. */
export function generatePart(kind: string, params: Record<string, number>, id?: string): PartDefinition {
  const g = GENERATORS[kind];
  if (!g) throw new ParamError(`Unknown part kind "${kind}". Known kinds: ${Object.keys(GENERATORS).join(', ')}`);
  const resolved: Record<string, number> = {};
  for (const [k, spec] of Object.entries(g.params)) {
    const val = params[k] ?? spec.default;
    if (typeof val !== 'number' || !Number.isFinite(val)) throw new ParamError(`Param "${k}" for ${kind} must be a number`);
    if (val < spec.min || val > spec.max) throw new ParamError(`Param "${k}"=${val} for ${kind} out of range [${spec.min}, ${spec.max}] ${spec.unit}`);
    resolved[k] = val;
  }
  for (const k of Object.keys(params)) if (!(k in g.params)) throw new ParamError(`Unknown param "${k}" for ${kind}. Allowed: ${Object.keys(g.params).join(', ')}`);
  const partId = id ?? `${kind}:${Object.entries(resolved).map(([k, v]) => `${k}=${+v.toPrecision(4)}`).join(',')}`;
  return g.generate(resolved, partId);
}

export function generatorInfo(): GeneratorInfo[] {
  return Object.values(GENERATORS).map(({ kind, name, category, description, params }) => ({ kind, name, category, description, params }));
}

export { quatFromAxisAngle };

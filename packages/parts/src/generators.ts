import { PartDefinition, type GeometryPiece, type Connector, type Vec3, type PartCategory, type Shape, type Profile, type Vec2 } from '@protolab/schema';
import { QUAT_ID, quatFromAxisAngle, quatMul, rotate } from './math.ts';
import { profiles, shapeVolume, ensureCCW } from './geometry.ts';

export type ParamSpec = Record<string, { min: number; max: number; default: number; unit: string; description: string }>;
export interface GeneratorInfo { kind: string; name: string; category: PartCategory; description: string; params: ParamSpec }
type Gen = (p: Record<string, number>, id: string) => PartDefinition;

const SOURCE = { kind: 'parametric' as const, license: 'CC0-1.0', creator: 'ProtoLab parametric library' };
export const DENSITY = { steel: 7850, aluminium: 2700, pla: 1240, rubber: 1100, acrylic: 1180, nylon: 1150, balsa: 160, carbon: 1600, foam: 30 };
export const COLORS = { titanium: '#b7bcc4', aluminium: '#cfd4da', motor: '#3a3f47', rubber: '#2b2b2b', shell: '#f2f4f7', brass: '#c8a951', steel: '#8d939b', pla: '#e9ecf0', orange: '#f28c1d', blue: '#1d6ff2', wing: '#f4a261', wing2: '#2a9d8f', red: '#e63946', wood: '#c9a66b' };

export const piece = (shape: Shape, pos: Vec3 = [0, 0, 0], color = COLORS.titanium, role: GeometryPiece['role'] = 'structure', rot = QUAT_ID, extra: Partial<GeometryPiece> = {}): GeometryPiece =>
  ({ shape, offset: { position: pos, rotation: rot }, color, role, collide: true, ...extra });

export function finish(base: Omit<PartDefinition, 'source' | 'limits' | 'cost_usd' | 'decorative'> & Partial<Pick<PartDefinition, 'limits' | 'cost_usd'>>): PartDefinition {
  return PartDefinition.parse({ limits: {}, cost_usd: 0, decorative: false, ...base, source: SOURCE });
}
const mm = (v: number) => (v * 1000).toFixed(0);
const vol = (pieces: GeometryPiece[]) => pieces.reduce((s, p) => s + shapeVolume(p.shape), 0);
const fx = (id: string, position: Vec3, axis: Vec3, kind: Connector['kind'] = 'fixed', description?: string): Connector => ({ id, position, axis, kind, description });

const GENEVA_PARAMS: ParamSpec = {
  centreDistance: { min: 0.025, max: 0.2, default: 0.06, unit: 'm', description: 'Distance between driver and output axes. Match both parts.' },
  pinRadius: { min: 0.001, max: 0.012, default: 0.0025, unit: 'm', description: 'Driver pin radius. Match both parts.' },
  clearance: { min: 0.0002, max: 0.004, default: 0.0008, unit: 'm', description: 'Total slot clearance. Match both parts.' },
  thickness: { min: 0.003, max: 0.02, default: 0.006, unit: 'm', description: 'Wheel thickness and driver axial offset. Match both parts.' },
};

function genevaDimensions(centreDistance: number, pinRadius: number, clearance: number) {
  const crankRadius = centreDistance / Math.SQRT2;
  if (pinRadius + clearance > crankRadius / 7) throw new ParamError('Geneva pin and clearance must total at most one seventh of the crank radius.');
  const halfSlot = pinRadius + clearance / 2;
  const lockRadius = crankRadius - 3 * pinRadius;
  const recessRadius = lockRadius + clearance / 2 + crankRadius * 0.004;
  const slotLipX = Math.sqrt(crankRadius ** 2 - halfSlot ** 2);
  if (Math.hypot(crankRadius - slotLipX, crankRadius - halfSlot) <= recessRadius) {
    throw new ParamError('Geneva locking recess reaches the slot lip. Increase the pin radius or reduce the clearance.');
  }
  return { crankRadius, halfSlot, lockRadius, recessRadius };
}

// ------------------------------------------------------------------------------------------------
// Generators. Conventions: X is the main length axis; Y is up; Z is lateral. Connector axes point
// OUT of the part; mating connectors face each other. Revolute connectors spin about their axis.
// ------------------------------------------------------------------------------------------------
export const GENERATORS: Record<string, GeneratorInfo & { generate: Gen }> = {
  marker_tip: {
    kind: 'marker_tip', name: 'Drawing marker', category: 'misc',
    description: 'Fixed-mount marker for a plotter or drawing linkage. Its working point is the local origin, facing +Z.',
    params: {
      diameter: { min: 0.004, max: 0.025, default: 0.008, unit: 'm', description: 'Barrel diameter' },
      length: { min: 0.008, max: 0.06, default: 0.016, unit: 'm', description: 'Length from rear to tip' },
    },
    generate: (p, id) => {
      const radius = p.diameter / 2;
      const barrelLength = p.length * 0.75;
      const tipRadius = radius * 0.3;
      const geometry = [
        piece({ kind: 'cylinder', radius, height: barrelLength, axis: 'z' }, [0, 0, -p.length + barrelLength / 2], COLORS.red),
        piece({ kind: 'cylinder', radius: radius * 0.55, height: p.length - barrelLength, axis: 'z' }, [0, 0, -(p.length - barrelLength) / 2], COLORS.brass),
        piece({ kind: 'sphere', radius: tipRadius }, [0, 0, 0], COLORS.red),
      ];
      return finish({
        id, kind: 'marker_tip', name: `Drawing marker Ø${mm(p.diameter)} mm`, category: 'misc',
        description: 'Carries a visible tip on a passive drawing linkage or plotter.',
        params: p, mass_kg: vol(geometry) * DENSITY.pla, dimensions_m: [p.diameter, p.diameter, p.length + tipRadius],
        material: 'polymer', geometry, connectors: [
          fx('mount', [0, 0, -p.length * 0.6875], [0, 0, -1], 'fixed', 'Attach to a linkage or carriage'),
        ], cost_usd: 2,
      });
    },
  },
  // ---------- structural ----------
  beam: { kind: 'beam', name: 'Beam', category: 'beams', description: 'Rectangular aluminium beam along X with fixed mounts at both ends and on each face centre.', params: { length: { min: 0.02, max: 1.2, default: 0.1, unit: 'm', description: 'Length (X)' }, width: { min: 0.003, max: 0.08, default: 0.01, unit: 'm', description: 'Width (Z)' }, height: { min: 0.003, max: 0.08, default: 0.01, unit: 'm', description: 'Height (Y)' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.aluminium)]; return finish({ id, kind: 'beam', name: `Beam ${mm(p.length)}×${mm(p.width)}×${mm(p.height)} mm`, category: 'beams', description: 'Rigid aluminium beam.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.length, p.height, p.width], material: 'aluminium 6061', geometry: g,
      connectors: [fx('end_a', [-p.length / 2, 0, 0], [-1, 0, 0]), fx('end_b', [p.length / 2, 0, 0], [1, 0, 0]), fx('top', [0, p.height / 2, 0], [0, 1, 0]), fx('bottom', [0, -p.height / 2, 0], [0, -1, 0]), fx('side_a', [0, 0, p.width / 2], [0, 0, 1]), fx('side_b', [0, 0, -p.width / 2], [0, 0, -1])], cost_usd: 1 + p.length * 8 }); } },
  rod: { kind: 'rod', name: 'Round rod', category: 'beams', description: 'Round carbon rod along X; fixed ends, revolute centre.', params: { length: { min: 0.02, max: 1.2, default: 0.2, unit: 'm', description: 'Length' }, radius: { min: 0.001, max: 0.02, default: 0.004, unit: 'm', description: 'Radius' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'x' }, [0, 0, 0], '#333')]; return finish({ id, kind: 'rod', name: `Rod Ø${mm(p.radius * 2)}×${mm(p.length)} mm`, category: 'beams', description: 'Carbon-fibre rod.', params: p, mass_kg: vol(g) * DENSITY.carbon, dimensions_m: [p.length, p.radius * 2, p.radius * 2], material: 'carbon fibre', geometry: g, connectors: [fx('end_a', [-p.length / 2, 0, 0], [-1, 0, 0]), fx('end_b', [p.length / 2, 0, 0], [1, 0, 0]), fx('mid', [0, p.radius, 0], [0, 1, 0]), fx('mid_pivot', [0, 0, 0], [0, 0, 1], 'revolute')], cost_usd: 2 }); } },
  plate: { kind: 'plate', name: 'Plate', category: 'plates', description: 'Flat plate (X×Z) with fixed mounts on top/bottom centre, corners and edges, plus hinge_back / hinge_front revolute pivots about Z at the edges (a deck, lid or flap that lifts).', params: { length: { min: 0.01, max: 1.0, default: 0.08, unit: 'm', description: 'Length (X)' }, width: { min: 0.01, max: 1.0, default: 0.05, unit: 'm', description: 'Width (Z)' }, thickness: { min: 0.001, max: 0.03, default: 0.004, unit: 'm', description: 'Thickness (Y)' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.length, p.thickness, p.width] }, [0, 0, 0], COLORS.aluminium)]; const L = p.length / 2, W = p.width / 2, T = p.thickness / 2; return finish({ id, kind: 'plate', name: `Plate ${mm(p.length)}×${mm(p.width)} mm`, category: 'plates', description: 'Aluminium plate.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.length, p.thickness, p.width], material: 'aluminium 6061', geometry: g,
      connectors: [fx('top', [0, T, 0], [0, 1, 0]), fx('bottom', [0, -T, 0], [0, -1, 0]), fx('front', [L, 0, 0], [1, 0, 0]), fx('back', [-L, 0, 0], [-1, 0, 0]), fx('left', [0, 0, W], [0, 0, 1]), fx('right', [0, 0, -W], [0, 0, -1]), fx('top_front', [L * 0.8, T, 0], [0, 1, 0]), fx('top_back', [-L * 0.8, T, 0], [0, 1, 0]), fx('top_left', [0, T, W * 0.8], [0, 1, 0]), fx('top_right', [0, T, -W * 0.8], [0, 1, 0]), fx('corner_fl', [L * 0.85, T, W * 0.85], [0, 1, 0]), fx('corner_fr', [L * 0.85, T, -W * 0.85], [0, 1, 0]), fx('corner_bl', [-L * 0.85, T, W * 0.85], [0, 1, 0]), fx('corner_br', [-L * 0.85, T, -W * 0.85], [0, 1, 0]), fx('hinge_back', [-L, 0, 0], [0, 0, 1], 'revolute', 'rear-edge hinge: pivot about Z at the back edge (lid / drawbridge deck / flap); mount onto a servo horn or hinge leaf'), fx('hinge_front', [L, 0, 0], [0, 0, 1], 'revolute', 'front-edge hinge about Z')], cost_usd: 2 + p.length * p.width * 100 }); } },
  body_frame: { kind: 'body_frame', name: 'Chassis frame', category: 'frames', description: 'Box chassis with hip mounts on both sides (hip_L{i}/hip_R{i} for legPairs pairs), top/bottom/front/back mounts.', params: { length: { min: 0.04, max: 0.6, default: 0.16, unit: 'm', description: 'Length (X)' }, width: { min: 0.02, max: 0.4, default: 0.08, unit: 'm', description: 'Width (Z)' }, height: { min: 0.01, max: 0.3, default: 0.05, unit: 'm', description: 'Height (Y)' }, legPairs: { min: 1, max: 4, default: 2, unit: '', description: 'Leg pairs' } },
    generate: (p, id) => { const pairs = Math.round(p.legPairs); const c: Connector[] = []; const margin = p.length * 0.15; for (let i = 0; i < pairs; i++) { const x = pairs === 1 ? 0 : p.length / 2 - margin - (i * (p.length - 2 * margin)) / (pairs - 1); c.push(fx(`hip_L${i}`, [x, 0, p.width / 2], [0, 0, 1], 'any'), fx(`hip_R${i}`, [x, 0, -p.width / 2], [0, 0, -1], 'any')); }
      c.push(fx('top', [0, p.height / 2, 0], [0, 1, 0]), fx('bottom', [0, -p.height / 2, 0], [0, -1, 0]), fx('front', [p.length / 2, 0, 0], [1, 0, 0]), fx('back', [-p.length / 2, 0, 0], [-1, 0, 0]), fx('front_top', [p.length / 2, p.height * 0.3, 0], [1, 0, 0]));
      const g = [piece({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.titanium)]; const shellMass = 2 * (p.length * p.width + p.length * p.height + p.width * p.height) * 0.0015 * DENSITY.aluminium;
      return finish({ id, kind: 'body_frame', name: `Chassis ${mm(p.length)}×${mm(p.width)}×${mm(p.height)} mm`, category: 'frames', description: `Aluminium chassis for ${pairs} leg pairs.`, params: p, mass_kg: shellMass, dimensions_m: [p.length, p.height, p.width], material: 'aluminium sheet', geometry: g, connectors: c, cost_usd: 12 }); } },
  enclosure: { kind: 'enclosure', name: 'Enclosure box', category: 'enclosures', description: 'Hollow printed box body with mounts on every face.', params: { length: { min: 0.02, max: 0.6, default: 0.1, unit: 'm', description: 'Length (X)' }, width: { min: 0.02, max: 0.6, default: 0.06, unit: 'm', description: 'Width (Z)' }, height: { min: 0.01, max: 0.4, default: 0.04, unit: 'm', description: 'Height (Y)' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.shell, 'shell')]; const mass = 2 * (p.length * p.width + p.length * p.height + p.width * p.height) * 0.002 * DENSITY.pla; const L = p.length / 2, W = p.width / 2, H = p.height / 2;
      return finish({ id, kind: 'enclosure', name: `Enclosure ${mm(p.length)}×${mm(p.width)}×${mm(p.height)} mm`, category: 'enclosures', description: 'PLA enclosure.', params: p, mass_kg: mass, dimensions_m: [p.length, p.height, p.width], material: 'PLA', geometry: g, connectors: [fx('top', [0, H, 0], [0, 1, 0]), fx('bottom', [0, -H, 0], [0, -1, 0]), fx('front', [L, 0, 0], [1, 0, 0]), fx('back', [-L, 0, 0], [-1, 0, 0]), fx('left', [0, 0, W], [0, 0, 1]), fx('right', [0, 0, -W], [0, 0, -1])], cost_usd: 6 }); } },
  curved_panel: { kind: 'curved_panel', name: 'Curved panel', category: 'panels', description: 'Arc-section shell panel (bent sheet) spanning `span` radians at radius `radius`, extruded `width` along Z; mounts at the arc ends and centre.', params: { radius: { min: 0.01, max: 0.5, default: 0.06, unit: 'm', description: 'Bend radius' }, span: { min: 0.2, max: 6.28, default: 1.5708, unit: 'rad', description: 'Arc angle' }, width: { min: 0.01, max: 0.6, default: 0.08, unit: 'm', description: 'Width (Z)' }, thickness: { min: 0.001, max: 0.01, default: 0.002, unit: 'm', description: 'Sheet thickness' } },
    generate: (p, id) => { const prof = profiles.arcBand(p.radius - p.thickness, p.radius, p.span, 14); const g = [piece({ kind: 'extrude', profile: prof, depth: p.width, axis: 'z' }, [0, 0, 0], COLORS.shell, 'shell')]; const a = p.span / 2; return finish({ id, kind: 'curved_panel', name: `Curved panel R${mm(p.radius)} ${Math.round((p.span * 180) / Math.PI)}°`, category: 'panels', description: 'Formed aluminium panel.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.radius * 2, p.radius * 2, p.width], material: 'aluminium sheet', geometry: g,
      connectors: [fx('centre_in', [p.radius - p.thickness, 0, 0], [-1, 0, 0]), fx('centre_out', [p.radius, 0, 0], [1, 0, 0]), fx('end_a', [p.radius * Math.cos(a), p.radius * Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0]), fx('end_b', [p.radius * Math.cos(-a), p.radius * Math.sin(-a), 0], [-Math.sin(a), -Math.cos(a), 0]), fx('side', [p.radius - p.thickness / 2, 0, p.width / 2], [0, 0, 1])], cost_usd: 5 }); } },
  bracket: { kind: 'bracket', name: 'L-bracket', category: 'brackets', description: 'Right-angle bracket: face_a (−Y) and face_b (−X) mounts.', params: { size: { min: 0.008, max: 0.15, default: 0.02, unit: 'm', description: 'Leg length' }, width: { min: 0.005, max: 0.1, default: 0.02, unit: 'm', description: 'Width (Z)' }, thickness: { min: 0.001, max: 0.006, default: 0.002, unit: 'm', description: 'Sheet' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.size, p.thickness, p.width] }, [0, 0, 0], COLORS.steel), piece({ kind: 'box', size: [p.thickness, p.size, p.width] }, [-p.size / 2 + p.thickness / 2, p.size / 2, 0], COLORS.steel)]; return finish({ id, kind: 'bracket', name: `L-bracket ${mm(p.size)} mm`, category: 'brackets', description: 'Steel L-bracket.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.size, p.size, p.width], material: 'steel', geometry: g, connectors: [fx('face_a', [0, -p.thickness / 2, 0], [0, -1, 0]), fx('face_b', [-p.size / 2, p.size / 2, 0], [-1, 0, 0]), fx('top', [p.size * 0.25, p.thickness / 2, 0], [0, 1, 0])], cost_usd: 0.6 }); } },
  tower: { kind: 'tower', name: 'A-frame tower', category: 'frames', description: 'Two-leg A-frame support with a revolute axle mount at the top (axis Z) and a wide base; place anchored on the ground.', params: { height: { min: 0.05, max: 1.2, default: 0.3, unit: 'm', description: 'Height to axle' }, baseWidth: { min: 0.04, max: 1.0, default: 0.2, unit: 'm', description: 'Base spread (X)' }, legWidth: { min: 0.004, max: 0.05, default: 0.012, unit: 'm', description: 'Leg section' } },
    generate: (p, id) => { const L = Math.hypot(p.height, p.baseWidth / 2); const ang = Math.atan2(p.baseWidth / 2, p.height); const g = [piece({ kind: 'box', size: [p.legWidth, L, p.legWidth] }, [p.baseWidth / 4, p.height / 2, 0], COLORS.steel, 'structure', quatFromAxisAngle([0, 0, 1], ang)), piece({ kind: 'box', size: [p.legWidth, L, p.legWidth] }, [-p.baseWidth / 4, p.height / 2, 0], COLORS.steel, 'structure', quatFromAxisAngle([0, 0, 1], -ang)), piece({ kind: 'box', size: [p.baseWidth, p.legWidth, p.legWidth * 3] }, [0, p.legWidth / 2, 0], COLORS.steel), piece({ kind: 'cylinder', radius: p.legWidth, height: p.legWidth * 3, axis: 'z' }, [0, p.height, 0], COLORS.brass)];
      return finish({ id, kind: 'tower', name: `A-frame tower ${mm(p.height)} mm`, category: 'frames', description: 'Steel A-frame with top axle boss.', params: p, mass_kg: vol(g) * DENSITY.steel * 0.6, dimensions_m: [p.baseWidth, p.height, p.legWidth * 3], material: 'steel', geometry: g, connectors: [fx('base', [0, 0, 0], [0, -1, 0]), fx('axle', [0, p.height, p.legWidth * 1.5], [0, 0, 1], 'revolute', 'axle boss, spins about Z'), fx('axle_back', [0, p.height, -p.legWidth * 1.5], [0, 0, -1], 'revolute'), fx('top', [0, p.height + p.legWidth, 0], [0, 1, 0])], cost_usd: 8 }); } },
  radial_hub: {
    kind: 'radial_hub', name: 'Radial linkage hub', category: 'linkages',
    description: 'Round Y-axis hub with evenly spaced stations for folding petals, iris blades, and vents. Use hinge_0…N−1 for tangential fold hinges or pin_0…N−1 for vertical iris pivots. Attach mount below to a support, or slide/spin to a driver.',
    params: {
      radius: { min: 0.015, max: 0.24, default: 0.055, unit: 'm', description: 'Centre to hinge station' },
      thickness: { min: 0.003, max: 0.03, default: 0.008, unit: 'm', description: 'Hub plate thickness along Y' },
      stations: { min: 3, max: 12, default: 6, unit: '', description: 'Number of equally spaced stations (integer)' },
    },
    generate: (p, id) => {
      const { radius, thickness, stations } = p;
      if (!Number.isInteger(stations)) throw new ParamError('Radial hub station count must be an integer.');
      if (thickness > radius * 0.65) throw new ParamError('Radial hub thickness must be at most 65% of the station radius.');
      const bossRadius = Math.min(thickness * 0.75, radius * 0.18);
      const hingeHeight = thickness / 2 + bossRadius;
      const geometry = [
        piece({ kind: 'cylinder', radius: radius * 0.9, height: thickness, axis: 'y' }, [0, 0, 0], '#3c526a'),
        piece({ kind: 'cylinder', radius: radius * 0.28, height: thickness * 0.4, axis: 'y' }, [0, thickness * 0.7, 0], COLORS.brass),
      ];
      const connectors: Connector[] = [
        fx('mount', [0, -thickness / 2, 0], [0, -1, 0], 'fixed', 'Fixed mount beneath the hub'),
        fx('slide', [0, -thickness / 2, 0], [0, -1, 0], 'prismatic', 'Vertical guide or synchronized linkage yoke'),
        fx('spin', [0, -thickness / 2, 0], [0, -1, 0], 'revolute', 'Central rotary axis'),
        fx('top', [0, thickness * 0.9, 0], [0, 1, 0]),
      ];
      for (let station = 0; station < stations; station++) {
        const angle = station * 2 * Math.PI / stations;
        const radial: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
        const tangent: Vec3 = [-radial[2], 0, radial[0]];
        const pivot: Vec3 = [radial[0] * radius, hingeHeight, radial[2] * radius];
        const padRadius = radius * 0.15;
        geometry.push(
          piece({ kind: 'cylinder', radius: padRadius, height: thickness, axis: 'y' }, [pivot[0], 0, pivot[2]], '#52748b'),
          piece({ kind: 'cylinder', radius: bossRadius, height: padRadius * 1.4, axis: 'z' }, pivot, COLORS.brass, 'structure', quatFromAxisAngle([0, 1, 0], -angle)),
        );
        connectors.push(
          fx(`hinge_${station}`, pivot, tangent, 'revolute', 'Tangential axis. Mount a petal by its hinge with spin_deg 0 for a flat outward rest pose. Positive joint angle lifts it.'),
          fx(`pin_${station}`, pivot, [0, 1, 0], 'revolute', `Vertical axis for an iris blade. With hinged_petal.iris_pivot, use spin_deg ${Math.round(-angle * 180 / Math.PI)} to point outward before adding a sweep offset.`),
        );
      }
      return finish({
        id, kind: 'radial_hub', name: `Radial hub ${stations}-station Ø${mm(radius * 2)} mm`, category: 'linkages',
        description: `A ${stations}-station hub or yoke with tangential folding hinges and vertical iris pivots. Stagger or space the panels to give them clearance.`,
        params: p, geometry, connectors, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [radius * 2.3, Math.max(thickness * 1.4, thickness + 2 * bossRadius), radius * 2.3], cost_usd: 5,
      });
    },
  },
  hinged_petal: {
    kind: 'hinged_petal', name: 'Hinged petal panel', category: 'panels',
    description: 'Lightweight tapered panel for flower mechanisms, shutters, iris blades or vents. Extends from its root along +X. Mount hinge for vertical fold about Z, or iris_pivot for planar swing about Y. Use fold_link or iris_link for optional rods, and tip for a fixed test marker.',
    params: {
      length: { min: 0.025, max: 0.45, default: 0.09, unit: 'm', description: 'Root-to-tip length along X' },
      width: { min: 0.008, max: 0.28, default: 0.038, unit: 'm', description: 'Maximum panel width along Z' },
      thickness: { min: 0.0008, max: 0.009, default: 0.002, unit: 'm', description: 'Panel thickness along Y' },
      rootRatio: { min: 0.1, max: 1, default: 0.35, unit: 'ratio', description: 'Root width divided by panel width' },
      linkRatio: { min: 0.15, max: 0.85, default: 0.35, unit: 'ratio', description: 'Optional link mount distance from the root, divided by panel length' },
    },
    generate: (p, id) => {
      const { length, width, thickness, rootRatio, linkRatio } = p;
      if (thickness > Math.min(length, width) / 3) throw new ParamError('Hinged panel thickness must be at most one third of its length and width.');
      const samples = 16;
      const halfWidth = (t: number) => width / 2 * (rootRatio * (1 - t) + (1 - rootRatio * (1 - t)) * Math.sin(Math.PI * t) ** 0.8);
      const profile: Profile = [];
      for (let i = 0; i < samples; i++) {
        const t = i / samples;
        profile.push([t * length, -halfWidth(t)]);
      }
      profile.push([length, 0]);
      for (let i = samples - 1; i >= 0; i--) {
        const t = i / samples;
        profile.push([t * length, halfWidth(t)]);
      }
      const rootWidth = width * rootRatio;
      const bossRadius = Math.min(thickness * 1.2, width * 0.12);
      const linkX = length * linkRatio;
      const geometry = [
        piece({ kind: 'extrude', profile, depth: thickness, axis: 'y' }, [0, 0, 0], '#a25aa6', 'shell'),
        piece({ kind: 'cylinder', radius: bossRadius, height: rootWidth, axis: 'z' }, [0, 0, 0], COLORS.brass),
        piece({ kind: 'cylinder', radius: bossRadius, height: thickness, axis: 'y' }, [linkX, -thickness, 0], COLORS.brass),
      ];
      return finish({
        id, kind: 'hinged_petal', name: `Hinged petal panel ${mm(length)}×${mm(width)} mm`, category: 'panels',
        description: 'A tapered lightweight panel with alternative folding and iris pivots at its root and optional link mounts underneath.',
        params: p, geometry, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [length + bossRadius, bossRadius + Math.max(1.5 * thickness, bossRadius), width],
        connectors: [
          fx('hinge', [0, 0, 0], [0, 0, -1], 'revolute', 'Tangential root pivot for folding the panel up and down'),
          fx('iris_pivot', [0, 0, 0], [0, -1, 0], 'revolute', 'Vertical root pivot for swinging in the XZ plane'),
          fx('fold_link', [linkX, -thickness, 0], [0, 0, -1], 'revolute', 'Under-panel connecting rod pivot about the folding axis'),
          fx('iris_link', [linkX, -thickness * 1.5, 0], [0, -1, 0], 'revolute', 'Under-panel connecting rod pivot for an iris'),
          fx('tip', [length, 0, 0], [1, 0, 0], 'fixed', 'Tip position for a marker or test target'),
        ],
        cost_usd: 2,
      });
    },
  },
  // ---------- rotational ----------
  shaft: { kind: 'shaft', name: 'Shaft', category: 'shafts', description: 'Round steel shaft along X; revolute ends and mid-point mounts for gears/wheels (fixed, "hub_*").', params: { length: { min: 0.01, max: 0.8, default: 0.06, unit: 'm', description: 'Length' }, radius: { min: 0.001, max: 0.02, default: 0.003, unit: 'm', description: 'Radius' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'x' }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'shaft', name: `Shaft Ø${mm(p.radius * 2)}×${mm(p.length)} mm`, category: 'shafts', description: 'Ground steel shaft.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.length, p.radius * 2, p.radius * 2], material: 'steel', geometry: g, connectors: [fx('end_a', [-p.length / 2, 0, 0], [-1, 0, 0], 'revolute'), fx('end_b', [p.length / 2, 0, 0], [1, 0, 0], 'revolute'), fx('hub_mid', [0, 0, 0], [1, 0, 0], 'fixed', 'press-fit hub at mid length'), fx('hub_a', [-p.length / 4, 0, 0], [1, 0, 0]), fx('hub_b', [p.length / 4, 0, 0], [1, 0, 0])], cost_usd: 1 }); } },
  gear: { kind: 'gear', name: 'Spur gear', category: 'gears', description: 'Spur gear with real teeth; bore (revolute, Z) and hub mount; pitch radius = module×teeth/2.', params: { teeth: { min: 8, max: 120, default: 20, unit: '', description: 'Teeth' }, module: { min: 0.0005, max: 0.004, default: 0.001, unit: 'm', description: 'Module' }, thickness: { min: 0.002, max: 0.03, default: 0.005, unit: 'm', description: 'Face width' } },
    generate: (p, id) => { const r = (p.module * p.teeth) / 2; const g = [piece({ kind: 'extrude', profile: profiles.gear(Math.round(p.teeth), p.module), depth: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.brass)]; return finish({ id, kind: 'gear', name: `Gear ${Math.round(p.teeth)}T m${(p.module * 1000).toFixed(1)}`, category: 'gears', description: `${Math.round(p.teeth)}-tooth spur gear, pitch Ø${mm(r * 2)} mm.`, params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [r * 2, r * 2, p.thickness], material: 'steel', geometry: g, connectors: [fx('bore', [0, 0, 0], [0, 0, 1], 'revolute'), fx('hub', [0, 0, -p.thickness / 2], [0, 0, -1], 'fixed', 'press onto a shaft hub'), fx('face', [0, 0, p.thickness / 2], [0, 0, 1])], cost_usd: 2 + p.teeth * 0.05 }); } },
  bearing: { kind: 'bearing', name: 'Ball bearing', category: 'bearings', description: 'Radial bearing: outer race fixed (outer), inner race revolute (inner, Z).', params: { outerRadius: { min: 0.004, max: 0.05, default: 0.011, unit: 'm', description: 'Outer radius' }, width: { min: 0.002, max: 0.02, default: 0.007, unit: 'm', description: 'Width' } },
    generate: (p, id) => { const g = [piece({ kind: 'revolve', profile: profiles.rim(p.outerRadius, p.outerRadius * 0.45, p.width), axis: 'z', segments: 32 }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'bearing', name: `Bearing Ø${mm(p.outerRadius * 2)} mm`, category: 'bearings', description: 'Shielded radial bearing.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.outerRadius * 2, p.outerRadius * 2, p.width], material: 'steel', geometry: g, connectors: [fx('outer', [0, p.outerRadius, 0], [0, 1, 0]), fx('housing', [0, 0, -p.width / 2], [0, 0, -1]), fx('inner', [0, 0, p.width / 2], [0, 0, 1], 'revolute')], limits: { maxLoad_N: 400 }, cost_usd: 1.5 }); } },
  pillow_block: {
    kind: 'pillow_block', name: 'Pillow block bearing', category: 'bearings',
    description: 'Supports a horizontal rotating shaft. Fix "mount" to a frame and connect a shaft end to "bore_front" or "bore_back" with a revolute joint about Z.',
    params: {
      bore: { min: 0.004, max: 0.02, default: 0.008, unit: 'm', description: 'Shaft diameter' },
      depth: { min: 0.006, max: 0.035, default: 0.012, unit: 'm', description: 'Bearing depth along Z' },
    },
    generate: (p, id) => {
      const boreRadius = p.bore / 2;
      const raceRadius = boreRadius + 0.003;
      const housingRadius = raceRadius + 0.003;
      const baseWidth = housingRadius * 3.2;
      const baseDepth = p.depth * 1.25;
      const baseThickness = 0.004;
      const boreDepth = p.depth + 0.001;
      const geometry = [
        piece({ kind: 'box', size: [baseWidth, baseThickness, baseDepth] }, [0, -housingRadius - baseThickness / 2, 0], COLORS.steel),
        piece({ kind: 'box', size: [housingRadius * 1.6, housingRadius * 0.5, p.depth] }, [0, -housingRadius * 0.75, 0], COLORS.steel),
        piece({ kind: 'revolve', profile: profiles.rim(housingRadius, raceRadius, p.depth), axis: 'z', segments: 32 }, [0, 0, 0], COLORS.steel),
        piece({ kind: 'revolve', profile: profiles.rim(raceRadius, boreRadius, boreDepth), axis: 'z', segments: 32 }, [0, 0, 0], COLORS.brass),
      ];
      return finish({
        id, kind: 'pillow_block', name: `Pillow block bearing Ø${mm(p.bore)} mm`, category: 'bearings',
        description: 'Base-mounted bearing support for a shaft, axle, or rotating transmission.',
        params: p, geometry, material: 'steel', mass_kg: vol(geometry) * DENSITY.steel,
        dimensions_m: [baseWidth, 2 * housingRadius + baseThickness, Math.max(baseDepth, boreDepth)],
        connectors: [
          fx('mount', [0, -housingRadius - baseThickness, 0], [0, -1, 0]),
          fx('bore_front', [0, 0, boreDepth / 2], [0, 0, 1], 'revolute'),
          fx('bore_back', [0, 0, -boreDepth / 2], [0, 0, -1], 'revolute'),
        ],
        cost_usd: 4,
      });
    },
  },
  wheel: { kind: 'wheel', name: 'Wheel', category: 'wheels', description: 'Rubber-tyred wheel; hub is revolute about Z.', params: { radius: { min: 0.01, max: 0.3, default: 0.03, unit: 'm', description: 'Radius' }, width: { min: 0.004, max: 0.08, default: 0.012, unit: 'm', description: 'Width' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.width, axis: 'z' }, [0, 0, 0], COLORS.rubber, 'contact'), piece({ kind: 'cylinder', radius: p.radius * 0.6, height: p.width * 1.05, axis: 'z' }, [0, 0, 0], COLORS.aluminium, 'decor', QUAT_ID, { collide: false })]; return finish({ id, kind: 'wheel', name: `Wheel Ø${mm(p.radius * 2)} mm`, category: 'wheels', description: 'Rubber-tyred wheel.', params: p, mass_kg: Math.PI * p.radius ** 2 * p.width * DENSITY.rubber * 0.6, dimensions_m: [p.radius * 2, p.radius * 2, p.width], material: 'rubber / nylon', geometry: g, connectors: [fx('hub', [0, 0, 0], [0, 0, 1], 'revolute'), fx('hub_fixed', [0, 0, -p.width / 2], [0, 0, -1])], cost_usd: 2 }); } },
  big_wheel: { kind: 'big_wheel', name: 'Spoked wheel', category: 'wheels', description: 'Large spoked wheel (Ferris wheel / waterwheel): hub revolute about Z; N rim mounts "rim_{i}" (axis Z, for gondolas or sails) and "spoke_tip_{i}" (radial).', params: { radius: { min: 0.05, max: 0.7, default: 0.25, unit: 'm', description: 'Radius' }, spokes: { min: 3, max: 16, default: 8, unit: '', description: 'Spokes / rim mounts' }, spokeWidth: { min: 0.003, max: 0.03, default: 0.008, unit: 'm', description: 'Spoke section' } },
    generate: (p, id) => { const n = Math.round(p.spokes); const g: GeometryPiece[] = [piece({ kind: 'revolve', profile: profiles.rim(p.radius, p.radius - p.spokeWidth * 1.5, p.spokeWidth), axis: 'z', segments: 48 }, [0, 0, 0], COLORS.steel), piece({ kind: 'cylinder', radius: p.spokeWidth * 2, height: p.spokeWidth * 2, axis: 'z' }, [0, 0, 0], COLORS.brass)]; const c: Connector[] = [fx('hub', [0, 0, 0], [0, 0, -1], 'revolute'), fx('hub_front', [0, 0, p.spokeWidth], [0, 0, 1], 'revolute')];
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; const cx = Math.cos(a), sy = Math.sin(a); g.push(piece({ kind: 'box', size: [p.radius - p.spokeWidth, p.spokeWidth, p.spokeWidth * 0.6] }, [(cx * p.radius) / 2, (sy * p.radius) / 2, 0], COLORS.steel, 'structure', quatFromAxisAngle([0, 0, 1], a))); c.push(fx(`rim_${i}`, [cx * p.radius, sy * p.radius, p.spokeWidth / 2 + 0.001], [0, 0, 1], 'any', `rim mount ${i}, axis Z`), fx(`spoke_tip_${i}`, [cx * p.radius, sy * p.radius, 0], [cx, sy, 0], 'fixed', `radial mount ${i}`)); }
      return finish({ id, kind: 'big_wheel', name: `Spoked wheel Ø${mm(p.radius * 2)} mm, ${n} spokes`, category: 'wheels', description: 'Welded steel spoked wheel.', params: p, mass_kg: vol(g) * DENSITY.steel * 0.5, dimensions_m: [p.radius * 2, p.radius * 2, p.spokeWidth], material: 'steel', geometry: g, connectors: c, cost_usd: 10 + p.radius * 20 }); } },
  pulley: { kind: 'pulley', name: 'Pulley', category: 'pulleys', description: 'Grooved pulley; bore revolute about Z.', params: { radius: { min: 0.005, max: 0.15, default: 0.015, unit: 'm', description: 'Radius' }, width: { min: 0.004, max: 0.03, default: 0.008, unit: 'm', description: 'Width' } },
    generate: (p, id) => { const g = [piece({ kind: 'revolve', profile: [[0, -p.width / 2], [p.radius, -p.width / 2], [p.radius * 0.85, 0], [p.radius, p.width / 2], [0, p.width / 2]], axis: 'z', segments: 32 }, [0, 0, 0], COLORS.shell)]; return finish({ id, kind: 'pulley', name: `Pulley Ø${mm(p.radius * 2)} mm`, category: 'pulleys', description: 'Nylon V-groove pulley.', params: p, mass_kg: vol(g) * DENSITY.nylon, dimensions_m: [p.radius * 2, p.radius * 2, p.width], material: 'nylon', geometry: g, connectors: [fx('bore', [0, 0, 0], [0, 0, 1], 'revolute'), fx('hub', [0, 0, -p.width / 2], [0, 0, -1])], cost_usd: 1 }); } },
  flywheel: { kind: 'flywheel', name: 'Flywheel', category: 'flywheels', description: 'Heavy steel disc; bore revolute about Z.', params: { radius: { min: 0.01, max: 0.3, default: 0.05, unit: 'm', description: 'Radius' }, thickness: { min: 0.003, max: 0.05, default: 0.01, unit: 'm', description: 'Thickness' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'flywheel', name: `Flywheel Ø${mm(p.radius * 2)} mm`, category: 'flywheels', description: 'Steel flywheel.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.radius * 2, p.radius * 2, p.thickness], material: 'steel', geometry: g, connectors: [fx('bore', [0, 0, 0], [0, 0, 1], 'revolute'), fx('hub', [0, 0, -p.thickness / 2], [0, 0, -1]), fx('rim', [p.radius, 0, 0], [1, 0, 0])], cost_usd: 4 }); } },
  // ---------- motion ----------
  hinge: { kind: 'hinge', name: 'Hinge', category: 'hinges', description: 'Butt hinge: leaf_a fixed (−Y face), leaf_b revolute about the pin (X axis). Mount leaf_a on a frame, then mount the moving part on leaf_b with joint "revolute".', params: { length: { min: 0.01, max: 0.3, default: 0.03, unit: 'm', description: 'Pin length (X)' }, leaf: { min: 0.008, max: 0.08, default: 0.02, unit: 'm', description: 'Leaf width' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.leaf * 0.12, height: p.length, axis: 'x' }, [0, 0, 0], COLORS.steel), piece({ kind: 'box', size: [p.length, p.leaf * 0.06, p.leaf] }, [0, -p.leaf * 0.09, -p.leaf / 2], COLORS.steel), piece({ kind: 'box', size: [p.length, p.leaf * 0.06, p.leaf] }, [0, -p.leaf * 0.09, p.leaf / 2], COLORS.steel)]; return finish({ id, kind: 'hinge', name: `Hinge ${mm(p.length)} mm`, category: 'hinges', description: 'Steel butt hinge.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.length, p.leaf * 0.24, p.leaf * 2], material: 'steel', geometry: g, connectors: [fx('leaf_a', [0, -p.leaf * 0.12, -p.leaf / 2], [0, -1, 0]), fx('leaf_b', [0, 0, p.leaf / 2], [0, 1, 0], 'revolute', 'moving leaf; spins about X pin'), fx('pin', [p.length / 2, 0, 0], [1, 0, 0], 'revolute')], cost_usd: 0.8 }); } },
  slider: { kind: 'slider', name: 'Linear slider', category: 'sliders', description: 'Rail (fixed, "rail") with a carriage that slides along X ("carriage": prismatic, travel = length). Mount loads on carriage_top.', params: { length: { min: 0.02, max: 0.6, default: 0.1, unit: 'm', description: 'Rail length / travel' }, width: { min: 0.005, max: 0.05, default: 0.015, unit: 'm', description: 'Rail width' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.length, p.width * 0.4, p.width] }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'slider', name: `Slider rail ${mm(p.length)} mm`, category: 'sliders', description: 'Linear rail; the carriage is a separate part mounted with a prismatic joint.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.length, p.width * 0.4, p.width], material: 'steel', geometry: g, connectors: [fx('rail', [0, -p.width * 0.2, 0], [0, -1, 0]), fx('carriage', [-p.length / 2 + p.width, p.width * 0.2, 0], [1, 0, 0], 'prismatic', 'carriage slides along +X'), fx('end_a', [-p.length / 2, 0, 0], [-1, 0, 0]), fx('end_b', [p.length / 2, 0, 0], [1, 0, 0])], limits: { travel_m: p.length - 2 * p.width }, cost_usd: 6 }); } },
  carriage: { kind: 'carriage', name: 'Slider carriage', category: 'sliders', description: 'Block that rides a slider rail (mount via "rail_face" onto slider.carriage with joint prismatic); loads go on "top".', params: { size: { min: 0.008, max: 0.08, default: 0.02, unit: 'm', description: 'Block size' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.size, p.size * 0.5, p.size * 1.2] }, [0, 0, 0], COLORS.aluminium)]; return finish({ id, kind: 'carriage', name: `Carriage ${mm(p.size)} mm`, category: 'sliders', description: 'Aluminium carriage block.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.size, p.size * 0.5, p.size * 1.2], material: 'aluminium', geometry: g, connectors: [fx('rail_face', [-p.size / 2, 0, 0], [-1, 0, 0], 'prismatic'), fx('top', [0, p.size * 0.25, 0], [0, 1, 0]), fx('front', [p.size / 2, 0, 0], [1, 0, 0])], cost_usd: 3 }); } },
  link: { kind: 'link', name: 'Linkage bar', category: 'linkages', description: 'Flat link with revolute pivots at both ends (Z axis) and a fixed mid mount; length is pivot-to-pivot along X.', params: { length: { min: 0.01, max: 0.6, default: 0.06, unit: 'm', description: 'Pivot spacing' }, width: { min: 0.004, max: 0.04, default: 0.012, unit: 'm', description: 'Width (Y)' }, thickness: { min: 0.002, max: 0.02, default: 0.004, unit: 'm', description: 'Thickness (Z)' } },
    generate: (p, id) => { const g = [piece({ kind: 'extrude', profile: profiles.roundedRect(p.length + p.width, p.width, p.width / 2), depth: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.titanium)]; return finish({ id, kind: 'link', name: `Link ${mm(p.length)} mm`, category: 'linkages', description: 'Aluminium linkage bar.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.length + p.width, p.width, p.thickness], material: 'aluminium', geometry: g, connectors: [fx('pivot_a', [-p.length / 2, 0, p.thickness / 2], [0, 0, 1], 'revolute'), fx('pivot_b', [p.length / 2, 0, p.thickness / 2], [0, 0, 1], 'revolute'), fx('pivot_a_back', [-p.length / 2, 0, -p.thickness / 2], [0, 0, -1], 'revolute'), fx('pivot_b_back', [p.length / 2, 0, -p.thickness / 2], [0, 0, -1], 'revolute'), fx('mid', [0, p.width / 2, 0], [0, 1, 0])], cost_usd: 1.2 }); } },
  adjustable_link: {
    kind: 'adjustable_link', name: 'Adjustable linkage plate', category: 'linkages',
    description: 'Five selectable pin holes for changing lever arms or linking several outputs. Holes are numbered from 1 to 5 along +X. Each "pin_n" faces +Z and has a matching "pin_n_back".',
    params: {
      span: { min: 0.04, max: 0.25, default: 0.06, unit: 'm', description: 'Distance between outermost pins' },
      thickness: { min: 0.002, max: 0.016, default: 0.004, unit: 'm', description: 'Plate thickness along Z' },
    },
    generate: (p, id) => {
      const pitch = p.span / 4;
      const outerRadius = Math.min(pitch * 0.4, 0.012);
      const holeRadius = outerRadius * 0.45;
      const geometry: GeometryPiece[] = [];
      const connectors: Connector[] = [];
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * pitch;
        geometry.push(piece({ kind: 'revolve', profile: profiles.rim(outerRadius, holeRadius, p.thickness), axis: 'z', segments: 24 }, [x, 0, 0], COLORS.aluminium));
        if (i < 4) {
          geometry.push(piece({ kind: 'box', size: [pitch - outerRadius, outerRadius, p.thickness] }, [x + pitch / 2, 0, 0], COLORS.aluminium));
        }
        connectors.push(
          fx(`pin_${i + 1}`, [x, 0, p.thickness / 2], [0, 0, 1], 'revolute'),
          fx(`pin_${i + 1}_back`, [x, 0, -p.thickness / 2], [0, 0, -1], 'revolute'),
        );
      }
      return finish({
        id, kind: 'adjustable_link', name: `Adjustable linkage plate ${mm(p.span)} mm`, category: 'linkages',
        description: `Five evenly spaced pivots at ${mm(pitch)} mm pitch for adjusting stroke or leverage.`,
        params: p, geometry, material: 'aluminium', mass_kg: vol(geometry) * DENSITY.aluminium,
        dimensions_m: [p.span + 2 * outerRadius, 2 * outerRadius, p.thickness], connectors, cost_usd: 3,
      });
    },
  },
  leg_segment: { kind: 'leg_segment', name: 'Leg segment', category: 'legs', description: 'Leg bar: revolute pivot at the top (Z axis), fixed tip at the bottom (−Y). Length runs down −Y from the pivot.', params: { length: { min: 0.01, max: 0.4, default: 0.06, unit: 'm', description: 'Pivot-to-tip' }, width: { min: 0.003, max: 0.04, default: 0.012, unit: 'm', description: 'Bar width (X)' }, thickness: { min: 0.002, max: 0.02, default: 0.004, unit: 'm', description: 'Thickness (Z)' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.width, p.length, p.thickness] }, [0, -p.length / 2, 0], COLORS.titanium), piece({ kind: 'cylinder', radius: p.width * 0.7, height: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'leg_segment', name: `Leg bar ${mm(p.length)} mm`, category: 'legs', description: 'Aluminium leg bar.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.width, p.length, p.thickness], material: 'aluminium', geometry: g, connectors: [fx('pivot', [0, 0, -p.thickness / 2], [0, 0, -1], 'revolute', 'top pivot; mount onto a servo horn'), fx('pivot_front', [0, 0, p.thickness / 2], [0, 0, 1], 'revolute'), fx('tip', [0, -p.length, 0], [0, -1, 0]), fx('tip_side', [0, -p.length + p.width / 2, p.thickness / 2], [0, 0, 1])], cost_usd: 1.2 }); } },
  crank: { kind: 'crank', name: 'Crank arm', category: 'cranks', description: 'Crank: "shaft" bore (revolute Z) at origin and "pin" (revolute Z) at radius `throw` along +X for a connecting rod.', params: { throw: { min: 0.005, max: 0.3, default: 0.03, unit: 'm', description: 'Crank radius' }, width: { min: 0.004, max: 0.04, default: 0.012, unit: 'm', description: 'Arm width' }, thickness: { min: 0.002, max: 0.02, default: 0.005, unit: 'm', description: 'Thickness' } },
    generate: (p, id) => { const g = [piece({ kind: 'extrude', profile: profiles.roundedRect(p.throw + p.width, p.width, p.width / 2), depth: p.thickness, axis: 'z' }, [p.throw / 2, 0, 0], COLORS.steel), piece({ kind: 'cylinder', radius: p.width * 0.3, height: p.thickness * 2, axis: 'z' }, [p.throw, 0, p.thickness], COLORS.brass)]; return finish({ id, kind: 'crank', name: `Crank ${mm(p.throw)} mm throw`, category: 'cranks', description: 'Steel crank arm with pin.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.throw + p.width, p.width, p.thickness * 3], material: 'steel', geometry: g, connectors: [fx('shaft', [0, 0, -p.thickness / 2], [0, 0, -1], 'revolute', 'mount onto a motor shaft or axle'), fx('pin', [p.throw, 0, p.thickness * 2], [0, 0, 1], 'revolute', 'crank pin for a connecting rod')], cost_usd: 2 }); } },
  geneva_wheel: {
    kind: 'geneva_wheel', name: 'Four-slot Geneva index wheel', category: 'linkages',
    description: 'Passive four-stop Geneva wheel. A matching offset pin enters its open slots to index it by a quarter turn. Put the driver centre on +X, rotate this wheel +45° around Z at rest, and mount output_axis on a passive Z pivot. For a horizontal turntable, use wheel rotation_deg [-90,45,0] and driver [-90,0,0]. Use table for a fixed output.',
    params: GENEVA_PARAMS,
    generate: (p, id) => {
      const { centreDistance, pinRadius, clearance, thickness } = p;
      const { crankRadius, halfSlot, recessRadius } = genevaDimensions(centreDistance, pinRadius, clearance);
      const hubRadius = centreDistance - crankRadius - pinRadius - clearance;
      const geometry = [piece({ kind: 'cylinder', radius: hubRadius, height: thickness, axis: 'z' }, [0, 0, 0], '#52748b')];
      const start = Math.asin(halfSlot / crankRadius);
      const samples = 16;
      const edges = Array.from({ length: samples + 1 }, (_, index) => {
        const angle = start + index / samples * (Math.PI / 2 - 2 * start);
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        const alongRay = crankRadius * (x + y);
        const discriminant = alongRay ** 2 - centreDistance ** 2 + recessRadius ** 2;
        const outer = discriminant > 0 ? Math.min(crankRadius, alongRay - Math.sqrt(discriminant)) : crankRadius;
        const inner = halfSlot / Math.min(x, y);
        return { inner: [x * inner, y * inner] as Vec2, outer: [x * outer, y * outer] as Vec2 };
      });
      // Keep the slot channels and locking recesses physically open. Rapier takes a convex
      // hull per piece, so each narrow material strip gets its own collider.
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const rotation = quatFromAxisAngle([0, 0, 1], quadrant * Math.PI / 2);
        for (let index = 0; index < samples; index++) {
          const a = edges[index];
          const b = edges[index + 1];
          const profile = [a.inner, a.outer, b.outer, b.inner].filter((point, i, points) =>
            i === 0 || Math.hypot(point[0] - points[i - 1][0], point[1] - points[i - 1][1]) > 1e-8);
          if (profile.length >= 3) geometry.push(piece({ kind: 'extrude', profile: ensureCCW(profile), depth: thickness, axis: 'z' }, [0, 0, 0], '#52748b', 'structure', rotation));
        }
      }
      geometry.push(piece({ kind: 'cylinder', radius: hubRadius * 0.53, height: thickness * 0.32, axis: 'z' }, [0, 0, thickness * 0.66], COLORS.brass));
      return finish({
        id, kind: 'geneva_wheel', name: `Four-slot Geneva wheel ${mm(centreDistance)} mm spacing`, category: 'linkages',
        description: 'Four physical slots accept the matching driver pin. Recesses between the slots receive its dwell sector.',
        params: p, geometry, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [crankRadius * 2, crankRadius * 2, thickness * 1.32],
        connectors: [
          fx('output_axis', [0, 0, -thickness / 2], [0, 0, -1], 'revolute', 'Passive output shaft about Z'),
          fx('table', [0, 0, thickness * 0.82], [0, 0, 1], 'fixed', 'Output tray or marker mount'),
        ],
        cost_usd: 8,
      });
    },
  },
  geneva_crank: {
    kind: 'geneva_crank', name: 'Geneva pin crank', category: 'cranks',
    description: 'Powered Geneva driver with one physical offset pin and a relieved dwell sector. At rest the pin points +X; place its centre to the right of the matching wheel and one thickness behind it along Z (one thickness below the wheel for horizontal mounting). Power only the drive pivot.',
    params: GENEVA_PARAMS,
    generate: (p, id) => {
      const { centreDistance, pinRadius, clearance, thickness } = p;
      const { crankRadius, lockRadius } = genevaDimensions(centreDistance, pinRadius, clearance);
      const plateRadius = crankRadius + pinRadius * 1.5;
      const relief = 40 * Math.PI / 180;
      const geometry = [
        piece({ kind: 'cylinder', radius: plateRadius, height: thickness * 0.7, axis: 'z' }, [0, 0, 0], '#354e64'),
        piece({ kind: 'cylinder', radius: pinRadius, height: thickness * 1.25, axis: 'z' }, [crankRadius, 0, thickness * 0.9], COLORS.orange, 'contact', QUAT_ID, { friction: 0.35 }),
      ];
      // The dwell sector wraps more than 180 degrees. Split it into convex halves so the
      // contact hulls preserve the relief around the pin through the indexing phase.
      for (const [start, end] of [[relief, Math.PI], [Math.PI, 2 * Math.PI - relief]]) {
        const profile: Profile = [[0, 0]];
        for (let index = 0; index <= 24; index++) {
          const angle = start + index / 24 * (end - start);
          profile.push([lockRadius * Math.cos(angle), lockRadius * Math.sin(angle)]);
        }
        geometry.push(piece({ kind: 'extrude', profile, depth: thickness, axis: 'z' }, [0, 0, thickness], COLORS.brass, 'contact', QUAT_ID, { friction: 0.35 }));
      }
      geometry.push(piece({ kind: 'cylinder', radius: pinRadius * 1.2, height: thickness, axis: 'z' }, [0, 0, thickness * 0.7], '#354e64'));
      return finish({
        id, kind: 'geneva_crank', name: `Geneva pin crank ${mm(centreDistance)} mm spacing`, category: 'cranks',
        description: 'The orange pin indexes the wheel through contact. The relieved bronze sector holds the wheel between steps.',
        params: p, geometry, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [plateRadius * 2, plateRadius * 2, thickness * 1.875],
        connectors: [fx('drive', [0, 0, -thickness * 0.35], [0, 0, -1], 'revolute', 'Powered input shaft about Z')],
        cost_usd: 6,
      });
    },
  },
  eccentric_disc: {
    kind: 'eccentric_disc', name: 'Eccentric drive disc', category: 'cranks',
    description: 'Round crank with a rear "shaft" bore, fixed front "hub" for a shaft extension, and an offset front "pin" to drive a connecting rod. Both pivots rotate about Z.',
    params: {
      radius: { min: 0.012, max: 0.12, default: 0.02, unit: 'm', description: 'Disc radius' },
      throw: { min: 0.004, max: 0.1, default: 0.01, unit: 'm', description: 'Shaft-to-pin distance' },
      thickness: { min: 0.003, max: 0.02, default: 0.006, unit: 'm', description: 'Disc thickness' },
    },
    generate: (p, id) => {
      const pinRadius = Math.min(p.thickness / 2, p.radius * 0.15);
      const boreRadius = p.radius * 0.18;
      if (p.throw + pinRadius > p.radius || p.throw - pinRadius < boreRadius) {
        throw new ParamError('Eccentric disc pin must sit on the disc between the shaft bore and rim.');
      }
      const disc = piece({ kind: 'revolve', profile: profiles.rim(p.radius, boreRadius, p.thickness), axis: 'z', segments: 32 }, [0, 0, 0], COLORS.steel);
      const pin = piece({ kind: 'cylinder', radius: pinRadius, height: p.thickness, axis: 'z' }, [p.throw, 0, p.thickness], COLORS.brass);
      return finish({
        id, kind: 'eccentric_disc', name: `Eccentric drive disc Ø${mm(p.radius * 2)} mm`, category: 'cranks',
        description: `Converts shaft rotation into reciprocating motion through a connecting rod. The pin sits ${mm(p.throw)} mm from the shaft.`,
        params: p, mass_kg: vol([disc, pin]) * DENSITY.steel, dimensions_m: [p.radius * 2, p.radius * 2, p.thickness * 2],
        material: 'steel', geometry: [disc, pin],
        connectors: [
          fx('shaft', [0, 0, -p.thickness / 2], [0, 0, -1], 'revolute', 'mount to a motor or axle'),
          fx('hub', [0, 0, p.thickness / 2], [0, 0, 1], 'fixed', 'coaxial mount for a shaft extension'),
          fx('pin', [p.throw, 0, p.thickness * 1.5], [0, 0, 1], 'revolute', 'offset pin for a connecting rod'),
        ],
        cost_usd: 3,
      });
    },
  },
  eccentric_cam: {
    kind: 'eccentric_cam', name: 'Eccentric contact cam', category: 'cranks',
    description: 'A colliding eccentric lobe lifts a separate flat-foot follower without a joint between the two. Axis Z, lobe toward +X; use "shaft" for a fixed axle connection or "drive" for a revolute drive.',
    params: {
      coreRadius: { min: 0.012, max: 0.09, default: 0.037, unit: 'm', description: 'Concentric dwell radius' },
      lobeRadius: { min: 0.006, max: 0.07, default: 0.025, unit: 'm', description: 'Radius of the raised lobe' },
      eccentricity: { min: 0.004, max: 0.075, default: 0.031, unit: 'm', description: 'Offset of the lobe centre from the shaft' },
      thickness: { min: 0.003, max: 0.03, default: 0.014, unit: 'm', description: 'Thickness along Z' },
    },
    generate: (p, id) => {
      const { coreRadius, lobeRadius, eccentricity, thickness } = p;
      const lift = eccentricity + lobeRadius - coreRadius;
      if (lift <= 0 || lobeRadius - eccentricity >= coreRadius || eccentricity >= coreRadius + lobeRadius) {
        throw new ParamError('Cam lobe must overlap the core and protrude on one side while leaving a dwell region.');
      }
      const geometry = [
        piece({ kind: 'cylinder', radius: coreRadius, height: thickness, axis: 'z' }, [0, 0, 0], '#586c84'),
        piece({ kind: 'cylinder', radius: lobeRadius, height: thickness, axis: 'z' }, [eccentricity, 0, 0], COLORS.orange),
      ];
      return finish({
        id, kind: 'eccentric_cam', name: `Eccentric contact cam Ø${mm(coreRadius * 2)} mm`, category: 'cranks',
        description: `Lifts a passive follower by up to ${mm(lift)} mm from the core dwell radius through direct contact. Rotate about Z to set the phase.`,
        params: p, geometry, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [coreRadius * 2 + lift, 2 * Math.max(coreRadius, lobeRadius), thickness],
        connectors: [
          fx('shaft', [0, 0, -thickness / 2], [0, 0, -1], 'fixed', 'rear coaxial axle mount'),
          fx('drive', [0, 0, -thickness / 2], [0, 0, -1], 'revolute', 'rear driven pivot'),
          fx('shaft_front', [0, 0, thickness / 2], [0, 0, 1], 'fixed', 'front coaxial axle mount'),
        ],
        cost_usd: 3,
      });
    },
  },
  cam_follower: {
    kind: 'cam_follower', name: 'Flat-foot cam follower', category: 'sliders',
    description: 'A flat contact shoe centered at the origin with a stem along +Y. Mount "slide" onto a fixed follower guide with a passive prismatic joint; attach a payload to "mount". Gravity or a return spring keeps the shoe against the cam.',
    params: {
      shoeLength: { min: 0.026, max: 0.18, default: 0.098, unit: 'm', description: 'Shoe length along X' },
      shoeWidth: { min: 0.008, max: 0.045, default: 0.019, unit: 'm', description: 'Shoe width along Z' },
      shoeThickness: { min: 0.003, max: 0.02, default: 0.01, unit: 'm', description: 'Shoe thickness along Y' },
      stemSize: { min: 0.004, max: 0.02, default: 0.009, unit: 'm', description: 'Width of the square stem' },
      stemLength: { min: 0.025, max: 0.15, default: 0.057, unit: 'm', description: 'Stem length above the shoe, along Y' },
    },
    generate: (p, id) => {
      const { shoeLength, shoeWidth, shoeThickness, stemSize, stemLength } = p;
      if (stemSize > shoeWidth) throw new ParamError('Follower stem must fit on the shoe.');
      const stemCenter = (shoeThickness + stemLength) / 2;
      const geometry = [
        piece({ kind: 'box', size: [shoeLength, shoeThickness, shoeWidth] }, [0, 0, 0], '#344661'),
        piece({ kind: 'box', size: [stemSize, stemLength, stemSize] }, [0, stemCenter, 0], '#586c84', 'structure', undefined, { collide: false }),
      ];
      return finish({
        id, kind: 'cam_follower', name: `Flat-foot cam follower ${mm(shoeLength)} mm`, category: 'sliders',
        description: 'The lower shoe makes cam contact while the prismatic joint guides the stem. A flag, plunger, or other payload mounts at the top.',
        params: p, geometry, material: 'nylon', mass_kg: vol(geometry) * DENSITY.nylon,
        dimensions_m: [shoeLength, shoeThickness + stemLength, shoeWidth],
        connectors: [
          fx('slide', [0, stemCenter, 0], [0, -1, 0], 'prismatic', 'mates with follower_guide.guide'),
          fx('mount', [0, shoeThickness / 2 + stemLength, 0], [0, 1, 0], 'fixed', 'payload mount at the stem tip'),
        ],
        cost_usd: 2,
      });
    },
  },
  follower_guide: {
    kind: 'follower_guide', name: 'Cam follower guide', category: 'sliders',
    description: 'Fixed offset bracket with a hollow vertical bushing. Connect "guide" to a cam follower’s "slide" with a prismatic joint to constrain motion along local Y.',
    params: {
      stemSize: { min: 0.004, max: 0.02, default: 0.009, unit: 'm', description: 'Matching square follower stem width' },
      reach: { min: 0.025, max: 0.12, default: 0.063, unit: 'm', description: 'Distance from support mount to slide axis along X' },
    },
    generate: (p, id) => {
      const sleeveInner = Math.SQRT1_2 * p.stemSize + 0.0004;
      const sleeveOuter = sleeveInner + 0.002;
      const sleeveHeight = 0.014;
      // The prismatic joint represents the sliding bearing. Its housing must not snag the stem.
      const geometry = [
        piece({ kind: 'box', size: [p.reach + 0.001, 0.009, 0.011] }, [-(p.reach - 0.001) / 2, 0.004, -0.017], '#586c84', 'structure', undefined, { collide: false }),
        piece({ kind: 'box', size: [0.013, 0.009, 0.014] }, [0, 0.004, -sleeveInner - 0.006], '#586c84', 'structure', undefined, { collide: false }),
        piece({ kind: 'revolve', profile: profiles.rim(sleeveOuter, sleeveInner, sleeveHeight), axis: 'y', segments: 24 }, [0, 0.004, 0], '#899ab0', 'structure', undefined, { collide: false }),
      ];
      return finish({
        id, kind: 'follower_guide', name: `Cam follower guide ${mm(p.stemSize)} mm`, category: 'sliders',
        description: 'A fixed bracket for a passive cam follower. The hollow bushing shows the path enforced by the prismatic joint.',
        params: p, geometry, material: 'aluminium', mass_kg: vol(geometry) * DENSITY.aluminium,
        dimensions_m: [p.reach + Math.max(0.0065, sleeveOuter), sleeveHeight, Math.max(0.0225, sleeveInner + 0.013) + sleeveOuter],
        connectors: [
          fx('mount', [-p.reach, 0.004, -0.017], [-1, 0, 0]),
          fx('guide', [0, 0, 0], [0, 1, 0], 'prismatic', 'vertical slide axis; attach the follower here'),
        ],
        cost_usd: 3,
      });
    },
  },
  camera_cradle: {
    kind: 'camera_cradle', name: 'Suspended camera cradle', category: 'joints',
    description: 'Open camera platform under a Z-axis pivot. The deck has a fixed camera mount above and a fixed ballast mount below.',
    params: {
      length: { min: 0.025, max: 0.2, default: 0.04, unit: 'm', description: 'Deck length along X' },
      width: { min: 0.025, max: 0.2, default: 0.048, unit: 'm', description: 'Width across the pivot cheeks along Z' },
      drop: { min: 0.012, max: 0.1, default: 0.018, unit: 'm', description: 'Distance from the pivot down to the deck top' },
      thickness: { min: 0.002, max: 0.008, default: 0.003, unit: 'm', description: 'Deck and cheek thickness' },
    },
    generate: (p, id) => {
      const { length, width, drop, thickness } = p;
      const cheekZ = (width - thickness) / 2;
      const cheekHeight = drop + thickness;
      const cheekY = (thickness - drop) / 2;
      const cheekSize: Vec3 = [length * 0.4, cheekHeight, thickness];
      const geometry = [
        piece({ kind: 'box', size: [length, thickness, width] }, [0, -drop - thickness / 2, 0], COLORS.aluminium),
        piece({ kind: 'box', size: cheekSize }, [0, cheekY, cheekZ], '#304962'),
        piece({ kind: 'box', size: cheekSize }, [0, cheekY, -cheekZ], '#304962'),
      ];
      return finish({
        id, kind: 'camera_cradle', name: `Suspended camera cradle ${mm(width)} mm`, category: 'joints',
        description: 'Two pivot cheeks support a deck below the shaft. Secure a camera above the deck and ballast below it.',
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium, dimensions_m: [length, drop + 2 * thickness, width],
        material: 'aluminium', geometry, connectors: [
          fx('pivot_front', [0, 0, width / 2], [0, 0, 1], 'revolute', 'Pivot about Z'),
          fx('pivot_back', [0, 0, -width / 2], [0, 0, -1], 'revolute', 'Pivot about Z'),
          fx('camera', [0, -drop, 0], [0, 1, 0], 'fixed', 'Mount the camera or test payload above the deck'),
          fx('ballast', [0, -drop - thickness, 0], [0, -1, 0], 'fixed', 'Mount a counterweight under the deck'),
        ], cost_usd: 4,
      });
    },
  },
  gimbal_frame: {
    kind: 'gimbal_frame', name: 'Open gimbal frame', category: 'joints',
    description: 'Open horizontal frame with outer pivots along X and inward pivots along Z. Nest a smaller frame on the perpendicular axis for a two-axis gimbal.',
    params: {
      opening: { min: 0.025, max: 0.3, default: 0.084, unit: 'm', description: 'Clear width of the square opening' },
      rim: { min: 0.004, max: 0.02, default: 0.008, unit: 'm', description: 'Rail width' },
      thickness: { min: 0.004, max: 0.025, default: 0.01, unit: 'm', description: 'Frame thickness along Y' },
    },
    generate: (p, id) => {
      const { opening, rim, thickness } = p;
      const span = opening + 2 * rim;
      const railCenter = (opening + rim) / 2;
      const geometry = [
        piece({ kind: 'box', size: [rim, thickness, span] }, [-railCenter, 0, 0], '#304962'),
        piece({ kind: 'box', size: [rim, thickness, span] }, [railCenter, 0, 0], '#304962'),
        piece({ kind: 'box', size: [opening, thickness, rim] }, [0, 0, railCenter], COLORS.aluminium),
        piece({ kind: 'box', size: [opening, thickness, rim] }, [0, 0, -railCenter], COLORS.aluminium),
      ];
      return finish({
        id, kind: 'gimbal_frame', name: `Open gimbal frame ${mm(span)} mm`, category: 'joints',
        description: `Aluminium frame with a ${mm(opening)} mm clear opening and perpendicular bearing axes.`,
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium, dimensions_m: [span, thickness, span],
        material: 'aluminium', geometry, connectors: [
          fx('outer_left', [-span / 2, 0, 0], [-1, 0, 0], 'revolute', 'Outer pivot along X'),
          fx('outer_right', [span / 2, 0, 0], [1, 0, 0], 'revolute', 'Outer pivot along X'),
          fx('inner_front', [0, 0, opening / 2], [0, 0, -1], 'revolute', 'Inward pivot along Z'),
          fx('inner_back', [0, 0, -opening / 2], [0, 0, 1], 'revolute', 'Inward pivot along Z'),
          fx('top', [0, thickness / 2, railCenter], [0, 1, 0]),
          fx('bottom', [0, -thickness / 2, railCenter], [0, -1, 0]),
        ], cost_usd: 4,
      });
    },
  },
  clevis: {
    kind: 'clevis', name: 'Forked clevis', category: 'joints',
    description: 'Forked bracket with a fixed bottom "mount" and a revolute crosswise "pin" along Z, for a rod or linkage.',
    params: {
      gap: { min: 0.006, max: 0.05, default: 0.012, unit: 'm', description: 'Inside width of the fork' },
      rise: { min: 0.01, max: 0.08, default: 0.016, unit: 'm', description: 'Height of pin above base centre' },
      wall: { min: 0.002, max: 0.008, default: 0.003, unit: 'm', description: 'Thickness of each cheek and base' },
    },
    generate: (p, id) => {
      const width = p.wall * 3;
      const depth = p.gap + 2 * p.wall;
      const geometry = [
        piece({ kind: 'box', size: [width, p.wall, depth] }, [0, 0, 0], COLORS.aluminium),
        ...[-1, 1].map((side) => piece({ kind: 'box', size: [width, p.rise, p.wall] }, [0, (p.wall + p.rise) / 2, side * (p.gap + p.wall) / 2], COLORS.aluminium)),
        piece({ kind: 'cylinder', radius: p.wall / 2, height: p.gap, axis: 'z' }, [0, p.rise, 0], COLORS.brass),
      ];
      return finish({
        id, kind: 'clevis', name: `Forked clevis ${mm(p.gap)} mm gap`, category: 'joints',
        description: `Holds a rod or linkage between two cheeks on a single cross pin. The fork has ${mm(p.gap)} mm of inside clearance.`,
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium, dimensions_m: [width, p.rise + p.wall, depth],
        material: 'aluminium', geometry,
        connectors: [
          fx('mount', [0, -p.wall / 2, 0], [0, -1, 0]),
          fx('pin', [0, p.rise, 0], [0, 0, 1], 'revolute', 'pin centre inside the fork'),
        ],
        cost_usd: 2,
      });
    },
  },
  bell_crank: {
    kind: 'bell_crank', name: 'Bell crank', category: 'linkages',
    description: 'Right-angle lever with a rear centre "pivot", an "input" along +X, and an "output" along +Y. All three joints rotate about Z.',
    params: {
      input: { min: 0.01, max: 0.2, default: 0.03, unit: 'm', description: 'Input arm pivot-to-pin length' },
      output: { min: 0.01, max: 0.2, default: 0.04, unit: 'm', description: 'Output arm pivot-to-pin length' },
      width: { min: 0.004, max: 0.024, default: 0.01, unit: 'm', description: 'Arm width' },
      thickness: { min: 0.002, max: 0.02, default: 0.004, unit: 'm', description: 'Plate thickness' },
    },
    generate: (p, id) => {
      const geometry = [
        piece({ kind: 'box', size: [p.input + p.width, p.width, p.thickness] }, [p.input / 2, 0, 0], COLORS.orange),
        piece({ kind: 'box', size: [p.width, p.output, p.thickness] }, [0, (p.width + p.output) / 2, 0], COLORS.orange),
      ];
      return finish({
        id, kind: 'bell_crank', name: `Bell crank ${mm(p.input)}×${mm(p.output)} mm`, category: 'linkages',
        description: 'Redirects motion through a right angle. Different arm lengths change the travel and leverage.',
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium, dimensions_m: [p.input + p.width, p.output + p.width, p.thickness],
        material: 'aluminium', geometry,
        connectors: [
          fx('pivot', [0, 0, -p.thickness / 2], [0, 0, -1], 'revolute', 'central support pivot'),
          fx('input', [p.input, 0, p.thickness / 2], [0, 0, 1], 'revolute', 'input link pin'),
          fx('output', [0, p.output, p.thickness / 2], [0, 0, 1], 'revolute', 'output link pin'),
        ],
        cost_usd: 2.5,
      });
    },
  },
  piston: { kind: 'piston', name: 'Piston in cylinder', category: 'pistons', description: 'Cylinder body (fixed "base") with a piston rod that slides along +X ("rod": prismatic, travel = stroke); rod end has a revolute "rod_end" (Z) for a connecting rod.', params: { bore: { min: 0.005, max: 0.08, default: 0.02, unit: 'm', description: 'Bore diameter' }, stroke: { min: 0.01, max: 0.3, default: 0.05, unit: 'm', description: 'Stroke' } },
    generate: (p, id) => { const L = p.stroke * 1.3; const g = [piece({ kind: 'cylinder', radius: p.bore / 2 + 0.002, height: L, axis: 'x' }, [0, 0, 0], COLORS.aluminium)]; return finish({ id, kind: 'piston', name: `Cylinder Ø${mm(p.bore)} stroke ${mm(p.stroke)} mm`, category: 'pistons', description: 'Pneumatic-style cylinder body; use with a rod part mounted prismatically.', params: p, mass_kg: vol(g) * DENSITY.aluminium * 0.5, dimensions_m: [L, p.bore + 0.004, p.bore + 0.004], material: 'aluminium', geometry: g, connectors: [fx('base', [-L / 2, 0, 0], [-1, 0, 0]), fx('mount', [0, -(p.bore / 2 + 0.002), 0], [0, -1, 0]), fx('rod', [L / 2, 0, 0], [1, 0, 0], 'prismatic', 'rod slides along +X')], limits: { travel_m: p.stroke, maxForce_N: 50 }, cost_usd: 8 }); } },
  // ---------- actuation ----------
  servo_motor: { kind: 'servo_motor', name: 'Servo motor', category: 'motors', description: 'Hobby servo: case with mounts ("mount" back face −Z, "side", "bottom"); output "horn" is a revolute joint about +Z. Positions are driven by a position drive.', params: { size: { min: 0.012, max: 0.08, default: 0.023, unit: 'm', description: 'Case length' }, torque: { min: 0.1, max: 12, default: 1.5, unit: 'N·m', description: 'Stall torque' }, speed: { min: 1, max: 30, default: 8, unit: 'rad/s', description: 'No-load speed' } },
    generate: (p, id) => { const L = p.size, H = p.size * 0.9, D = p.size * 0.55; const mass = 0.009 + p.torque * 0.02; const g = [piece({ kind: 'box', size: [L, H, D] }, [0, 0, 0], COLORS.motor, 'motor'), piece({ kind: 'cylinder', radius: L * 0.16, height: D * 0.4, axis: 'z' }, [0, 0, D / 2 + D * 0.2], COLORS.brass, 'motor')]; return finish({ id, kind: 'servo_motor', name: `Servo ${p.torque.toFixed(1)} N·m`, category: 'motors', description: `${p.torque.toFixed(1)} N·m, ${p.speed.toFixed(0)} rad/s hobby servo.`, params: p, mass_kg: mass, dimensions_m: [L, H, D], material: 'nylon case, metal gears', geometry: g, connectors: [fx('mount', [0, 0, -D / 2], [0, 0, -1]), fx('horn', [0, 0, D / 2 + D * 0.4], [0, 0, 1], 'revolute', 'output horn, spins about +Z'), fx('bottom', [0, -H / 2, 0], [0, -1, 0]), fx('side', [L / 2, 0, 0], [1, 0, 0]), fx('top', [0, H / 2, 0], [0, 1, 0])], limits: { maxTorque_Nm: p.torque, maxSpeed_rad_s: p.speed }, cost_usd: 4 + p.torque * 6 }); } },
  geared_rotary_actuator: {
    kind: 'geared_rotary_actuator', name: 'Geared rotary actuator', category: 'actuators',
    description: 'High-torque, low-speed position actuator for loaded pivots. Fixed "mount" (back −Z), "bottom", "side" and "top"; revolute output "horn" (+Z). Housing and mass grow with simulated torque rating.',
    params: {
      torque: { min: 12, max: 50, default: 20, unit: 'N·m', description: 'Output torque limit used in simulation' },
      speed: { min: 0.25, max: 2.5, default: 1.5, unit: 'rad/s', description: 'Nominal speed for sizing position ramps' },
    },
    generate: (p, id) => {
      const scale = Math.cbrt(p.torque / 20);
      const length = .1 * scale, height = .08 * scale, depth = .065 * scale;
      const flangeDepth = .014 * scale, hornDepth = .016 * scale;
      const front = depth / 2;
      const geometry = [
        piece({ kind: 'box', size: [length, height, depth] }, [0, 0, 0], COLORS.motor, 'motor'),
        piece({ kind: 'cylinder', radius: .031 * scale, height: flangeDepth, axis: 'z' }, [0, 0, front + flangeDepth / 2], COLORS.steel, 'motor'),
        piece({ kind: 'cylinder', radius: .018 * scale, height: hornDepth, axis: 'z' }, [0, 0, front + flangeDepth + hornDepth / 2], COLORS.brass, 'motor'),
      ];
      return finish({
        id, kind: 'geared_rotary_actuator', name: `Geared rotary actuator ${p.torque} N·m`, category: 'actuators',
        description: `Position actuator with a ${p.torque} N·m simulation torque limit and a nominal ${p.speed} rad/s output.`,
        params: p, mass_kg: .028 * p.torque, dimensions_m: [length, height, depth + flangeDepth + hornDepth],
        material: 'aluminium housing, steel gearbox', geometry,
        connectors: [
          fx('mount', [0, 0, -front], [0, 0, -1]),
          fx('bottom', [0, -height / 2, 0], [0, -1, 0]),
          fx('side', [length / 2, 0, 0], [1, 0, 0]),
          fx('top', [0, height / 2, 0], [0, 1, 0]),
          fx('horn', [0, 0, front + flangeDepth + hornDepth], [0, 0, 1], 'revolute', 'Position-controlled output axis'),
        ],
        limits: { maxTorque_Nm: p.torque, maxSpeed_rad_s: p.speed }, cost_usd: 22 + 3 * p.torque,
      });
    },
  },
  dc_motor: { kind: 'dc_motor', name: 'DC gearmotor', category: 'motors', description: 'Cylindrical gearmotor; "mount" (−X back), "flange" (−Y) fixed; "shaft" revolute about +X. Drive with a velocity drive for continuous rotation.', params: { diameter: { min: 0.01, max: 0.08, default: 0.025, unit: 'm', description: 'Can diameter' }, length: { min: 0.02, max: 0.15, default: 0.05, unit: 'm', description: 'Length' }, torque: { min: 0.05, max: 10, default: 0.5, unit: 'N·m', description: 'Rated torque' }, speed: { min: 1, max: 100, default: 20, unit: 'rad/s', description: 'Rated speed' } },
    generate: (p, id) => { const r = p.diameter / 2; const g = [piece({ kind: 'cylinder', radius: r, height: p.length, axis: 'x' }, [0, 0, 0], COLORS.motor, 'motor'), piece({ kind: 'cylinder', radius: r * 0.2, height: p.length * 0.25, axis: 'x' }, [p.length / 2 + p.length * 0.125, 0, 0], COLORS.brass, 'motor')]; return finish({ id, kind: 'dc_motor', name: `Gearmotor ${p.torque.toFixed(1)} N·m`, category: 'motors', description: `${p.torque.toFixed(1)} N·m at ${p.speed.toFixed(0)} rad/s.`, params: p, mass_kg: 0.03 + p.torque * 0.08, dimensions_m: [p.length * 1.25, p.diameter, p.diameter], material: 'steel can', geometry: g, connectors: [fx('mount', [-p.length / 2, 0, 0], [-1, 0, 0]), fx('flange', [0, -r, 0], [0, -1, 0]), fx('shaft', [p.length / 2 + p.length * 0.25, 0, 0], [1, 0, 0], 'revolute', 'output shaft, spins about +X')], limits: { maxTorque_Nm: p.torque, maxSpeed_rad_s: p.speed }, cost_usd: 6 + p.torque * 10 }); } },
  spring: { kind: 'spring', name: 'Compression spring', category: 'springs', description: 'Helical spring along Y; connect end_a/end_b with joint "spring" to add a spring force between two parts.', params: { length: { min: 0.01, max: 0.3, default: 0.04, unit: 'm', description: 'Free length' }, radius: { min: 0.002, max: 0.03, default: 0.006, unit: 'm', description: 'Coil radius' }, stiffness: { min: 20, max: 20000, default: 500, unit: 'N/m', description: 'Spring rate' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'y' }, [0, 0, 0], COLORS.steel, 'decor', QUAT_ID, { collide: false })]; return finish({ id, kind: 'spring', name: `Spring ${p.stiffness.toFixed(0)} N/m`, category: 'springs', description: 'Music-wire compression spring.', params: p, mass_kg: 0.003 * (p.length / 0.04) * (p.radius / 0.006), dimensions_m: [p.radius * 2, p.length, p.radius * 2], material: 'music wire', geometry: g, connectors: [fx('end_a', [0, p.length / 2, 0], [0, 1, 0]), fx('end_b', [0, -p.length / 2, 0], [0, -1, 0])], limits: { stiffness_N_m: p.stiffness }, cost_usd: 0.5 }); } },
  linear_actuator: { kind: 'linear_actuator', name: 'Linear actuator', category: 'actuators', description: 'Electric linear actuator along X: "base" fixed (−X), "rod" prismatic (+X, travel = stroke), driven by a position drive in metres.', params: { stroke: { min: 0.01, max: 0.4, default: 0.05, unit: 'm', description: 'Stroke' }, force: { min: 5, max: 2000, default: 100, unit: 'N', description: 'Rated force' } },
    generate: (p, id) => { const L = p.stroke * 1.4 + 0.02; const g = [piece({ kind: 'box', size: [L, 0.02, 0.02] }, [0, 0, 0], COLORS.motor, 'motor')]; return finish({ id, kind: 'linear_actuator', name: `Linear actuator ${mm(p.stroke)} mm / ${p.force} N`, category: 'actuators', description: 'Electric linear actuator.', params: p, mass_kg: 0.08 + p.stroke * 0.6 + p.force * 0.0002, dimensions_m: [L, 0.02, 0.02], material: 'aluminium, steel', geometry: g, connectors: [fx('base', [-L / 2, 0, 0], [-1, 0, 0]), fx('mount', [0, -0.01, 0], [0, -1, 0]), fx('rod', [L / 2, 0, 0], [1, 0, 0], 'prismatic', 'rod extends along +X')], limits: { maxForce_N: p.force, travel_m: p.stroke }, cost_usd: 20 + p.force * 0.05 }); } },
  // ---------- specialised ----------
  wing: { kind: 'wing', name: 'Wing panel', category: 'wings', description: 'Thin wing with a recognisable outline (butterfly / dragonfly / bird / blade). Span runs along +X from the root, chord along Z (forewing lobe toward +Z), thickness along Y. FLAPPING: mount via "hinge" (revolute, axis −Z) onto a body connector whose axis runs along the body — the wing then spans sideways and flaps up/down about that body axis. Left wings (side 1, mirrored outline) go on a +Z-side connector with axis −X; right wings (side 0) on a −Z-side connector with axis +X; spin_deg 0 and the same sine drive on both make both wings rise together. "root" (axis −X) is a span-axis pivot (feathering / twist) or fixed mount, not a flapping hinge.', params: { span: { min: 0.02, max: 0.6, default: 0.12, unit: 'm', description: 'Span (root to tip)' }, chord: { min: 0.01, max: 0.4, default: 0.08, unit: 'm', description: 'Chord (max)' }, thickness: { min: 0.0005, max: 0.01, default: 0.001, unit: 'm', description: 'Thickness' }, style: { min: 0, max: 3, default: 0, unit: '', description: '0 butterfly, 1 dragonfly, 2 bird, 3 blade' }, side: { min: 0, max: 1, default: 0, unit: '', description: '0 right wing (mount on the −Z side of the body), 1 left wing (mirrored outline, +Z side)' } },
    generate: (p, id) => { const style = (['butterfly', 'dragonfly', 'bird', 'blade'] as const)[Math.round(p.style)] ?? 'butterfly'; const left = Math.round(p.side) === 1; const m = left ? -1 : 1;
      const prof = ensureCCW(profiles.wing(p.span, p.chord, style).map(([x, y]) => [x, m * y] as [number, number])); const color = style === 'butterfly' ? COLORS.wing : style === 'blade' ? COLORS.pla : '#9ad0ec';
      const g: GeometryPiece[] = [piece({ kind: 'extrude', profile: prof, depth: p.thickness, axis: 'y' }, [0, 0, 0], color, 'wing', QUAT_ID, { material: style === 'blade' ? 'PLA' : 'mylar film on carbon ribs' })];
      if (style === 'butterfly' || style === 'bird') {
        // Two-tone pattern: a darker inner lobe and an eye-spot printed on both faces of the film (no collision, no mass).
        const inner = ensureCCW(prof.map(([x, y]) => [x * 0.62 + p.span * 0.02, y * 0.62] as [number, number]));
        for (const f of [1, -1]) {
          g.push(piece({ kind: 'extrude', profile: inner, depth: p.thickness * 0.6, axis: 'y' }, [0, f * p.thickness * 0.35, 0], style === 'butterfly' ? '#c2410c' : '#2f6f9f', 'decor', QUAT_ID, { collide: false }));
          g.push(piece({ kind: 'cylinder', radius: p.chord * 0.08, height: p.thickness * 0.7, axis: 'y' }, [p.span * 0.68, f * p.thickness * 0.4, m * p.chord * 0.18], '#1d1d1f', 'decor', QUAT_ID, { collide: false }));
          g.push(piece({ kind: 'cylinder', radius: p.chord * 0.045, height: p.thickness * 0.8, axis: 'y' }, [p.span * 0.68, f * p.thickness * 0.42, m * p.chord * 0.18], '#f8fafc', 'decor', QUAT_ID, { collide: false }));
        }
      }
      const mass = Math.abs(prof.reduce((s, [x, y], i, a) => { const [x2, y2] = a[(i + 1) % a.length]; return s + (x * y2 - x2 * y); }, 0) / 2) * (style === 'blade' ? p.thickness * DENSITY.pla : 0.06);
      const sideName = style === 'blade' ? '' : left ? ' (left)' : ' (right)';
      return finish({ id, kind: 'wing', name: `${style[0].toUpperCase()}${style.slice(1)} wing ${mm(p.span)} mm${sideName}`, category: 'wings', description: `${style} ${left ? 'left' : 'right'} wing panel: span along +X from the root, chord along Z, flap hinge "hinge" about Z at the root (mount on a body connector whose axis runs along the body: −X for the left side, +X for the right).`, params: p, mass_kg: Math.max(0.0005, mass), dimensions_m: [p.span, p.thickness, p.chord], material: style === 'blade' ? 'PLA' : 'mylar film, carbon ribs', geometry: g, connectors: [fx('hinge', [0, 0, 0], [0, 0, -1], 'revolute', 'flap hinge at the root; mount onto a body connector whose axis runs along the body'), fx('root', [0, 0, 0], [-1, 0, 0], 'revolute', 'span-axis pivot (feathering) or fixed mount'), fx('root_top', [p.span * 0.05, p.thickness / 2, 0], [0, 1, 0]), fx('root_bottom', [p.span * 0.05, -p.thickness / 2, 0], [0, -1, 0])], cost_usd: 3 }); } },
  insect_body: { kind: 'insect_body', name: 'Winged body', category: 'frames', description: 'Insect / bird body along +X (head at +X, abdomen at −X) with built-in flap servos: "wing_L{i}" (+Z side, axis −X) and "wing_R{i}" (−Z side, axis +X) are revolute flap hinges for wingPairs pairs; mount a left wing (side 1) via "hinge" on wing_L0 and a right wing (side 0) on wing_R0 with spin_deg 0 and the same sine drive — both wings rise together. "perch" underneath, "top" above, "tail" behind. Flap torque rating = torque.', params: { length: { min: 0.03, max: 0.3, default: 0.08, unit: 'm', description: 'Body length' }, radius: { min: 0.004, max: 0.04, default: 0.008, unit: 'm', description: 'Thorax radius' }, wingPairs: { min: 1, max: 2, default: 1, unit: '', description: 'Wing pairs (1 butterfly/bird, 2 dragonfly)' }, torque: { min: 0.05, max: 2, default: 0.3, unit: 'N·m', description: 'Flap servo torque rating' } },
    generate: (p, id) => { const L = p.length, r = p.radius, pairs = Math.round(p.wingPairs);
      const g: GeometryPiece[] = [
        piece({ kind: 'ellipsoid', radii: [L * 0.18, r * 1.2, r * 1.1] }, [L * 0.12, 0, 0], '#2b2118', 'structure'),                      // thorax
        piece({ kind: 'capsule', radius: r * 0.8, height: L * 0.45, axis: 'x' }, [-L * 0.3, -r * 0.1, 0], '#3b2a1e', 'structure'),       // abdomen
        piece({ kind: 'sphere', radius: r * 0.9 }, [L * 0.38, r * 0.1, 0], '#2b2118', 'structure'),                                       // head
        piece({ kind: 'sphere', radius: r * 0.3 }, [L * 0.42, r * 0.3, r * 0.55], '#111', 'decor', QUAT_ID, { collide: false }),         // eyes
        piece({ kind: 'sphere', radius: r * 0.3 }, [L * 0.42, r * 0.3, -r * 0.55], '#111', 'decor', QUAT_ID, { collide: false }),
      ];
      for (const sgn of [1, -1]) { // antennae: thin rods angled up and outward from the head
        const rot = quatMul(quatFromAxisAngle([0, 1, 0], -sgn * 0.45), quatFromAxisAngle([0, 0, 1], 0.55));
        g.push(piece({ kind: 'cylinder', radius: Math.max(0.0004, r * 0.06), height: L * 0.35, axis: 'x' }, [L * 0.38 + L * 0.13, r * 0.9 + L * 0.08, sgn * (r * 0.3 + L * 0.07)], '#1d1d1f', 'decor', rot, { collide: false }));
      }
      const connectors: Connector[] = [];
      // Two pairs sit far enough apart that a hind wing of chord ≈ 0.3·L clears the forewing (measured: 0.16·L spacing let them touch).
      for (let i = 0; i < pairs; i++) { const x = (pairs > 1 ? L * 0.2 : L * 0.14) - i * L * 0.38; connectors.push(fx(`wing_L${i}`, [x, r * 0.5, r * 1.0], [-1, 0, 0], 'revolute', 'left flap hinge (+Z side); axis runs along the body'), fx(`wing_R${i}`, [x, r * 0.5, -r * 1.0], [1, 0, 0], 'revolute', 'right flap hinge (−Z side); axis runs along the body')); }
      connectors.push(fx('perch', [0, -r * 1.2, 0], [0, -1, 0]), fx('top', [L * 0.12, r * 1.2, 0], [0, 1, 0]), fx('tail', [-L * 0.52, -r * 0.1, 0], [-1, 0, 0]));
      return finish({ id, kind: 'insect_body', name: `Winged body ${mm(L)} mm`, category: 'frames', description: `Body with ${pairs} pair${pairs > 1 ? 's' : ''} of built-in ${p.torque} N·m flap hinges (wing_L*/wing_R*), perch underneath.`, params: p, mass_kg: vol(g) * DENSITY.pla + pairs * p.torque * 0.02, dimensions_m: [L, r * 2.4, r * 2.2], material: 'PLA shell, micro servos', geometry: g, connectors, limits: { maxTorque_Nm: p.torque, maxSpeed_rad_s: 12 }, cost_usd: 6 + pairs * 4 }); } },
  propeller: { kind: 'propeller', name: 'Propeller', category: 'propellers', description: 'N-blade propeller / windmill rotor; hub "shaft" revolute about Z (mount on a motor shaft or axle). Blades are thin pitched plates.', params: { radius: { min: 0.02, max: 0.6, default: 0.1, unit: 'm', description: 'Blade radius' }, blades: { min: 2, max: 8, default: 3, unit: '', description: 'Blade count' }, chord: { min: 0.005, max: 0.15, default: 0.02, unit: 'm', description: 'Blade chord' }, pitch: { min: 0, max: 0.8, default: 0.3, unit: 'rad', description: 'Blade pitch angle' } },
    generate: (p, id) => { const n = Math.round(p.blades); const standoff = Math.max(0.03, p.radius * 0.1); // hub boss keeps pitched blades clear of whatever the rotor is mounted on
      const g: GeometryPiece[] = [piece({ kind: 'cylinder', radius: p.chord * 0.6, height: p.chord * 0.5, axis: 'z' }, [0, 0, 0], COLORS.steel), piece({ kind: 'cylinder', radius: p.chord * 0.3, height: standoff, axis: 'z' }, [0, 0, -p.chord * 0.25 - standoff / 2], COLORS.steel)]; const prof = profiles.wing(p.radius, p.chord, 'blade');
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; const rot = quatFromAxisAngle([0, 0, 1], a); const pitch = quatFromAxisAngle([Math.cos(a), Math.sin(a), 0], p.pitch); g.push(piece({ kind: 'extrude', profile: prof, depth: 0.002, axis: 'z' }, [Math.cos(a) * p.chord * 0.3, Math.sin(a) * p.chord * 0.3, 0], COLORS.pla, 'blade', (() => { const q1 = rot; const [x, y, z, w] = pitch; const [ax, ay, az, aw] = q1; return [aw * x + ax * w + ay * z - az * y, aw * y - ax * z + ay * w + az * x, aw * z + ax * y - ay * x + az * w, aw * w - ax * x - ay * y - az * z] as [number, number, number, number]; })())); }
      return finish({ id, kind: 'propeller', name: `${n}-blade rotor Ø${mm(p.radius * 2)} mm`, category: 'propellers', description: 'PLA rotor with pitched blades. Aerodynamic thrust is NOT simulated; only rotation and clearance.', params: p, mass_kg: 0.01 + n * p.radius * p.chord * 0.002 * DENSITY.pla, dimensions_m: [p.radius * 2, p.radius * 2, p.chord], material: 'PLA', geometry: g, connectors: [fx('shaft', [0, 0, -p.chord * 0.25 - standoff], [0, 0, -1], 'revolute', 'hub boss; mount onto a motor shaft / axle (the boss stands the blades off the mount)'), fx('front', [0, 0, p.chord * 0.25], [0, 0, 1])], cost_usd: 4 }); } },
  toothed_scoop: {
    kind: 'toothed_scoop', name: 'Toothed excavator scoop', category: 'grippers',
    description: 'Hollow excavator/loader bucket, open toward +X and +Y; Z is width. Rear hinge axis passes through the origin about Z. Mount via hinge on a boom pin; actuator is a separate curl-link pivot. cutting_edge and tooth_*_tip locate the working edge.',
    params: {
      width: { min: 0.04, max: 0.4, default: 0.25, unit: 'm', description: 'Outside width across Z' },
      depth: { min: 0.035, max: 0.4, default: 0.2, unit: 'm', description: 'Floor length along +X before the teeth' },
      height: { min: 0.03, max: 0.3, default: 0.14, unit: 'm', description: 'Hinge-axis height above the bottom' },
      thickness: { min: 0.001, max: 0.012, default: 0.004, unit: 'm', description: 'Wall and floor thickness' },
      teeth: { min: 2, max: 8, default: 5, unit: '', description: 'Number of tapered cutting teeth (integer)' },
    },
    generate: (p, id) => {
      const { width, depth, height, thickness, teeth } = p;
      if (!Number.isInteger(teeth)) throw new ParamError('Scoop tooth count must be an integer.');
      if (thickness > Math.min(width / 12, depth / 12, height / 10)) {
        throw new ParamError('Scoop walls must be at most 1/12 of width and depth, and 1/10 of height, to leave an open cavity.');
      }
      const hingeRadius = Math.max(2 * thickness, Math.min(height * 0.12, width * 0.08));
      const hingeSpan = width * 0.65;
      const backTop = -hingeRadius * 0.75;
      const linkRadius = hingeRadius * 0.8;
      const linkX = -hingeRadius * 2, linkY = -height * 0.4;
      const webStart = linkX + linkRadius * 0.75;
      const toothReach = depth * 0.3;
      const toothPitch = (width - 2 * thickness) / teeth;
      const cheek: Profile = [[0, -height], [depth, -height], [depth, -height + 2 * thickness],
        [depth * 0.65, -height * 0.35], [thickness, backTop], [0, backTop]];
      const barrel = (outer: number, span: number): Shape => ({
        kind: 'revolve', axis: 'z', segments: 24,
        profile: [[outer * 0.45, -span / 2], [outer, -span / 2], [outer, span / 2], [outer * 0.45, span / 2]],
      });
      const geometry = [
        piece({ kind: 'box', size: [depth, thickness, width] }, [depth / 2, -height + thickness / 2, 0], COLORS.orange),
        piece({ kind: 'box', size: [thickness, height + backTop, width] }, [thickness / 2, (-height + backTop) / 2, 0], COLORS.orange),
        ...[-1, 1].map((side) => piece({ kind: 'extrude', profile: cheek, depth: thickness, axis: 'z' }, [0, 0, side * (width - thickness) / 2], COLORS.orange)),
        piece(barrel(hingeRadius, hingeSpan), [0, 0, 0], COLORS.aluminium),
        piece({ kind: 'box', size: [thickness - webStart, linkRadius * 0.9, 2 * thickness] }, [(webStart + thickness) / 2, linkY, 0], COLORS.orange),
        piece(barrel(linkRadius, 4 * thickness), [linkX, linkY, 0], COLORS.aluminium),
        piece({ kind: 'box', size: [2 * thickness, 2 * thickness, width] }, [depth - thickness, -height + thickness, 0], COLORS.titanium, 'contact'),
      ];
      const connectors: Connector[] = [
        fx('hinge', [0, 0, -hingeSpan / 2], [0, 0, -1], 'revolute', 'Rear bucket hinge; +X is the open mouth, floor lies below the pivot'),
        fx('hinge_front', [0, 0, hingeSpan / 2], [0, 0, 1], 'revolute', 'Opposite end of the same rear hinge'),
        fx('actuator', [linkX, linkY, 2 * thickness], [0, 0, 1], 'revolute', 'Curl linkage pin; attach a separate passive link or actuator'),
        fx('actuator_back', [linkX, linkY, -2 * thickness], [0, 0, -1], 'revolute', 'Opposite face of the curl linkage pin'),
        fx('mount', [0, -height * 0.6, 0], [-1, 0, 0], 'fixed', 'Rear surface for a rigid tool mount instead of the hinge'),
        fx('cutting_edge', [depth, -height + thickness, 0], [1, 0, 0], 'fixed', 'Centre of the physical cutting lip, behind the tooth tips'),
      ];
      for (let tooth = 0; tooth < teeth; tooth++) {
        const z = -(width - 2 * thickness) / 2 + (tooth + 0.5) * toothPitch;
        geometry.push(piece({ kind: 'extrude', axis: 'z', depth: toothPitch * 0.6,
          profile: [[depth - 3 * thickness, -height], [depth + toothReach, -height],
            [depth + toothReach, -height + thickness * 0.35], [depth - 3 * thickness, -height + thickness * 1.8]],
        }, [0, 0, z], COLORS.titanium, 'contact'));
        connectors.push(fx(`tooth_${tooth}_tip`, [depth + toothReach, -height + thickness * 0.175, z], [1, 0, 0], 'fixed', 'Point on the cutting tooth; use for measured scoop travel'));
      }
      return finish({
        id, kind: 'toothed_scoop', name: `Toothed scoop ${mm(width)}×${mm(depth)} mm`, category: 'grippers',
        description: `Open aluminium excavator/loader shovel bucket with ${teeth} teeth, sloped cheeks, bored rear hinge and separate curl-link pivot. No roof or front wall fills the cavity.`,
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium,
        dimensions_m: [depth + toothReach - linkX + linkRadius, height + hingeRadius, width],
        material: 'aluminium', geometry, connectors, cost_usd: 8 + width * depth * 350,
      });
    },
  },
  gripper_finger: { kind: 'gripper_finger', name: 'Gripper finger', category: 'grippers', description: 'Curved claw finger with rubber pad; "root" revolute about Z at the top; finger hangs down −Y and curls toward +X.', params: { length: { min: 0.015, max: 0.3, default: 0.06, unit: 'm', description: 'Length' }, width: { min: 0.004, max: 0.04, default: 0.012, unit: 'm', description: 'Width' }, thickness: { min: 0.002, max: 0.02, default: 0.006, unit: 'm', description: 'Thickness (Z)' } },
    generate: (p, id) => { const g = [piece({ kind: 'extrude', profile: profiles.claw(p.length, p.width, 0.35), depth: p.thickness, axis: 'z' }, [0, 0, 0], COLORS.titanium), piece({ kind: 'box', size: [p.width * 0.6, p.length * 0.25, p.thickness * 1.1] }, [0.35 * p.length * 0.7 + p.width * 0.25, -p.length * 0.8, 0], COLORS.rubber, 'contact')]; return finish({ id, kind: 'gripper_finger', name: `Gripper finger ${mm(p.length)} mm`, category: 'grippers', description: 'Aluminium claw finger with rubber pad.', params: p, mass_kg: vol(g) * DENSITY.aluminium * 0.8, dimensions_m: [p.width + 0.35 * p.length, p.length, p.thickness], material: 'aluminium, rubber pad', geometry: g, connectors: [fx('root', [0, 0, -p.thickness / 2], [0, 0, -1], 'revolute', 'pivot; mount onto a servo horn (curls toward +X when rotated)'), fx('root_front', [0, 0, p.thickness / 2], [0, 0, 1], 'revolute')], cost_usd: 2 }); } },
  gondola: { kind: 'gondola', name: 'Gondola cabin', category: 'misc', description: 'Hanging cabin for a Ferris wheel: "hanger" revolute about Z at the top (so it stays level under gravity).', params: { width: { min: 0.01, max: 0.3, default: 0.04, unit: 'm', description: 'Cabin width' }, height: { min: 0.01, max: 0.3, default: 0.04, unit: 'm', description: 'Cabin height' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.width, p.height, p.width * 0.8] }, [0, -p.height / 2 - p.height * 0.4, 0], COLORS.red, 'shell'), piece({ kind: 'box', size: [p.width * 0.1, p.height * 0.4, p.width * 0.1] }, [0, -p.height * 0.2, 0], COLORS.steel)]; return finish({ id, kind: 'gondola', name: `Gondola ${mm(p.width)} mm`, category: 'misc', description: 'Painted cabin on a pivot hanger.', params: p, mass_kg: vol(g) * DENSITY.pla, dimensions_m: [p.width, p.height * 1.4, p.width * 0.8], material: 'PLA, steel hanger', geometry: g, connectors: [fx('hanger', [0, 0, -p.width * 0.05], [0, 0, -1], 'revolute', 'top pivot about Z'), fx('hanger_front', [0, 0, p.width * 0.05], [0, 0, 1], 'revolute')], cost_usd: 3 }); } },
  foot_pad: { kind: 'foot_pad', name: 'Rubber foot pad', category: 'pads', description: 'Spherical rubber pad; "mount" on top.', params: { radius: { min: 0.003, max: 0.05, default: 0.01, unit: 'm', description: 'Radius' } },
    generate: (p, id) => { const g = [piece({ kind: 'sphere', radius: p.radius }, [0, 0, 0], COLORS.rubber, 'contact')]; return finish({ id, kind: 'foot_pad', name: `Foot pad Ø${mm(p.radius * 2)} mm`, category: 'pads', description: 'High-friction rubber pad.', params: p, mass_kg: vol(g) * DENSITY.rubber, dimensions_m: [p.radius * 2, p.radius * 2, p.radius * 2], material: 'rubber 60A', geometry: g, connectors: [fx('mount', [0, p.radius, 0], [0, 1, 0])], cost_usd: 0.4 }); } },
  track_module: { kind: 'track_module', name: 'Track module', category: 'tracks', description: 'Simplified tracked-drive unit: body with two driven road wheels modelled as one belt block; "mount" on top, "drive" revolute axle (Z) at the rear wheel for a motor. Ground contact is the rubber belt.', params: { length: { min: 0.04, max: 0.6, default: 0.15, unit: 'm', description: 'Track length' }, height: { min: 0.01, max: 0.15, default: 0.04, unit: 'm', description: 'Height' }, width: { min: 0.01, max: 0.15, default: 0.03, unit: 'm', description: 'Width' } },
    generate: (p, id) => { const g = [piece({ kind: 'extrude', profile: profiles.roundedRect(p.length, p.height, p.height / 2), depth: p.width, axis: 'z' }, [0, 0, 0], COLORS.rubber, 'contact')]; return finish({ id, kind: 'track_module', name: `Track ${mm(p.length)}×${mm(p.height)} mm`, category: 'tracks', description: 'Rubber track with road wheels (simplified as a rolling belt body).', params: p, mass_kg: vol(g) * DENSITY.rubber * 0.4, dimensions_m: [p.length, p.height, p.width], material: 'rubber, nylon wheels', geometry: g, connectors: [fx('mount', [0, p.height / 2, 0], [0, 1, 0]), fx('drive', [p.length / 2 - p.height / 2, 0, p.width / 2], [0, 0, 1], 'revolute', 'rear sprocket axle')], cost_usd: 15 }); } },
  shell_panel: { kind: 'shell_panel', name: 'Shell panel', category: 'shells', description: 'Cosmetic printed panel; "mount" on the underside.', params: { length: { min: 0.01, max: 0.6, default: 0.17, unit: 'm', description: 'Length' }, width: { min: 0.01, max: 0.6, default: 0.09, unit: 'm', description: 'Width' }, thickness: { min: 0.001, max: 0.006, default: 0.002, unit: 'm', description: 'Thickness' } },
    generate: (p, id) => { const g = [piece({ kind: 'extrude', profile: profiles.roundedRect(p.length, p.width, Math.min(p.length, p.width) * 0.15), depth: p.thickness, axis: 'y' }, [0, 0, 0], COLORS.shell, 'shell')]; return finish({ id, kind: 'shell_panel', name: `Shell panel ${mm(p.length)}×${mm(p.width)} mm`, category: 'shells', description: 'PLA cosmetic shell.', params: p, mass_kg: vol(g) * DENSITY.pla, dimensions_m: [p.length, p.thickness, p.width], material: 'PLA', geometry: g, connectors: [fx('mount', [0, -p.thickness / 2, 0], [0, -1, 0]), fx('top', [0, p.thickness / 2, 0], [0, 1, 0])], cost_usd: 3 }); } },
  eye_module: { kind: 'eye_module', name: 'Eye module', category: 'shells', description: 'Decorative LED eye dome; "mount" at the back (−X).', params: { radius: { min: 0.003, max: 0.04, default: 0.009, unit: 'm', description: 'Radius' } },
    generate: (p, id) => { const g = [piece({ kind: 'sphere', radius: p.radius }, [0, 0, 0], COLORS.blue, 'decor', QUAT_ID, { collide: false })]; return finish({ id, kind: 'eye_module', name: `Eye dome Ø${mm(p.radius * 2)} mm`, category: 'shells', description: 'Translucent dome with LED.', params: p, mass_kg: 0.004, dimensions_m: [p.radius * 2, p.radius * 2, p.radius * 2], material: 'acrylic', geometry: g, connectors: [fx('mount', [-p.radius, 0, 0], [-1, 0, 0])], cost_usd: 1.5 }); } },
  screw: { kind: 'screw', name: 'Machine screw', category: 'fasteners', description: 'Metric machine screw (cosmetic in simulation).', params: { length: { min: 0.004, max: 0.06, default: 0.01, unit: 'm', description: 'Length' }, radius: { min: 0.001, max: 0.004, default: 0.0015, unit: 'm', description: 'Thread radius' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.length, axis: 'y' }, [0, -p.length / 2, 0], COLORS.steel, 'fastener', QUAT_ID, { collide: false }), piece({ kind: 'cylinder', radius: p.radius * 1.8, height: p.radius * 1.5, axis: 'y' }, [0, p.radius * 0.75, 0], COLORS.steel, 'fastener', QUAT_ID, { collide: false })]; return finish({ id, kind: 'screw', name: `M${mm(p.radius * 2)}×${mm(p.length)} screw`, category: 'fasteners', description: 'Stainless screw.', params: p, mass_kg: vol(g) * DENSITY.steel, dimensions_m: [p.radius * 2, p.length, p.radius * 2], material: 'stainless', geometry: g, connectors: [fx('head', [0, 0, 0], [0, 1, 0])], cost_usd: 0.05 }); } },
  orrery_globe: {
    kind: 'orrery_globe', name: 'Orrery globe', category: 'shells',
    description: 'Lightweight mountable Sun, Earth or Moon globe. Fixed connectors at the bottom and top poles face −Y and +Y.',
    params: {
      radius: { min: 0.005, max: 0.08, default: 0.022, unit: 'm', description: 'Globe radius' },
      style: { min: 0, max: 2, default: 1, unit: '', description: '0: Sun, 1: Earth, 2: Moon' },
    },
    generate: (p, id) => {
      const { radius } = p;
      const style = Math.round(p.style);
      const [name, color] = [
        ['Sun', '#ffb52f'], ['Earth', '#2479e7'], ['Moon', '#b9c7d9'],
      ][style];
      const body = piece({ kind: 'sphere', radius }, [0, 0, 0], color, 'shell');
      const geometry = [body];
      // Shallow painted details follow the surface. Only the main sphere has mass and collision.
      const mark = (latitude: number, longitude: number, width: number, height: number, paint: string) => {
        const rotation = quatMul(quatFromAxisAngle([0, 1, 0], longitude), quatFromAxisAngle([0, 0, 1], latitude - Math.PI / 2));
        geometry.push(piece({ kind: 'ellipsoid', radii: [radius * height, radius * 0.06, radius * width] },
          rotate(rotation, [0, radius * 0.96, 0]), paint, 'decor', rotation, { collide: false }));
      };
      if (style === 0) {
        mark(0.2, 0.6, 0.55, 0.16, '#ffd85a');
        mark(-0.33, 3.6, 0.52, 0.14, '#f07821');
      } else if (style === 1) {
        mark(0.4, 0.75, 0.38, 0.36, '#2fae73');
        mark(-0.19, 1.01, 0.21, 0.31, '#52b673');
        mark(0.36, 3.43, 0.49, 0.3, '#46b776');
        mark(-0.28, 4.5, 0.25, 0.18, '#66c681');
        mark(1.48, 0, 0.25, 0.25, '#ebf5ff');
      } else {
        mark(0.25, 0.75, 0.25, 0.29, '#778ba3');
        mark(-0.32, 1.65, 0.18, 0.21, '#8799af');
        mark(0.16, 3.95, 0.28, 0.19, '#8799af');
      }
      const diameter = radius * 2;
      return finish({
        id, kind: 'orrery_globe', name: `${name} globe Ø${mm(diameter)} mm`, category: 'shells',
        description: `Painted ${name} model for an orrery. Secure the bottom mount to a stand or orbit arm.`,
        params: p, mass_kg: shapeVolume(body.shape) * 60, dimensions_m: [diameter, diameter, diameter],
        material: 'painted foam', geometry, connectors: [
          fx('mount', [0, -radius, 0], [0, -1, 0], 'fixed', 'Bottom pole mount'),
          fx('top', [0, radius, 0], [0, 1, 0], 'fixed', 'Top pole mount'),
        ], cost_usd: 1.5,
      });
    },
  },
  ball: { kind: 'ball', name: 'Ball', category: 'payloads', description: 'Free payload / projectile ball (foam, rubber or wood by density).', params: { radius: { min: 0.005, max: 0.15, default: 0.03, unit: 'm', description: 'Radius' }, density: { min: 20, max: 2000, default: 60, unit: 'kg/m³', description: 'Density (foam 30–60, wood 600, rubber 1100)' } },
    generate: (p, id) => { const g = [piece({ kind: 'sphere', radius: p.radius }, [0, 0, 0], p.density < 200 ? '#f4d35e' : COLORS.wood, 'payload')]; return finish({ id, kind: 'ball', name: `Ball Ø${mm(p.radius * 2)} mm`, category: 'payloads', description: 'Payload ball.', params: p, mass_kg: vol(g) * p.density, dimensions_m: [p.radius * 2, p.radius * 2, p.radius * 2], material: p.density < 200 ? 'foam' : 'wood', geometry: g, connectors: [fx('top', [0, p.radius, 0], [0, 1, 0]), fx('bottom', [0, -p.radius, 0], [0, -1, 0])], cost_usd: 1 }); } },
  block: { kind: 'block', name: 'Block', category: 'payloads', description: 'Free payload block (box) of given density.', params: { length: { min: 0.005, max: 0.3, default: 0.04, unit: 'm', description: 'Length' }, width: { min: 0.005, max: 0.3, default: 0.04, unit: 'm', description: 'Width' }, height: { min: 0.005, max: 0.3, default: 0.04, unit: 'm', description: 'Height' }, density: { min: 20, max: 8000, default: 600, unit: 'kg/m³', description: 'Density' } },
    generate: (p, id) => { const g = [piece({ kind: 'box', size: [p.length, p.height, p.width] }, [0, 0, 0], COLORS.wood, 'payload')]; return finish({ id, kind: 'block', name: `Block ${mm(p.length)}×${mm(p.width)}×${mm(p.height)} mm`, category: 'payloads', description: 'Payload block.', params: p, mass_kg: vol(g) * p.density, dimensions_m: [p.length, p.height, p.width], material: 'wood', geometry: g, connectors: [fx('top', [0, p.height / 2, 0], [0, 1, 0]), fx('bottom', [0, -p.height / 2, 0], [0, -1, 0])], cost_usd: 1 }); } },
  disc: { kind: 'disc', name: 'Disc / pizza', category: 'payloads', description: 'Flat disc payload (e.g. a foam pizza) with a mount underneath.', params: { radius: { min: 0.01, max: 0.2, default: 0.04, unit: 'm', description: 'Radius' }, thickness: { min: 0.002, max: 0.03, default: 0.008, unit: 'm', description: 'Thickness' }, density: { min: 20, max: 1200, default: 60, unit: 'kg/m³', description: 'Density' } },
    generate: (p, id) => { const g = [piece({ kind: 'cylinder', radius: p.radius, height: p.thickness, axis: 'y' }, [0, 0, 0], '#f4a261', 'payload'), piece({ kind: 'cylinder', radius: p.radius * 0.8, height: p.thickness * 1.02, axis: 'y' }, [0, 0, 0], '#e63946', 'decor', QUAT_ID, { collide: false })]; return finish({ id, kind: 'disc', name: `Disc Ø${mm(p.radius * 2)} mm`, category: 'payloads', description: 'Foam disc payload.', params: p, mass_kg: Math.PI * p.radius ** 2 * p.thickness * p.density, dimensions_m: [p.radius * 2, p.thickness, p.radius * 2], material: 'foam', geometry: g, connectors: [fx('bottom', [0, -p.thickness / 2, 0], [0, -1, 0]), fx('top', [0, p.thickness / 2, 0], [0, 1, 0])], cost_usd: 1 }); } },
  gravity_chute: {
    kind: 'gravity_chute', name: 'Gravity chute', category: 'misc',
    description: 'Open-ended gravity ramp with two solid side rails. Angle it downhill toward +X for marbles or other loose parts.',
    params: {
      length: { min: 0.04, max: 0.6, default: 0.16, unit: 'm', description: 'Length along X' },
      width: { min: 0.014, max: 0.2, default: 0.054, unit: 'm', description: 'Clear width between the rails' },
      railHeight: { min: 0.004, max: 0.1, default: 0.016, unit: 'm', description: 'Side rail height above the floor' },
      thickness: { min: 0.001, max: 0.012, default: 0.004, unit: 'm', description: 'Floor and rail thickness' },
    },
    generate: (p, id) => {
      const { length, width, railHeight, thickness } = p;
      const outerWidth = width + 2 * thickness;
      const railOffset = (width + thickness) / 2;
      const floorTop = thickness / 2;
      const geometry = [
        piece({ kind: 'box', size: [length, thickness, outerWidth] }, [0, 0, 0], COLORS.orange),
        ...[-railOffset, railOffset].map((z) =>
          piece({ kind: 'box', size: [length, railHeight, thickness] }, [0, floorTop + railHeight / 2, z], COLORS.blue)),
      ];
      return finish({
        id, kind: 'gravity_chute', name: `Gravity chute ${mm(length)} × ${mm(width)} mm`, category: 'misc',
        description: 'Open ramp with a solid floor and two side rails. Mount it on an incline to guide loose marbles or parts.',
        params: p, mass_kg: vol(geometry) * DENSITY.aluminium, dimensions_m: [length, thickness + railHeight, outerWidth],
        material: 'aluminium', geometry, cost_usd: 4,
        connectors: [
          fx('mount', [0, -floorTop, 0], [0, -1, 0], 'fixed', 'Underside support'),
          fx('entry', [-length / 2, floorTop, 0], [-1, 0, 0], 'fixed', 'Open upstream floor edge'),
          fx('exit', [length / 2, floorTop, 0], [1, 0, 0], 'fixed', 'Open downstream floor edge'),
        ],
      });
    },
  },
  tray: { kind: 'tray', name: 'Launch tray', category: 'misc', description: 'Shallow cup/tray that holds a projectile (floor + rim wall segments, so a ball stays in it until flung); "mount" underneath, "payload" on the floor.', params: { radius: { min: 0.01, max: 0.2, default: 0.045, unit: 'm', description: 'Inner radius' }, depth: { min: 0.003, max: 0.05, default: 0.012, unit: 'm', description: 'Rim height' } },
    generate: (p, id) => { const g: GeometryPiece[] = [piece({ kind: 'cylinder', radius: p.radius + 0.003, height: 0.003, axis: 'y' }, [0, 0.0015, 0], COLORS.aluminium)]; const n = 10; const segLen = 2 * Math.PI * (p.radius + 0.0015) / n;
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; g.push(piece({ kind: 'box', size: [0.003, p.depth, segLen * 1.05] }, [Math.cos(a) * (p.radius + 0.0015), 0.003 + p.depth / 2, Math.sin(a) * (p.radius + 0.0015)], COLORS.aluminium, 'structure', quatFromAxisAngle([0, 1, 0], -a))); }
      return finish({ id, kind: 'tray', name: `Tray Ø${mm(p.radius * 2)} mm`, category: 'misc', description: 'Aluminium launch cup.', params: p, mass_kg: vol(g) * DENSITY.aluminium, dimensions_m: [p.radius * 2 + 0.006, p.depth + 0.003, p.radius * 2 + 0.006], material: 'aluminium', geometry: g, connectors: [fx('mount', [0, 0, 0], [0, -1, 0]), fx('payload', [0, 0.003, 0], [0, 1, 0])], cost_usd: 2 }); } },
  counterweight: { kind: 'counterweight', name: 'Counterweight', category: 'misc', description: 'Dense steel weight block with a "mount" on top.', params: { mass: { min: 0.01, max: 20, default: 0.5, unit: 'kg', description: 'Mass' } },
    generate: (p, id) => { const side = Math.cbrt(p.mass / DENSITY.steel); const g = [piece({ kind: 'box', size: [side, side, side] }, [0, 0, 0], COLORS.steel)]; return finish({ id, kind: 'counterweight', name: `Counterweight ${p.mass} kg`, category: 'misc', description: 'Steel weight.', params: p, mass_kg: p.mass, dimensions_m: [side, side, side], material: 'steel', geometry: g, connectors: [fx('mount', [0, side / 2, 0], [0, 1, 0]), fx('side', [side / 2, 0, 0], [1, 0, 0])], cost_usd: p.mass * 3 }); } },
};

export class ParamError extends Error {}

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

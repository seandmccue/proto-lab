import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, type AssemblyOp } from '@protolab/parts';
import type { TestSpec } from '@protolab/schema';

// The four bearing axes cross at the same height. Their anchors are placed
// along each axis on the visible sides of the nested square frames.
const centerY = 0.178;
const pedestal = generatePart('plate', { length: 0.23, width: 0.20, thickness: 0.008 }, 'gimbal-pedestal');
pedestal.geometry.push(
  ...[-0.093, 0.093].flatMap(x => [
    piece({ kind: 'box', size: [0.019, 0.175, 0.024] }, [x, 0.0875, 0], '#526985'),
    piece({ kind: 'cylinder', axis: 'x', radius: 0.018, height: 0.027 }, [x, 0.174, 0], '#223247'),
  ]),
);
pedestal.connectors.push({ id: 'roll', position: [0.075, 0.174, 0], axis: [1, 0, 0], kind: 'revolute' });
pedestal.limits.maxTorque_Nm = 2;
const makeRing = (id: string, opening: number, rim: number, color: string) => {
  const part = generatePart('gimbal_frame', { opening, rim, thickness: 0.006 }, id);
  part.geometry = part.geometry.map(shape => ({ ...shape, color }));
  return part;
};
const outer = makeRing('driven-roll-ring', 0.130, 0.010, '#5887af');
outer.geometry.push(piece({ kind: 'cylinder', axis: 'z', radius: 0.010, height: 0.014 }, [0, 0, 0.070], '#223247'));
outer.limits.maxTorque_Nm = 2;
const inner = makeRing('driven-pitch-ring', 0.102, 0.008, '#86adc4');
const passive = makeRing('passive-roll-ring', 0.072, 0.007, '#2e9f94');
// The hanging tray and ballast keep the final body's center of mass below
// both passive pivots. No drive is attached to either passive joint.
const tray = generatePart('tray', { radius: 0.028, depth: 0.005 }, 'camera-tray');
tray.geometry = tray.geometry.map(shape => ({ ...shape, color: '#ee9c30' }));
tray.geometry.push(
  piece({ kind: 'cylinder', axis: 'z', radius: 0.003, height: 0.075 }, [0, 0.033, 0], '#354c62'),
  ...[-0.020, 0.020].map(z => piece({ kind: 'box', size: [0.006, 0.037, 0.006] }, [0, 0.017, z], '#354c62')),
);
tray.connectors.push(
  { id: 'pitch', position: [0, 0.033, 0.036], axis: [0, 0, 1], kind: 'revolute' },
  { id: 'ballast', position: [0, -0.021, 0], axis: [0, -1, 0], kind: 'fixed' },
);
const cw = getPart('counterweight-40g')!;
const cwHeight = cw.connectors.find(c => c.id === 'mount')!.position[1];
const parts = new Map([pedestal, outer, inner, passive, tray, cw].map(p => [p.id, p]));
const ops: AssemblyOp[] = [
  { op: 'place', id: 'base', part: pedestal.id, position: [0, 0.004, 0], anchored: true },
  { op: 'place', id: 'roll_ring', part: outer.id, label: 'Powered roll frame', position: [0, centerY, 0] },
  { op: 'place', id: 'pitch_ring', part: inner.id, label: 'Powered pitch frame', position: [0, centerY, 0], rotation_deg: [0, -90, 0] },
  { op: 'place', id: 'passive_ring', part: passive.id, label: 'Passive inner gimbal', position: [0, centerY, 0] },
  { op: 'place', id: 'tray', part: tray.id, label: 'Self-leveling camera tray', position: [0, centerY - 0.033, 0] },
  { op: 'place', id: 'weight', part: cw.id, label: '40 g gravity ballast', position: [0, centerY - 0.054 - cwHeight, 0] },
  { op: 'connect', a: 'base', a_connector: 'roll', b: 'roll_ring', b_connector: 'outer_right', joint: 'revolute', motor: { controlId: 'roll', stiffness: 8, damping: 0.55 } },
  { op: 'connect', a: 'roll_ring', a_connector: 'inner_front', b: 'pitch_ring', b_connector: 'outer_right', joint: 'revolute', motor: { controlId: 'pitch', stiffness: 8, damping: 0.55 } },
  { op: 'connect', a: 'pitch_ring', a_connector: 'inner_front', b: 'passive_ring', b_connector: 'outer_left', joint: 'revolute' },
  { op: 'connect', a: 'passive_ring', a_connector: 'inner_front', b: 'tray', b_connector: 'pitch', joint: 'revolute' },
  { op: 'connect', a: 'tray', a_connector: 'ballast', b: 'weight', b_connector: 'mount', joint: 'fixed' },
];
/** Deterministic reference model. This fixture is assembled directly from catalog and generated parts. */
export function buildTwoAxisGimbal() {
  return setDrives(applyOps(emptyAssembly(), ops, id => parts.get(id)).assembly, [
    { controlId: 'roll', mode: 'position', rampIn_s: 0.6, profile: { kind: 'sine', offset: 0, amplitude: 0.48, phase: 0, frequency_hz: 0.1 } },
    { controlId: 'pitch', mode: 'position', rampIn_s: 0.85, profile: { kind: 'sine', offset: 0, amplitude: 0.46, phase: Math.PI / 2, frequency_hz: 0.12 } },
  ]);
}
export const twoAxisGimbalTest: TestSpec = {
  kind: 'motion', id: 'two_axis_gimbal', duration_s: 12,
  measure: {
    joints: ['roll', 'pitch'],
    jointSwing: [{ joint: 'roll', minEachWay_rad: 0.35 }, { joint: 'pitch', minEachWay_rad: 0.35 }],
    uprightInstances: ['tray'],
    clearancePairs: [
      ['base', 'pitch_ring'], ['base', 'passive_ring'], ['base', 'tray'], ['base', 'weight'],
      ['roll_ring', 'passive_ring'], ['roll_ring', 'tray'], ['roll_ring', 'weight'],
      ['pitch_ring', 'tray'], ['pitch_ring', 'weight'], ['passive_ring', 'weight'],
    ],
    noGroundContact: ['tray'],
  },
  criteria: { maxInstanceTilt_deg: 10, torqueWithinRating: true },
};

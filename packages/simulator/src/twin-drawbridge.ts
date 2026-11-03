import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, tiltDeg, type AssemblyOp } from '@protolab/parts';
import type { PartDefinition, TestResult, TestSpec } from '@protolab/schema';

const hingeX = 0.14;
const hingeHeight = 0.20;
const bellCrankZ = 0.052;
const crossheadHeight = 0.13;
const deckLength = 0.137;
const leaves = ['left_deck', 'right_deck'] as const;

export const twinDrawbridgeTest: TestSpec = {
  kind: 'motion', id: 'twin_bell_crank_bridge', duration_s: 8.7,
  measure: {
    joints: ['open_bridge'],
    base: 'base',
    clearancePairs: [['left_deck', 'right_deck']],
    noGroundContact: [...leaves],
    linearTravel: leaves.map((instance) => ({ instance, axis: 'y' as const, minTravel_m: 0.045 })),
  },
  criteria: { maxBaseTilt_deg: 2, torqueWithinRating: true },
};

export function buildTwinDrawbridge() {
  const base = generatePart('plate', { length: 0.42, width: 0.23, thickness: 0.007 }, 'bridge-base');
  const tower = generatePart('tower', { height: hingeHeight, baseWidth: 0.10, legWidth: 0.01 }, 'bridge-tower');
  const axleZ = tower.connectors.find((connector) => connector.id === 'axle')!.position[2];
  const bellCrank = getPart('bell-crank-30x40')!;
  const inputHeight = hingeHeight - bellCrank.params.input;
  const halfThickness = bellCrank.params.thickness / 2;
  const outputDistance = bellCrank.params.output;
  const deck = generatePart('plate', { length: deckLength, width: 0.1, thickness: 0.006 }, 'bridge-deck');
  deck.geometry = [
    ...deck.geometry.map((item) => ({ ...item, color: '#45586a' })),
    piece({ kind: 'box', size: [0.13, 0.001, 0.003] }, [0, 0.0035, 0], '#ffcc63', 'decor', undefined, { collide: false }),
    ...[-0.046, 0.046].map((z) => piece({ kind: 'box', size: [0.13, 0.007, 0.005] }, [0, 0.006, z], '#35bcb8', 'decor', undefined, { collide: false })),
  ];
  const mountX = deckLength / 2 - outputDistance;
  deck.connectors.push(
    { id: 'bell_left', position: [-mountX, 0, bellCrankZ + halfThickness], axis: [0, 0, 1], kind: 'fixed' },
    { id: 'bell_right', position: [mountX, 0, bellCrankZ - halfThickness], axis: [0, 0, 1], kind: 'fixed' },
  );
  const link = generatePart('link', { length: Math.hypot(hingeX, inputHeight - crossheadHeight), width: 0.012, thickness: 0.004 }, 'bridge-tie-rod');
  const crosshead = generatePart('block', { length: 0.024, width: 0.012, height: 0.012, density: 700 }, 'bridge-crosshead');
  crosshead.connectors = [
    { id: 'left', position: [0, 0, halfThickness], axis: [0, 0, 1], kind: 'revolute' },
    { id: 'right', position: [0, 0, -halfThickness], axis: [0, 0, 1], kind: 'revolute' },
    { id: 'slide', position: [0, 0, 0], axis: [0, -1, 0], kind: 'prismatic' },
  ];
  const fixtureParts = new Map<string, PartDefinition>([base, tower, deck, link, crosshead].map((part) => [part.id, part]));
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [0, 0.0035, 0], anchored: true },
    { op: 'place', id: 'ram_foot', part: 'block-40', position: [0, 0.02, bellCrankZ], anchored: true },
    { op: 'place', id: 'ram', part: 'actuator-50', position: [0, crossheadHeight - 0.045, bellCrankZ], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'crosshead', part: crosshead.id, position: [0, crossheadHeight, bellCrankZ] },
    { op: 'connect', a: 'ram', a_connector: 'rod', b: 'crosshead', b_connector: 'slide', joint: 'prismatic', limits: [-0.05, 0], motor: { controlId: 'open_bridge', stiffness: 2600, damping: 10 } },
  ];

  for (const [side, direction] of [['left', -1], ['right', 1]] as const) {
    const x = direction * hingeX;
    const pinZ = bellCrankZ - direction * halfThickness;
    const supportZ = bellCrankZ + direction * halfThickness - axleZ;
    const tieRodAngle = Math.atan2(inputHeight - crossheadHeight, x) * 180 / Math.PI;
    ops.push(
      { op: 'place', id: `${side}_tower`, part: tower.id, position: [x, 0, supportZ], anchored: true },
      { op: 'place', id: `${side}_bell`, part: bellCrank.id, position: [x, hingeHeight, bellCrankZ], rotation_deg: [direction === 1 ? 180 : 0, 0, -90] },
      { op: 'connect', a: `${side}_tower`, a_connector: 'axle', b: `${side}_bell`, b_connector: 'pivot', joint: 'revolute', limits: direction === -1 ? [0, Math.PI / 2] : [-Math.PI / 2, 0] },
      { op: 'place', id: `${side}_deck`, part: deck.id, label: `${side} deck leaf`, position: [x - direction * deckLength / 2, hingeHeight, 0] },
      { op: 'connect', a: `${side}_bell`, a_connector: 'output', b: `${side}_deck`, b_connector: `bell_${side}`, joint: 'fixed' },
      { op: 'place', id: `${side}_link`, part: link.id, position: [x / 2, (crossheadHeight + inputHeight) / 2, pinZ - link.params.thickness / 2], rotation_deg: [0, 0, tieRodAngle] },
      { op: 'connect', a: 'crosshead', a_connector: side, b: `${side}_link`, b_connector: 'pivot_a', joint: 'revolute' },
      { op: 'connect', a: `${side}_link`, a_connector: 'pivot_b', b: `${side}_bell`, b_connector: 'input', joint: 'revolute' },
    );
  }

  return setDrives(applyOps(emptyAssembly(), ops, (id) => fixtureParts.get(id) ?? getPart(id)).assembly, [
    { controlId: 'open_bridge', mode: 'position', rampIn_s: 0.25, profile: { kind: 'sine', offset: -0.024, amplitude: 0.024, phase: Math.PI / 2, frequency_hz: 0.12 } },
  ]);
}

export function measureTwinDrawbridge(result: TestResult) {
  return leaves.map((leaf) => {
    const angles = result.trace.frames.map((frame) => tiltDeg(frame.bodies[leaf].rotation));
    return { leaf, peakAngle_deg: Math.max(...angles), endAngle_deg: angles.at(-1) ?? 0 };
  });
}

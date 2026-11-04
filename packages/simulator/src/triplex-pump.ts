import { applyOps, emptyAssembly, generatePart, getPart, setDrives, transformPoint, quatFromAxisAngle, type AssemblyOp } from '@protolab/parts';
import type { TestResult, TestSpec, Vec3 } from '@protolab/schema';

const crankHeight = 0.09;
const crankSpacing = 0.075;
const cylinderHeight = 0.3195;
const halfRodLength = 0.05;
const shaftSpeed = 4;

export const triplexPumpTest: TestSpec = {
  kind: 'motion', id: 'triplex_pump_cycles', duration_s: 6,
  measure: {
    joints: ['shaft_spin'], base: 'base', clearancePairs: [],
    noGroundContact: ['piston_1', 'piston_2', 'piston_3'],
    followerTiming: {
      shaft: 'shaft_spin', followers: ['piston_1', 'piston_2', 'piston_3'], axis: 'y',
      minCycles: 2, minStroke_m: 0.038, minPhaseGap_deg: 110, maxPhaseGap_deg: 130,
    },
    linearTravel: [1, 2, 3].map((number) => ({ instance: `piston_${number}`, axis: 'y' as const, minTravel_m: 0.038 })),
  },
  criteria: { minRevolutions: 3, maxBaseTilt_deg: 2, torqueWithinRating: true },
};

export function buildTriplexPump() {
  const base = generatePart('plate', { length: 0.48, width: 0.22, thickness: 0.005 }, 'pump-base');
  const post = generatePart('beam', { length: 0.307, width: 0.015, height: 0.015 }, 'pump-frame-post');
  const pedestal = generatePart('beam', { length: 0.067, width: 0.038, height: 0.04 }, 'pump-motor-pedestal');
  const frameParts = new Map([base, post, pedestal].map((part) => [part.id, part]));
  const disc = getPart('eccentric-disc-70')!;
  const clevis = getPart('clevis-12')!;
  const pin = disc.connectors.find((connector) => connector.id === 'pin')!;
  const clevisPin = clevis.connectors.find((connector) => connector.id === 'pin')!;
  const clevisMount = clevis.connectors.find((connector) => connector.id === 'mount')!;
  const halfLinkLength = getPart('link-80')!.params.length / 2;
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [0, 0.0025, -0.035], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'motor_stand', part: pedestal.id, position: [0, 0.0385, -0.21], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'post_left', part: post.id, position: [-0.019, 0.1585, -0.121], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'post_right', part: post.id, position: [-0.019, 0.1585, 0.145], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'header', part: 'beam-300', position: [-0.019, cylinderHeight, 0.012], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'motor', part: 'gearmotor-37', position: [0, crankHeight, -0.21], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'shaft', part: 'axle-10x300', position: [0, crankHeight, 0], rotation_deg: [0, -90, 0] },
    { op: 'connect', a: 'motor', a_connector: 'shaft', b: 'shaft', b_connector: 'end_a', joint: 'revolute', motor: { controlId: 'shaft_spin', stiffness: 0.2, damping: 0.15 } },
    { op: 'place', id: 'flywheel', part: 'flywheel-100', position: [0, crankHeight, 0.15] },
    { op: 'connect', a: 'shaft', a_connector: 'end_b', b: 'flywheel', b_connector: 'bore', joint: 'fixed' },
  ];

  for (let index = 0; index < 3; index++) {
    const number = index + 1;
    const z = (index - 1) * crankSpacing;
    const angle = index * 120;
    const discCenter: Vec3 = [0, crankHeight, z];
    const lower = transformPoint({ position: discCenter, rotation: quatFromAxisAngle([0, 0, 1], angle * Math.PI / 180) }, pin.position);
    const upper: Vec3 = [0, lower[1] + Math.sqrt((2 * halfLinkLength) ** 2 - lower[0] ** 2), lower[2]];
    const linkAngle = Math.atan2(upper[1] - lower[1], upper[0] - lower[0]) * 180 / Math.PI;
    const clevisOrigin: Vec3 = [upper[0] + clevisPin.position[0], upper[1] + clevisPin.position[1], upper[2] - clevisPin.position[2]];
    const rodBottom = transformPoint({ position: clevisOrigin, rotation: quatFromAxisAngle([0, 0, 1], Math.PI) }, clevisMount.position);
    ops.push(
      { op: 'place', id: `eccentric_${number}`, part: disc.id, label: `Eccentric ${number} · ${angle}°`, position: discCenter, rotation_deg: [0, 0, angle] },
      { op: 'connect', a: 'shaft', a_connector: ['hub_a', 'hub_mid', 'hub_b'][index], b: `eccentric_${number}`, b_connector: 'shaft', joint: 'fixed' },
      { op: 'place', id: `link_${number}`, part: 'link-80', position: [(lower[0] + upper[0]) / 2, (lower[1] + upper[1]) / 2, lower[2] - 0.002], rotation_deg: [0, 0, linkAngle] },
      { op: 'connect', a: `eccentric_${number}`, a_connector: 'pin', b: `link_${number}`, b_connector: 'pivot_a', joint: 'revolute' },
      { op: 'place', id: `clevis_${number}`, part: clevis.id, position: clevisOrigin, rotation_deg: [0, 0, 180] },
      { op: 'connect', a: `link_${number}`, a_connector: 'pivot_b', b: `clevis_${number}`, b_connector: 'pin', joint: 'revolute' },
      { op: 'place', id: `piston_${number}`, part: 'rod-100', label: `Piston rod ${number}`, position: [rodBottom[0], rodBottom[1] + halfRodLength, rodBottom[2]], rotation_deg: [0, 0, 90] },
      { op: 'connect', a: `piston_${number}`, a_connector: 'end_a', b: `clevis_${number}`, b_connector: 'mount', joint: 'fixed' },
      { op: 'place', id: `cylinder_${number}`, part: 'cylinder-20x50', label: `Cylinder ${number}`, position: [rodBottom[0], cylinderHeight, rodBottom[2]], rotation_deg: [0, 0, -90], anchored: true },
      { op: 'connect', a: `cylinder_${number}`, a_connector: 'rod', b: `piston_${number}`, b_connector: 'end_b', joint: 'prismatic' },
    );
  }
  return setDrives(applyOps(emptyAssembly(), ops, (id) => frameParts.get(id) ?? getPart(id)).assembly, [
    { controlId: 'shaft_spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: shaftSpeed } },
  ]);
}

export function measureTriplexPump(result: TestResult) {
  const active = result.trace.frames.filter(({ joints }) => joints.shaft_spin >= Math.PI && joints.shaft_spin <= 3 * Math.PI);
  const measurements = [1, 2, 3].map((piston) => {
    const getHeight = (frame: typeof active[number]) => frame.bodies[`piston_${piston}`].position[1];
    if (!active.length) return { piston, stroke_m: 0, peakAngle_rad: 0 };
    const peak = active.reduce((best, frame) => getHeight(frame) > getHeight(best) ? frame : best);
    return { piston, stroke_m: getHeight(peak) - Math.min(...active.map(getHeight)), peakAngle_rad: peak.joints.shaft_spin % (2 * Math.PI) };
  });
  const peaks = measurements.map(({ peakAngle_rad }) => peakAngle_rad).sort((a, b) => a - b);
  const phaseGaps_deg = peaks.map((peak, index) => ((peaks[(index + 1) % 3] - peak + 2 * Math.PI) % (2 * Math.PI)) * 180 / Math.PI);
  return { measurements, phaseGaps_deg };
}

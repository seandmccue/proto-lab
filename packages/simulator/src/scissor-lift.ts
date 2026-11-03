import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, type AssemblyOp } from '@protolab/parts';
import type { PartDefinition, TestSpec } from '@protolab/schema';

const span = 0.17;
const armLength = 0.2;
const armThickness = 0.006;
const armSeparation = armThickness / 2;
const lowerPivotY = 0.028;
const upperPivotY = lowerPivotY + Math.sqrt(armLength ** 2 - span ** 2);
const leftX = -span / 2;
const rightX = span / 2;
const angle = Math.acos(span / armLength) * 180 / Math.PI;

export const scissorLiftTest: TestSpec = {
  kind: 'motion',
  id: 'scissor_lift_cycle',
  duration_s: 8.5,
  measure: {
    joints: ['lift'],
    base: 'base',
    clearancePairs: [['platform', 'base']],
    noGroundContact: ['platform', 'front_arm', 'rear_arm'],
    uprightInstances: ['platform'],
    linearTravel: [{ instance: 'platform', axis: 'y', minTravel_m: 0.045 }],
  },
  criteria: { maxBaseTilt_deg: 1, maxInstanceTilt_deg: 2, torqueWithinRating: true },
};

export function buildScissorLift() {
  const base = generatePart('plate', { length: 0.34, width: 0.15, thickness: 0.008 }, 'lift-base');
  const platform = generatePart('plate', { length: 0.22, width: 0.135, thickness: 0.008 }, 'lift-platform');
  const arm = generatePart('link', { length: armLength, width: 0.016, thickness: armThickness }, 'lift-arm');
  const shoe = generatePart('carriage', { size: 0.024 }, 'lift-carriage');
  const actuator = getPart('actuator-50')!;
  const rodX = actuator.connectors.find((connector) => connector.id === 'rod')!.position[0];
  base.connectors.push({ id: 'hinge', position: [leftX - 0.03, lowerPivotY - 0.004, 0], axis: [0, 0, 1], kind: 'revolute' });
  platform.connectors.push(
    { id: 'hinge', position: [leftX, -0.018, 0], axis: [0, 0, 1], kind: 'revolute' },
    { id: 'slide', position: [rightX, -0.018, 0], axis: [1, 0, 0], kind: 'prismatic' },
  );
  arm.connectors.push(
    { id: 'cross_pin', position: [0, 0, armSeparation], axis: [0, 0, 1], kind: 'revolute' },
    { id: 'cross_pin_back', position: [0, 0, -armSeparation], axis: [0, 0, -1], kind: 'revolute' },
  );
  shoe.connectors.push(
    { id: 'hinge', position: [0, 0, 0], axis: [0, 0, 1], kind: 'revolute' },
    { id: 'slide', position: [0, 0, 0], axis: [1, 0, 0], kind: 'prismatic' },
  );
  base.geometry.push(
    piece({ kind: 'box', size: [0.022, 0.022, 0.025] }, [leftX - 0.03, 0.015, 0], '#34516a'),
    piece({ kind: 'box', size: [0.095, 0.005, 0.025] }, [0.015, 0.01, 0], '#34516a'),
  );
  platform.geometry = [
    ...platform.geometry.map((shape) => ({ ...shape, color: '#35a99b' })),
    piece({ kind: 'box', size: [0.022, 0.017, 0.024] }, [leftX, -0.010, 0], '#34516a'),
    piece({ kind: 'box', size: [0.084, 0.008, 0.023] }, [rightX - 0.032, -0.010, 0], '#34516a'),
    ...[-0.062, 0.062].map((z) => piece({ kind: 'box', size: [0.205, 0.004, 0.006] }, [0, 0.006, z], '#f5bc5a', 'decor', undefined, { collide: false })),
  ];
  arm.geometry = arm.geometry.map((shape) => ({ ...shape, color: '#f28c1d' }));

  const parts = new Map<string, PartDefinition>([base, platform, arm, shoe, actuator].map((part) => [part.id, part]));
  const centerY = (lowerPivotY + upperPivotY) / 2;
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [0.03, 0.004, 0], anchored: true },
    { op: 'place', id: 'actuator', part: actuator.id, position: [rightX + rodX, lowerPivotY, 0], rotation_deg: [0, 0, 180], anchored: true },
    { op: 'place', id: 'lower_shoe', part: shoe.id, label: 'Powered lower carriage', position: [rightX, lowerPivotY, 0] },
    { op: 'place', id: 'upper_shoe', part: shoe.id, label: 'Passive upper carriage', position: [rightX, upperPivotY, 0] },
    { op: 'place', id: 'platform', part: platform.id, label: 'Lift platform', position: [0, upperPivotY + 0.018, 0] },
    { op: 'place', id: 'front_arm', part: arm.id, label: 'Rising scissor arm', position: [0, centerY, armSeparation], rotation_deg: [0, 0, angle] },
    { op: 'place', id: 'rear_arm', part: arm.id, label: 'Falling scissor arm', position: [0, centerY, -armSeparation], rotation_deg: [0, 0, -angle] },
    { op: 'connect', a: 'actuator', a_connector: 'rod', b: 'lower_shoe', b_connector: 'slide', joint: 'prismatic', limits: [0, 0.05], motor: { controlId: 'lift', stiffness: 2600, damping: 10 } },
    { op: 'connect', a: 'base', a_connector: 'hinge', b: 'front_arm', b_connector: 'pivot_a_back', joint: 'revolute' },
    { op: 'connect', a: 'rear_arm', a_connector: 'cross_pin', b: 'front_arm', b_connector: 'cross_pin_back', joint: 'revolute' },
    { op: 'connect', a: 'lower_shoe', a_connector: 'hinge', b: 'rear_arm', b_connector: 'pivot_b', joint: 'revolute' },
    { op: 'connect', a: 'platform', a_connector: 'hinge', b: 'rear_arm', b_connector: 'pivot_a', joint: 'revolute' },
    { op: 'connect', a: 'platform', a_connector: 'slide', b: 'upper_shoe', b_connector: 'slide', joint: 'prismatic', limits: [-0.052, 0] },
    { op: 'connect', a: 'upper_shoe', a_connector: 'hinge', b: 'front_arm', b_connector: 'pivot_b_back', joint: 'revolute' },
  ];
  return setDrives(applyOps(emptyAssembly(), ops, (id) => parts.get(id)).assembly, [
    { controlId: 'lift', mode: 'position', rampIn_s: 0.25, profile: { kind: 'sine', offset: 0.024, amplitude: 0.024, phase: -Math.PI / 2, frequency_hz: 0.125 } },
  ]);
}

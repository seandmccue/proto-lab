import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, shapeVolume, type AssemblyOp } from '@protolab/parts';
import type { Assembly, PartDefinition, TestSpec, Vec3 } from '@protolab/schema';

const marbleRadius = 0.012;
const receiverFloor = 0.003;
const receiverInsideX = 0.072;
const receiverInsideZ = 0.066;

export const marbleElevatorEndIn = {
  instance: 'marble',
  receiver: 'catcher',
  centerOffset_m: [0, receiverFloor + marbleRadius, 0] as Vec3,
  halfExtents_m: [receiverInsideX - marbleRadius, 0.004, receiverInsideZ - marbleRadius] as Vec3,
  minHold_s: 0.75,
};

export const marbleElevatorTest: TestSpec = {
  kind: 'motion', id: 'elevate_and_deliver', duration_s: 9,
  measure: {
    joints: ['lift', 'tip'],
    payload: { instance: 'marble' },
    linearTravel: [{ instance: 'marble', axis: 'x', minTravel_m: 0.12 }],
    endIn: marbleElevatorEndIn,
    clearancePairs: [],
    noGroundContact: ['marble'],
  },
  criteria: { minPayloadLift_m: 0.10, torqueWithinRating: true },
};

export function buildMarbleElevator(tipEnabled = true): Assembly {
  const liftBase: Vec3 = [0.08, 0.004, 0];
  const navy = '#263f59', steel = '#a4b7c7', gold = '#e9a43c', mint = '#2baea0';
  const base = generatePart('plate', { length: 0.40, width: 0.27, thickness: 0.008 }, 'marble-elevator-base');
  base.name = 'Marble elevator plinth and supports';
  base.geometry[0].color = navy;

  const actuator = structuredClone(getPart('actuator-150')!);
  actuator.geometry[0].color = '#476782';
  const servo = structuredClone(getPart('servo-mg996r')!);
  servo.id = 'marble-elevator-tip-carriage';
  servo.name = 'Tip servo and telescoping lift rod';
  servo.geometry[0].color = navy;
  // The lift rod is attached to the moving servo, so it visibly telescopes into the stationary casing.
  servo.geometry.push(piece({ kind: 'cylinder', radius: 0.0035, height: 0.145, axis: 'y' }, [0, -0.090, 0], steel));
  servo.mass_kg += Math.PI * 0.0035 ** 2 * 0.145 * 7850;
  servo.dimensions_m[1] = 0.1805;

  const bucket = structuredClone(getPart('tray-45')!);
  bucket.id = 'marble-elevator-bucket';
  bucket.name = 'Open-sided tip bucket';
  // Remove the three wall segments around +X. The floor and other walls retain real collision geometry.
  bucket.geometry = bucket.geometry.filter((_, index) => index !== 1 && index !== 2 && index !== 10);
  bucket.geometry.forEach((shape) => { shape.color = gold; });
  bucket.connectors.push({ id: 'pivot', position: [0, 0, -0.040], axis: [0, 0, -1], kind: 'revolute' });

  const marble = generatePart('ball', { radius: marbleRadius, density: 850 }, 'elevator-loose-marble');
  marble.name = 'Loose 24 mm marble';
  marble.geometry[0].color = '#e34c78';

  const ramp = generatePart('plate', { length: 0.145, width: 0.060, thickness: 0.005 }, 'marble-gravity-chute');
  ramp.name = 'Gravity chute with raised rails';
  ramp.geometry[0].color = '#4e79a9';
  ramp.geometry.push(...[-0.028, 0.028].map((z) =>
    piece({ kind: 'box', size: [0.145, 0.022, 0.004] }, [0, 0.013, z], '#86abc8')));
  const catcher = generatePart('plate', { length: 0.148, width: 0.136, thickness: receiverFloor }, 'marble-catch-bin');
  catcher.name = 'Open-entry catch bin';
  catcher.geometry = [
    piece({ kind: 'box', size: [0.148, receiverFloor, 0.136] }, [0, receiverFloor / 2, 0], mint),
    piece({ kind: 'box', size: [0.004, 0.045, 0.136] }, [0.074, receiverFloor + 0.0225, 0], mint),
    ...[-0.068, 0.068].map((z) => piece({ kind: 'box', size: [0.148, 0.045, 0.004] }, [0, receiverFloor + 0.0225, z], mint)),
  ];
  catcher.mass_kg = catcher.geometry.reduce((mass, shape) => mass + shapeVolume(shape.shape) * 2700, 0);
  catcher.dimensions_m = [0.150, 0.048, 0.140];

  const parts = new Map<string, PartDefinition>([base, actuator, servo, bucket, marble, ramp, catcher].map((part) => [part.id, part]));
  const resolve = (id: string) => parts.get(id) ?? getPart(id);
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: liftBase, anchored: true },
    { op: 'place', id: 'actuator', part: actuator.id, position: [0, 0.13, 0], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'mount', id: 'carriage', part: servo.id, onto: 'actuator', connector: 'rod', via: 'bottom', joint: 'prismatic', limits: [0, 0.15],
      spin_deg: 0, offset_m: 0, motor: { controlId: 'lift', stiffness: 1300, damping: 11 } },
    { op: 'mount', id: 'bucket', part: bucket.id, onto: 'carriage', connector: 'horn', via: 'pivot', joint: 'revolute',
      spin_deg: 0, offset_m: 0, motor: { controlId: 'tip', stiffness: 12, damping: 0.55 } },
    { op: 'mount', id: 'marble', part: marble.id, onto: 'bucket', connector: 'payload', via: 'bottom', joint: 'free', spin_deg: 0, offset_m: 0 },
  ];
  const lifted = applyOps(emptyAssembly(), ops, resolve).assembly;
  const z = lifted.instances.find((instance) => instance.id === 'bucket')!.transform.position[2];
  const supports = [
    { x: -0.031, z: -0.033, y: 0.382 }, { x: 0.031, z: -0.033, y: 0.382 },
    { x: 0.071, z: z - 0.021, y: 0.323 }, { x: 0.156, z: z - 0.021, y: 0.289 },
    { x: 0.155, z: z + 0.046, y: 0.269 }, { x: 0.248, z: z + 0.046, y: 0.269 },
    { x: 0.248, z: z - 0.046, y: 0.269 },
  ];
  const basePart = lifted.parts.find((part) => part.id === base.id)!;
  for (const support of supports) {
    const length = support.y - 0.008;
    basePart.geometry.push(piece({ kind: 'box', size: [0.009, length, 0.009] },
      [support.x - liftBase[0], length / 2 + 0.008 - liftBase[1], support.z], '#59758d', 'decor', undefined, { collide: false }));
  }
  basePart.geometry.push(piece({ kind: 'box', size: [0.072, 0.008, 0.01] }, [-liftBase[0], 0.378 - liftBase[1], -0.033],
    steel, 'decor', undefined, { collide: false }));

  const assembly = applyOps(lifted, [
    { op: 'place', id: 'ramp', part: ramp.id, position: [0.114, 0.310, z], rotation_deg: [0, 0, -22], anchored: true },
    { op: 'place', id: 'catcher', part: catcher.id, position: [0.20, 0.269, z], anchored: true },
  ], resolve).assembly;
  return setDrives(assembly, [
    { controlId: 'lift', mode: 'position', rampIn_s: 0, profile: { kind: 'ramp', from: 0, to: 0.12, start_s: 0.25, duration_s: 2.5 } },
    { controlId: 'tip', mode: 'position', rampIn_s: 0, profile: { kind: 'ramp', from: 0, to: tipEnabled ? -1.3 : 0, start_s: 4, duration_s: 1.25 } },
  ]);
}

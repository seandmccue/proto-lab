import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, type AssemblyOp } from '@protolab/parts';
import { measureFollowerTiming } from './follower-timing.ts';
import type { TestResult, TestSpec } from '@protolab/schema';

const shaftHeight = 0.085;
const coreRadius = 0.037;
const followerY = shaftHeight + coreRadius + 0.005;
const followerTiming = {
  shaft: 'cam_spin', followers: ['amber_flag', 'teal_flag'] as [string, string], axis: 'y' as const,
  minCycles: 3, minStroke_m: 0.016, minLowDwell_s: 1.05, minPhaseGap_deg: 165,
};
const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

export const camSemaphoreTest: TestSpec = {
  kind: 'motion', id: 'cam_semaphore_stroke', duration_s: 9,
  measure: {
    joints: ['cam_spin'], base: 'base', clearancePairs: [], noGroundContact: ['amber_flag', 'teal_flag'],
    followerTiming,
    linearTravel: followerTiming.followers.map((instance) => ({ instance, axis: 'y', minTravel_m: 0.016 })),
  },
  criteria: { minRevolutions: 3, maxBaseTilt_deg: 1, torqueWithinRating: true },
};
export const camSemaphoreEnvironment = env;

export function buildCamSemaphore(options: { lobesCollide?: boolean } = {}) {
  const motor = getPart('gearmotor-37')!;
  const nose = motor.connectors.find(({ id }) => id === 'shaft')!.position[0];
  const base = generatePart('plate', { length: 0.22, width: 0.24, thickness: 0.006 }, 'semaphore-base');
  const stand = generatePart('beam', { length: 0.19, width: 0.014, height: 0.014 }, 'semaphore-stand');
  const guide = getPart('follower-guide-9')!;
  const follower = getPart('cam-follower-98')!;
  const catalogCam = getPart('eccentric-cam-74')!;
  const cam = options.lobesCollide === false
    ? { ...catalogCam, geometry: catalogCam.geometry.map((piece, index) => index === 1 ? { ...piece, collide: false } : piece) }
    : catalogCam;
  const shaft = generatePart('plate', { length: 0.02, width: 0.15, thickness: 0.015 }, 'semaphore-camshaft');
  shaft.geometry = [piece({ kind: 'cylinder', radius: 0.009, height: 0.15, axis: 'z' }, [0, 0, 0], '#344661')];
  shaft.dimensions_m = [0.018, 0.018, 0.15];
  shaft.mass_kg = 0.035;
  shaft.connectors = [
    { id: 'drive', position: [0, 0, -0.075], axis: [0, 0, -1], kind: 'revolute' },
    { id: 'cam_near', position: [0, 0, -0.047], axis: [0, 0, 1], kind: 'fixed' },
    { id: 'cam_far', position: [0, 0, 0.033], axis: [0, 0, 1], kind: 'fixed' },
  ];
  const flags = ['#ef9f32', '#189c93'].map((color, index) => {
    const flag = generatePart('plate', { length: 0.053, width: 0.033, thickness: 0.008 }, 'semaphore-sign-' + index);
    flag.mass_kg = 0.008;
    flag.geometry = [
      piece({ kind: 'box', size: [0.053, 0.033, 0.008] }, [0.022, 0, 0], color, 'decor', undefined, { collide: false }),
      ...[-0.0045, 0.0045].map((z) => piece({ kind: 'box', size: [0.026, 0.004, 0.001] }, [0.022, 0.001, z], '#f9edcf', 'decor', undefined, { collide: false })),
    ];
    flag.connectors = [{ id: 'stem', position: [0, -0.005, 0], axis: [0, -1, 0], kind: 'fixed' }];
    return flag;
  });
  const parts = new Map([base, stand, guide, follower, cam, shaft, motor, ...flags].map((part) => [part.id, part]));
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [0, 0.003, 0], anchored: true },
    { op: 'place', id: 'motor', part: motor.id, position: [0, shaftHeight, -0.075 - nose], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'camshaft', part: shaft.id, label: 'Powered shaft', position: [0, shaftHeight, 0] },
    { op: 'connect', a: 'motor', a_connector: 'shaft', b: 'camshaft', b_connector: 'drive', joint: 'revolute', motor: { controlId: 'cam_spin', stiffness: 0.24, damping: 0.12 } },
  ];
  const guideHeight = followerY + follower.connectors.find(({ id }) => id === 'slide')!.position[1];
  for (const [index, id] of followerTiming.followers.entries()) {
    const z = index === 0 ? -0.04 : 0.04;
    const camId = index === 0 ? 'cam_near' : 'cam_far';
    ops.push(
      { op: 'place', id: camId, part: cam.id, position: [0, shaftHeight, z], rotation_deg: [0, 0, 180 * index] },
      { op: 'connect', a: 'camshaft', a_connector: camId, b: camId, b_connector: 'shaft', joint: 'fixed' },
      { op: 'place', id: 'stand_' + index, part: stand.id, position: [-0.063, 0.101, z - 0.017], rotation_deg: [0, 0, 90], anchored: true },
      { op: 'place', id: 'guide_' + index, part: guide.id, position: [0, guideHeight, z], anchored: true },
      { op: 'place', id, part: follower.id, label: index === 0 ? 'Amber flag follower' : 'Teal flag follower', position: [0, followerY, z], free: true },
      { op: 'connect', a: 'guide_' + index, a_connector: 'guide', b: id, b_connector: 'slide', joint: 'prismatic' },
      { op: 'mount', id: 'flag_' + index, part: flags[index].id, onto: id, connector: 'mount', via: 'stem', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    );
  }
  const { assembly } = applyOps(emptyAssembly(), ops, (id) => parts.get(id));
  return setDrives(assembly, [{ controlId: 'cam_spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 3 } }]);
}

export function measureCamSemaphore(result: TestResult) {
  return measureFollowerTiming(result.trace, followerTiming);
}

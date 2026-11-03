import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, type AssemblyOp } from '@protolab/parts';
import type { TestResult, TestSpec } from '@protolab/schema';

const shaftHeight = 0.085;
const coreRadius = 0.037;
const lobeRadius = 0.025;
const eccentricity = 0.031;
const followerY = shaftHeight + coreRadius + 0.005;
const revolution = 2 * Math.PI;
const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

export const camSemaphoreTest: TestSpec = {
  kind: 'motion', id: 'cam_semaphore_stroke', duration_s: 9,
  measure: {
    joints: ['cam_spin'], base: 'base', clearancePairs: [], noGroundContact: ['amber_flag', 'teal_flag'],
    linearTravel: ['amber_flag', 'teal_flag'].map((instance) => ({ instance, axis: 'y', minTravel_m: 0.016 })),
  },
  criteria: { minRevolutions: 3, maxBaseTilt_deg: 1, torqueWithinRating: true },
};
export const camSemaphoreEnvironment = env;

export function buildCamSemaphore(options: { lobesCollide?: boolean } = {}) {
  const motor = getPart('gearmotor-37')!;
  const nose = motor.connectors.find(({ id }) => id === 'shaft')!.position[0];
  const base = generatePart('plate', { length: 0.22, width: 0.24, thickness: 0.006 }, 'semaphore-base');
  const stand = generatePart('beam', { length: 0.19, width: 0.014, height: 0.014 }, 'semaphore-stand');
  const guide = generatePart('beam', { length: 0.09, width: 0.012, height: 0.012 }, 'semaphore-guide');
  const cam = generatePart('plate', { length: 0.14, width: 0.13, thickness: 0.015 }, 'semaphore-camshaft');
  cam.mass_kg = 0.07;
  cam.geometry = [
    piece({ kind: 'cylinder', radius: 0.009, height: 0.15, axis: 'z' }, [0, 0, 0], '#344661'),
    ...[[-0.04, 1], [0.04, -1]].flatMap(([z, sign]) => [
      piece({ kind: 'cylinder', radius: coreRadius, height: 0.014, axis: 'z' }, [0, 0, z], '#586c84'),
      piece({ kind: 'cylinder', radius: lobeRadius, height: 0.014, axis: 'z' }, [sign * eccentricity, 0, z], sign > 0 ? '#ec982e' : '#129e96', 'structure', undefined, { collide: options.lobesCollide !== false }),
    ]),
  ];
  cam.connectors = [{ id: 'drive', position: [0, 0, -0.075], axis: [0, 0, -1], kind: 'revolute' }];
  const flags = ['#ef9f32', '#189c93'].map((color, index) => {
    const flag = generatePart('plate', { length: 0.098, width: 0.019, thickness: 0.008 }, 'semaphore-flag-' + index);
    flag.mass_kg = 0.028;
    flag.geometry = [
      piece({ kind: 'box', size: [0.098, 0.01, 0.019] }, [0, 0, 0], '#344661'),
      piece({ kind: 'box', size: [0.009, 0.057, 0.009] }, [0, 0.033, 0], '#344661', 'decor', undefined, { collide: false }),
      piece({ kind: 'box', size: [0.053, 0.033, 0.008] }, [0.022, 0.067, 0], color, 'decor', undefined, { collide: false }),
      ...[-0.0045, 0.0045].map((z) => piece({ kind: 'box', size: [0.026, 0.004, 0.001] }, [0.022, 0.068, z], '#f9edcf', 'decor', undefined, { collide: false })),
    ];
    flag.connectors = [{ id: 'slide', position: [0, 0.033, 0], axis: [0, 1, 0], kind: 'prismatic' }];
    return flag;
  });
  // Show the offset mounting bracket and the sliding bushing behind the moving rod.
  guide.geometry = [
    piece({ kind: 'box', size: [0.064, 0.009, 0.011] }, [-0.031, 0.004, -0.017], '#586c84', 'decor', undefined, { collide: false }),
    piece({ kind: 'box', size: [0.013, 0.009, 0.019] }, [0, 0.004, -0.008], '#586c84', 'decor', undefined, { collide: false }),
    piece({ kind: 'cylinder', radius: 0.008, height: 0.014, axis: 'y' }, [0, 0.004, 0], '#899ab0', 'decor', undefined, { collide: false }),
  ];
  guide.connectors = [{ id: 'guide', position: [0, 0, 0], axis: [0, 1, 0], kind: 'prismatic' }];
  const parts = new Map([base, stand, guide, cam, motor, ...flags].map((part) => [part.id, part]));
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [0, 0.003, 0], anchored: true },
    { op: 'place', id: 'motor', part: motor.id, position: [0, shaftHeight, -0.075 - nose], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'camshaft', part: cam.id, label: 'One shaft · two opposite cams', position: [0, shaftHeight, 0] },
    { op: 'connect', a: 'motor', a_connector: 'shaft', b: 'camshaft', b_connector: 'drive', joint: 'revolute', motor: { controlId: 'cam_spin', stiffness: 0.24, damping: 0.12 } },
  ];
  for (const [index, id] of ['amber_flag', 'teal_flag'].entries()) {
    const z = index === 0 ? -0.04 : 0.04;
    ops.push(
      { op: 'place', id: 'stand_' + index, part: stand.id, position: [-0.062, 0.101, z - 0.017], rotation_deg: [0, 0, 90], anchored: true },
      { op: 'place', id: 'guide_' + index, part: guide.id, position: [0, followerY + 0.033, z], anchored: true },
      { op: 'place', id, part: flags[index].id, label: index === 0 ? 'Amber signal · passive follower' : 'Teal signal · passive follower', position: [0, followerY, z], free: true },
      { op: 'connect', a: 'guide_' + index, a_connector: 'guide', b: id, b_connector: 'slide', joint: 'prismatic' },
    );
  }
  const { assembly } = applyOps(emptyAssembly(), ops, (id) => parts.get(id));
  return setDrives(assembly, [{ controlId: 'cam_spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 3 } }]);
}

/** Measure low dwell and peak angle over each complete turn after the startup ramp. */
export function measureCamSemaphore(result: TestResult) {
  const frames = result.trace.frames;
  const cycleCount = Math.max(0, Math.floor((frames.at(-1)?.joints.cam_spin ?? 0) / revolution) - 1);
  return Array.from({ length: cycleCount }, (_, cycle) => {
    const startAngle = (cycle + 1) * revolution;
    const active = frames.filter(({ joints }) => joints.cam_spin >= startAngle && joints.cam_spin < startAngle + revolution);
    if (active.length < 2) return undefined;
    const flags = ['amber_flag', 'teal_flag'].map((id) => {
      const ys = active.map(({ bodies }) => bodies[id].position[1]);
      const min = Math.min(...ys), max = Math.max(...ys);
      let contiguous = 0, longest = 0;
      for (const y of [...ys, ...ys]) {
        contiguous = y - min <= 0.001 ? contiguous + 1 : 0;
        longest = Math.min(ys.length, Math.max(contiguous, longest));
      }
      return {
        id, stroke_m: max - min, lowDwell_s: longest * result.trace.dt,
        peakAngle_rad: active[ys.indexOf(max)].joints.cam_spin - startAngle,
      };
    });
    const gap = Math.abs(flags[0].peakAngle_rad - flags[1].peakAngle_rad);
    return { flags, phaseGap_deg: Math.min(gap, revolution - gap) * 180 / Math.PI };
  }).filter((cycle) => cycle !== undefined);
}

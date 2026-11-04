import { emptyAssembly, generatePart, getPart, piece, quatFromAxisAngle, quatMul, rotate, transformPoint } from '@protolab/parts';
import type { Assembly, Instance, Joint, PartDefinition, TestSpec, Transform, Vec3 } from '@protolab/schema';

export const genevaIndexerTest: TestSpec = {
  kind: 'motion', id: 'geneva_contact', duration_s: 10,
  measure: {
    joints: ['spin'], clearancePairs: [], noGroundContact: ['wheel'],
    orbits: [{ body: 'wheel_rim', center: 'center', plane: 'xz', minTurns: 0.45, minRadius_m: 0.032, maxRadius_m: 0.036 }],
    indexedMotion: {
      input: 'spin', body: 'wheel_rim', center: 'center', plane: 'xz', minSteps: 2,
      step_deg: 90, stepTolerance_deg: 8, minDwell_s: 0.6, maxDwellDrift_deg: 3,
    },
  },
  criteria: { minRevolutions: 2, torqueWithinRating: true },
};

export function buildGenevaIndexer(pinCollides = true): Assembly {
  const driver = structuredClone(getPart('geneva-crank-4x60')!);
  const wheel = structuredClone(getPart('geneva-wheel-4x60')!);
  const marker = structuredClone(getPart('marker-tip-8')!);
  const base = generatePart('plate', { length: 0.22, width: 0.15, thickness: 0.012 }, 'geneva-display-base');

  const pin = driver.geometry.find(({ role, shape }) => role === 'contact' && shape.kind === 'cylinder');
  if (!pin) throw new Error('The driver needs a physical pin collider');
  pin.collide = pinCollides;
  // The original witness mass stays at the same measured point. Replacing its non-colliding
  // geometry leaves the same mass-only fallback collider while the four jewels rotate with it.
  const orbitCenter = { ...marker, id: 'geneva-orbit-center', name: 'Orbit center witness', geometry: [] };
  marker.id = 'geneva-index-jewels';
  marker.name = 'Four jewel stations and rim witness';
  marker.description = 'Four display jewels carried by the passive Geneva wheel. The measured witness is fixed to its rim.';
  marker.geometry = [];


  // Construct the catalog parts in their XY reference plane and turn the whole
  // fixture flat. Gravity acts along the shafts and does not turn the wheel.
  const flat = quatFromAxisAngle([1, 0, 0], -Math.PI / 2);
  const position = (point: Vec3): Vec3 => {
    const [x, y, z] = rotate(flat, point);
    return [x, y + 0.14, z];
  };
  const pose = (point: Vec3, angle = 0): Transform => ({
    position: point, rotation: quatFromAxisAngle([0, 0, 1], angle),
  });
  const inputPose = pose([0.06, 0.14, -0.006]);
  const outputPose = pose([0, 0.14, 0], Math.PI / 4);
  const drive = driver.connectors.find(({ id }) => id === 'drive')!;
  const bearing = wheel.connectors.find(({ kind }) => kind === 'revolute')!;
  const inputAnchor = transformPoint(inputPose, drive.position);
  const outputAnchor = transformPoint(outputPose, bearing.position);
  const rim = transformPoint(outputPose, [0.034, 0, 0]);

  const inputAxis: Vec3 = [0, 0, -1];
  const outputAxis: Vec3 = [0, 0, 1];
  const plinth: Vec3 = [0, 0.14, -0.004];
  const plinthOffset = (world: Vec3): Vec3 => world.map((value, index) => value - plinth[index]) as Vec3;
  const displayDepth = position(outputPose.position)[2];
  const supportOffset = ([x, y, z]: Vec3) => plinthOffset([x, y, z + displayDepth]);
  base.name = 'Display plinth, motor housing and shaft supports';
  base.description = 'Anchored plinth with a visible motor housing and two shaft supports beneath the working contact pair.';
  base.geometry[0].color = '#182c46';
  base.geometry[0].offset.position = supportOffset([0.025, 0.006, 0]);
  const trim = (shape: Parameters<typeof piece>[0], world: Vec3, color: string) =>
    piece(shape, supportOffset(world), color, 'decor', undefined, { collide: false });
  base.geometry.push(
    trim({ kind: 'box', size: [0.211, 0.003, 0.142] }, [0.025, 0.0135, 0], '#344e69'),
    trim({ kind: 'box', size: [0.16, 0.005, 0.04] }, [0.027, 0.018, 0], '#8095ad'),
    trim({ kind: 'cylinder', radius: 0.017, height: 0.095, axis: 'y' }, [0.060, 0.068, 0], '#182c46'),
    ...[0.029, 0.038, 0.047, 0.056, 0.065, 0.074].map((y) =>
      trim({ kind: 'cylinder', radius: 0.020, height: 0.003, axis: 'y' }, [0.060, y, 0], '#344e69')),
    trim({ kind: 'cylinder', radius: 0.02, height: 0.008, axis: 'y' }, [0.060, 0.117, 0], '#a8b8c6'),
    trim({ kind: 'cylinder', radius: 0.006, height: 0.012, axis: 'y' }, [0.060, 0.126, 0], '#c49a58'),
    trim({ kind: 'cylinder', radius: 0.015, height: 0.102, axis: 'y' }, [0, 0.071, 0], '#526d85'),
    trim({ kind: 'cylinder', radius: 0.02, height: 0.006, axis: 'y' }, [0, 0.023, 0], '#a8b8c6'),
    trim({ kind: 'cylinder', radius: 0.019, height: 0.006, axis: 'y' }, [0, 0.125, 0], '#a8b8c6'),
    trim({ kind: 'cylinder', radius: 0.006, height: 0.012, axis: 'y' }, [0, 0.132, 0], '#c49a58'),
    trim({ kind: 'box', size: [0.070, 0.002, 0.020] }, [0.025, 0.015, 0.059], '#c49a58'),
  );
  for (const x of [-0.067, 0.117]) for (const z of [-0.057, 0.057]) {
    base.geometry.push(trim({ kind: 'cylinder', radius: 0.005, height: 0.002, axis: 'y' }, [x, 0.015, z], '#c49a58'));
  }
  base.connectors.push(
    { id: 'input', position: plinthOffset(position(inputAnchor)), axis: rotate(flat, inputAxis), kind: 'revolute' },
    { id: 'output', position: plinthOffset(position(outputAnchor)), axis: rotate(flat, outputAxis), kind: 'revolute' },
  );

  const displayColors = ['#ee547a', '#2fd4c9', '#826cf0', '#f6bd43'];
  const displayOffset = (x: number, y: number, z: number): Vec3 => [x - rim[0], outputPose.position[1] + y - rim[1], z];
  marker.geometry.push(
    piece({ kind: 'cylinder', radius: 0.008, height: 0.008, axis: 'z' }, displayOffset(0, 0, 0.009), '#c49a58', 'decor', undefined, { collide: false }),
  );
  for (const [index, color] of displayColors.entries()) {
    const angle = (index + 1) * Math.PI / 2;
    const radial = (radius: number, height: number) => displayOffset(radius * Math.cos(angle), radius * Math.sin(angle), height);
    marker.geometry.push(
      piece({ kind: 'box', size: [0.028, 0.006, 0.004] }, radial(0.015, 0.012), '#c49a58', 'decor', quatFromAxisAngle([0, 0, 1], angle), { collide: false }),
      piece({ kind: 'cylinder', radius: 0.008, height: 0.004, axis: 'z' }, radial(0.030, 0.013), '#c49a58', 'decor', undefined, { collide: false }),
      piece({ kind: 'revolve', profile: [[0, -0.004], [0.007, 0], [0.006, 0.003], [0.003, 0.006], [0, 0.006]], axis: 'z', segments: 8 },
        radial(0.030, 0.018), color, 'decor', undefined, { collide: false }),
    );
  }
  wheel.connectors.push({ id: 'rim', position: [0.034, 0, 0], axis: outputAxis, kind: 'fixed' });

  const instance = (id: string, part: PartDefinition, transform: Transform, flags: { anchored?: boolean; free?: boolean } = {}): Instance => ({
    id, partId: part.id, label: id, transform: { position: position(transform.position), rotation: quatMul(flat, transform.rotation) },
    anchored: flags.anchored ?? false, free: flags.free ?? false,
  });
  const joint = (
    id: string, type: Joint['type'], a: Joint['a'], b: Joint['b'], axis: Vec3, anchor: Vec3, motor?: Joint['motor'],
  ): Joint => ({ id, type, a, b, axis: rotate(flat, axis), anchor: position(anchor), motor });

  return {
    ...emptyAssembly(),
    parts: [base, driver, wheel, marker, orbitCenter],
    instances: [
      { ...instance('base', base, pose([0, 0, 0]), { anchored: true }), label: 'Base, motor housing and shaft supports',
        transform: { position: plinth, rotation: [0, 0, 0, 1] } },
      { ...instance('driver', driver, inputPose), label: 'Driven pin and bronze dwell sector' },
      { ...instance('wheel', wheel, outputPose, { free: true }), label: 'Passive four-slot Geneva wheel' },
      { ...instance('wheel_rim', marker, pose(rim)), label: 'Four jewel stations and rim witness' },
      { ...instance('center', orbitCenter, pose([0, 0.14, 0]), { anchored: true }), label: 'Orbit center witness' },
    ],
    joints: [
      joint('input', 'revolute', { instanceId: 'base', connectorId: 'input' }, { instanceId: 'driver', connectorId: drive.id },
        inputAxis, inputAnchor, { controlId: 'spin', stiffness: 0.35, damping: 0.15, maxTorque_Nm: 2 }),
      joint('output', 'revolute', { instanceId: 'base', connectorId: 'output' }, { instanceId: 'wheel', connectorId: bearing.id },
        outputAxis, outputAnchor),
      joint('rim', 'fixed', { instanceId: 'wheel', connectorId: 'rim' }, { instanceId: 'wheel_rim', connectorId: 'mount' },
        outputAxis, rim),
    ],
    controller: { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.35, profile: { kind: 'constant', value: 1.6 } }] },
  };
}

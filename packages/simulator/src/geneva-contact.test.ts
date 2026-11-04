import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyAssembly, generatePart, getPart, quatFromAxisAngle, quatMul, rotate, transformPoint } from '@protolab/parts';
import type { Assembly, Instance, Joint, PartDefinition, TestSpec, Transform, Vec3 } from '@protolab/schema';
import { runTest } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
const testSpec: TestSpec = {
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

function genevaAssembly(pinCollides: boolean): Assembly {
  const driver = structuredClone(getPart('geneva-crank-4x60')!);
  const wheel = structuredClone(getPart('geneva-wheel-4x60')!);
  const marker = structuredClone(getPart('marker-tip-8')!);
  const base = generatePart('plate', { length: 0.17, width: 0.13, thickness: 0.008 }, 'geneva-fixture-base');

  const pin = driver.geometry.find(({ role, shape }) => role === 'contact' && shape.kind === 'cylinder');
  assert.ok(pin, 'The driver needs a physical pin collider');
  pin.collide = pinCollides;
  for (const geometry of marker.geometry) geometry.collide = false;

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
  base.connectors.push(
    { id: 'input', position: [inputAnchor[0], inputAnchor[1] - 0.004, inputAnchor[2]], axis: inputAxis, kind: 'revolute' },
    { id: 'output', position: [outputAnchor[0], outputAnchor[1] - 0.004, outputAnchor[2]], axis: outputAxis, kind: 'revolute' },
  );
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
    parts: [base, driver, wheel, marker],
    instances: [
      instance('base', base, pose([0, 0.004, 0]), { anchored: true }),
      instance('driver', driver, inputPose),
      instance('wheel', wheel, outputPose, { free: true }),
      instance('wheel_rim', marker, pose(rim)),
      instance('center', marker, pose([0, 0.14, 0]), { anchored: true }),
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

test('a single contact pin physically indexes a passive wheel and holds between steps', async () => {
  const result = await runTest(genevaAssembly(true), { env, test: testSpec });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(result.metrics.indexedConsecutiveSteps >= 2);
  assert.ok(result.metrics['spin.revolutions'] >= 2);
});

test('removing pin contact keeps the input turning but prevents passive indexing', async () => {
  const result = await runTest(genevaAssembly(false), { env, test: testSpec });
  assert.equal(result.passed, false);
  assert.ok(result.metrics['spin.revolutions'] >= 2);
  assert.ok(Math.abs(result.metrics['wheel_rim.orbitSignedTurns']) < 0.01);
  assert.equal(result.metrics.indexedConsecutiveSteps, 0);
});

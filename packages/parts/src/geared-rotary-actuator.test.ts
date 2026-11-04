import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, AssemblyOp, emptyAssembly, generatePart, getPart, searchCatalog, transformPoint } from './index.ts';

const actuatorKind = 'geared_rotary_actuator';

test('geared actuators have solid fitted faces and scale with their simulation ratings', () => {
  const medium = getPart('rotary-actuator-20nm')!;
  const large = getPart('rotary-actuator-40nm')!;
  assert.ok(large.mass_kg > medium.mass_kg);
  assert.ok(large.dimensions_m.every((value, index) => value > medium.dimensions_m[index]));
  const search = searchCatalog('geared rotary actuator', { category: 'actuators' });
  assert.ok(search.some(({ id }) => id === medium.id) && search.some(({ id }) => id === large.id));

  for (const part of [medium, large]) {
    assert.equal(part.kind, actuatorKind);
    assert.deepEqual(part.limits, { maxTorque_Nm: part.params.torque, maxSpeed_rad_s: part.params.speed });
    assert.ok(part.geometry.every(({ collide, role }) => collide && role === 'motor'));
    const [body, flange, horn] = part.geometry;
    assert.equal(body.shape.kind, 'box');
    assert.equal(flange.shape.kind, 'cylinder');
    assert.equal(horn.shape.kind, 'cylinder');
    assert.equal(flange.shape.axis, 'z');
    assert.equal(horn.shape.axis, 'z');
    const [length, height, depth] = body.shape.size;
    const face = horn.offset.position[2] + horn.shape.height / 2;
    assert.ok(Math.abs(flange.offset.position[2] - flange.shape.height / 2 - depth / 2) < 1e-9);
    assert.ok(Math.abs(horn.offset.position[2] - horn.shape.height / 2 - flange.offset.position[2] - flange.shape.height / 2) < 1e-9);
    assert.ok(horn.shape.radius <= flange.shape.radius && flange.shape.radius <= Math.min(length, height) / 2);
    assert.ok(Math.abs(part.dimensions_m[2] - face - depth / 2) < 1e-9);
    const connectors = new Map(part.connectors.map(connector => [connector.id, connector]));
    assert.deepEqual(connectors.get('mount')?.position, [0, 0, -depth / 2]);
    assert.deepEqual(connectors.get('bottom')?.position, [0, -height / 2, 0]);
    assert.deepEqual(connectors.get('side')?.position, [length / 2, 0, 0]);
    assert.deepEqual(connectors.get('top')?.position, [0, height / 2, 0]);
    const output = connectors.get('horn')!;
    assert.equal(output.kind, 'revolute');
    assert.deepEqual(output.axis, [0, 0, 1]);
    assert.ok(Math.abs(output.position[2] - face) < 1e-9);
  }
  assert.throws(() => generatePart(actuatorKind, { torque: 51 }), /torque.*out of range/);
  assert.throws(() => generatePart(actuatorKind, { speed: 4 }), /speed.*out of range/);
});

test('a normal horn mount transfers the higher rating to the joint', () => {
  const operations = [
    { op: 'place', id: 'base', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'motor', part: 'rotary-actuator-40nm', onto: 'base', connector: 'top', via: 'bottom' },
    { op: 'mount', id: 'lever', part: 'link-150', onto: 'motor', connector: 'horn', via: 'pivot_a_back', joint: 'revolute', motor: { controlId: 'lift' } },
  ].map(operation => AssemblyOp.parse(operation));
  const { assembly } = applyOps(emptyAssembly(), operations, getPart);
  const joint = assembly.joints.find(({ id }) => id === 'j_lever')!;
  assert.equal(joint.motor?.maxTorque_Nm, 40);
  assert.deepEqual(joint.axis, [0, 0, 1]);
  for (const endpoint of [joint.a, joint.b]) {
    const instance = assembly.instances.find(({ id }) => id === endpoint.instanceId)!;
    const connector = getPart(instance.partId)!.connectors.find(({ id }) => id === endpoint.connectorId)!;
    const point = transformPoint(instance.transform, connector.position);
    assert.ok(point.every((value, index) => Math.abs(value - joint.anchor![index]) < 1e-9));
  }
});

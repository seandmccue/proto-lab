import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Vec3 } from '@protolab/schema';
import { AssemblyError, AssemblyOp, applyOps, emptyAssembly, getPart, len, sub, transformDir, transformPoint } from './index.ts';

const bridge = {
  op: 'bridge', id: 'pushrod', part: 'link-80',
  a: 'driver', a_connector: 'pivot_a', via_a: 'pivot_a',
  b: 'rocker', b_connector: 'pivot_a_back', via_b: 'pivot_b',
} satisfies AssemblyOp;

function supports(secondPosition: Vec3 = [0.004, 0.148, 0.064], secondRotation: Vec3 = [0, 90, 0]) {
  return applyOps(emptyAssembly(), [
    { op: 'place', id: 'driver', part: 'link-80', position: [0, 0.1, 0], rotation_deg: [0, 90, 0], anchored: true },
    { op: 'place', id: 'rocker', part: 'link-80', position: secondPosition, rotation_deg: secondRotation },
  ], getPart).assembly;
}

test('bridge fits an off-axis rigid link to both opposed revolute axes', () => {
  const input = supports();
  const { assembly } = applyOps(input, [AssemblyOp.parse(bridge)], getPart);
  assert.deepEqual(assembly.instances.slice(0, 2), input.instances, 'does not move the existing endpoints');
  assert.equal(assembly.instances.length, 3);
  assert.equal(assembly.joints.length, 2);
  const link = assembly.instances[2];
  for (const [index, joint] of assembly.joints.entries()) {
    assert.equal(joint.type, 'revolute');
    assert.equal(joint.motor, undefined);
    assert.equal(joint.a.instanceId, input.instances[index].id);
    assert.equal(joint.b.instanceId, link.id);
    const pivot = getPart(link.partId)!.connectors.find((connector) => connector.id === joint.b.connectorId)!;
    assert.ok(len(sub(transformPoint(link.transform, pivot.position), joint.anchor!)) < 1e-9, 'pivot centers coincide');
    const axis = transformDir(link.transform, pivot.axis);
    const axisError = Math.min(len(sub(axis, joint.axis!)), len(sub(axis, joint.axis!.map((v) => -v) as Vec3)));
    assert.ok(axisError < 1e-9, 'revolute axes are collinear');
  }
});

test('bridge reports incompatible span and axes without changing the input assembly', () => {
  const distant = supports([0.004, 0.148, 0.074]);
  const incompatible = supports([0.042, 0.146, 0.104], [90, 0, 0]);
  for (const [input, message] of [
    [distant, /pivot spacing is 80\.00 mm but the endpoints are/],
    [incompatible, /pivot axes cannot both align/],
  ] as const) {
    const before = structuredClone(input);
    assert.throws(
      () => applyOps(input, [bridge], getPart),
      (error) => error instanceof AssemblyError && error.opIndex === 0 && message.test(error.message),
    );
    assert.deepEqual(input, before);
  }
});

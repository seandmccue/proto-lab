import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart, type AssemblyOp } from '@protolab/parts';
import { TestSpec } from '@protolab/schema';
import { runTest } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
const worldTravel = { instance: 'piston', axis: 'y', minTravel_m: 0.05 };

function slider(anchored: boolean, joint: 'prismatic' | 'fixed', limits?: [number, number]) {
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'rail', part: 'slider-250', position: [0, 1, 0], rotation_deg: [0, 0, -90], anchored },
    { op: 'mount', id: 'piston', part: 'carriage-20', onto: 'rail', connector: 'carriage', via: 'rail_face',
      joint, spin_deg: 0, offset_m: 0, limits },
  ];
  return applyOps(emptyAssembly(), ops, getPart).assembly;
}

function definition(check: typeof worldTravel & { relativeTo?: string }) {
  return TestSpec.parse({
    kind: 'motion', id: 'stroke', duration_s: 0.4,
    measure: { linearTravel: [check] },
  });
}

test('falling with a reference does not count as stroke', async () => {
  const assembly = slider(false, 'prismatic', [0, 0]);
  const world = await runTest(assembly, { env, test: definition(worldTravel) });
  const relative = await runTest(assembly, { env, test: definition({ ...worldTravel, axis: 'x', relativeTo: 'rail' }) });

  assert.ok(world.passed);
  assert.ok(world.metrics['piston.travel_y_m'] > 0.5);
  assert.equal(relative.passed, false);
  assert.equal(relative.metrics['piston.relativeTo.rail.travel_x_m'], 0);
  assert.match(relative.failureReasons.join(' '), /rail's local x/);
  assert.deepEqual(relative.trace, world.trace);
});

test('a passive slider passes along its rotated reference-local axis', async () => {
  const assembly = slider(true, 'prismatic', [0, 0.09]);
  assert.equal(assembly.joints[0].motor, undefined);
  const world = await runTest(assembly, { env, test: definition(worldTravel) });
  const relative = await runTest(assembly, { env, test: definition({ ...worldTravel, axis: 'x', relativeTo: 'rail' }) });

  assert.ok(world.passed, world.failureReasons.join(' '));
  assert.ok(relative.passed, relative.failureReasons.join(' '));
  assert.ok(relative.metrics['piston.relativeTo.rail.travel_x_m'] >= 0.05);
  assert.equal(relative.metrics['piston.relativeTo.rail.travel_x_m'], world.metrics['piston.travel_y_m']);
  assert.deepEqual(relative.trace, world.trace);
});

test('a rigidly attached target reports zero relative travel and explains the repair', async () => {
  const result = await runTest(slider(false, 'fixed'), {
    env, test: definition({ ...worldTravel, axis: 'x', relativeTo: 'rail' }),
  });
  assert.equal(result.passed, false);
  assert.equal(result.metrics['piston.relativeTo.rail.travel_x_m'], 0);
  assert.match(result.failureReasons.join(' '), /piston is fixed to rail/);
  assert.ok(result.trace.frames.length > 0);
});

test('missing and self travel references fail before stepping physics', async () => {
  const assembly = slider(true, 'prismatic', [0, 0.09]);
  for (const [relativeTo, reason] of [
    ['missing', /Travel reference "missing" not found/],
    ['piston', /Travel instance "piston" must differ from its reference/],
  ] as const) {
    const result = await runTest(assembly, { env, test: definition({ ...worldTravel, relativeTo }) });
    assert.equal(result.passed, false);
    assert.deepEqual(result.trace.frames, []);
    assert.deepEqual(result.metrics, {});
    assert.match(result.failureReasons.join(' '), reason);
  }
});

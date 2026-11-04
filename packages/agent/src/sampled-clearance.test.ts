import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyAssembly, getPart } from '@protolab/parts';
import { IDENTITY, TestSpec, type Assembly, type GeometryPiece, type Instance, type PartDefinition, type Vec3 } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

const definition = TestSpec.parse({
  kind: 'motion', id: 'cabin_clearance', duration_s: .5,
  measure: { clearancePairs: [['wheel', 'cabin']] },
  criteria: { torqueWithinRating: false },
});

function box(position: Vec3, size: Vec3): GeometryPiece {
  return { shape: { kind: 'box', size }, offset: { ...IDENTITY, position }, role: 'structure', collide: true };
}

async function checkedCabin(roofZ: number) {
  const part = (id: string, geometry: GeometryPiece[]): PartDefinition => ({
    ...getPart('block-40')!, id, geometry, connectors: [
      { id: 'pivot', kind: 'revolute', position: [0, 0, 0], axis: [0, 0, 1] },
    ],
  });
  const instance = (id: string, position: Vec3, anchored = false): Instance => ({
    id, label: id, partId: id, transform: { ...IDENTITY, position }, anchored, free: false,
  });
  const wheel = instance('wheel', [0, .2, 0], true);
  const cabin = instance('cabin', [0, .2, 0]);
  const roof = instance('roof', [0, .2, roofZ]);
  const joint = (first: Instance, second: Instance, type: 'revolute' | 'fixed'): Assembly['joints'][number] => ({
    id: `${first.id}-${second.id}`, type,
    a: { instanceId: first.id, connectorId: 'pivot' },
    b: { instanceId: second.id, connectorId: 'pivot' },
    anchor: first.transform.position, axis: [0, 0, 1],
  });
  const assembly: Assembly = {
    ...emptyAssembly(), instances: [wheel, cabin, roof], parts: [
      part('wheel', [box([0, -.09, 0], [.08, .22, .04])]),
      part('cabin', [box([0, -.02, .04], [.02, .04, .02]), box([0, 0, .025], [.008, .008, .05])]),
      part('roof', [box([0, 0, 0], [.04, .02, .02])]),
    ],
    joints: [joint(wheel, cabin, 'revolute'), joint(cabin, roof, 'fixed')],
  };
  const spec = baseSpec('Check the cabin clears its wheel.');
  const native = await runTest(assembly, { env: spec.environment, test: definition });
  const runtime = new ToolRuntime(spec, { onLog() {}, onPlan() {}, onAssembly() {}, onTest() {} }, undefined, assembly);
  const defined = await runtime.call('define_test', { test: definition });
  assert.deepEqual(defined, { ok: true, test: definition });
  await runtime.call('run_test', { test_id: definition.id });
  assert.equal(runtime.tests.length, 1);
  return { native, runtime, recorded: runtime.tests[0] };
}

test('agent rejects an overlapping cabin roof even when the native clearance metric passes', async () => {
  const { native, runtime, recorded } = await checkedCabin(.015);
  assert.equal(native.passed, true);
  assert.equal(recorded.passed, false);
  assert.equal(recorded.metrics.clearanceViolation, 0);
  assert.equal(recorded.metrics.sampledClearancePairs, 1);
  assert.equal(recorded.metrics.sampledClearanceFrames, native.trace.frames.length);
  assert.equal(recorded.metrics.sampledClearanceViolations, 1);
  assert.equal(recorded.metrics.sampledClearanceComplete, 1);
  assert.match(recorded.failureReasons.join('\n'), /Sampled clearance: wheel intersects roof by 15\.00 mm at 0\.000 s\./);
  assert.match(recorded.failureReasons.join('\n'), /rerun the original test with its targets unchanged/);
  assert.deepEqual(recorded.trace, native.trace);
  assert.deepEqual(runtime.testSpecs.get(definition.id), definition);
  assert.deepEqual(runtime.pendingChecks(), [`${definition.id}: latest test failed`]);
  const final = await runtime.call('finalize_design', { status: 'passed', summary: 'The cabin clears.' }) as { error: string };
  assert.match(final.error, /Cannot mark this build passed/);
});

test('an independently clear cabin preserves the native pass and original replay', async () => {
  const { native, runtime, recorded } = await checkedCabin(.055);
  assert.equal(native.passed, true);
  assert.equal(recorded.passed, true);
  assert.equal(recorded.metrics.sampledClearancePairs, 1);
  assert.equal(recorded.metrics.sampledClearanceFrames, native.trace.frames.length);
  assert.equal(recorded.metrics.sampledClearanceViolations, 0);
  assert.equal(recorded.metrics.sampledClearanceComplete, 1);
  assert.deepEqual(recorded.trace, native.trace);
  assert.deepEqual(runtime.pendingChecks(), []);
});

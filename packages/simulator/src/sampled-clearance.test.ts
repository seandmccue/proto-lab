import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyAssembly, getPart } from '@protolab/parts';
import { IDENTITY, TestSpec, type Assembly, type GeometryPiece, type Instance, type PartDefinition, type Vec3 } from '@protolab/schema';
import { initSimulator, runTest } from './index.ts';
import { inspectSampledClearance } from './sampled-clearance.ts';

function box(position: Vec3, size: Vec3): GeometryPiece {
  return { shape: { kind: 'box', size }, offset: { ...IDENTITY, position }, role: 'structure', collide: true };
}

function fixture(roofZ = .015) {
  const part = (id: string, geometry: GeometryPiece[]): PartDefinition => ({
    ...getPart('block-40')!, id, geometry, connectors: [
      { id: 'pivot', kind: 'revolute', position: [0, 0, 0], axis: [0, 0, 1] },
    ],
  });
  const instance = (id: string, position: Vec3, anchored = false): Instance => ({
    id, label: id, partId: id, transform: { ...IDENTITY, position }, anchored, free: false,
  });
  const wheel = instance('wheel', [0, .2, 0], true);
  const spoke = instance('spoke', [0, .2, 0]);
  const cabin = instance('cabin', [0, .2, 0]);
  const roof = instance('roof', [0, .2, roofZ]);
  const joint = (first: Instance, second: Instance, type: 'revolute' | 'fixed'): Assembly['joints'][number] => ({
    id: `${first.id}-${second.id}`, type,
    a: { instanceId: first.id, connectorId: 'pivot' },
    b: { instanceId: second.id, connectorId: 'pivot' },
    anchor: first.transform.position, axis: [0, 0, 1],
  });
  const assembly: Assembly = {
    ...emptyAssembly(), instances: [wheel, spoke, cabin, roof], parts: [
      part('wheel', [box([0, 0, 0], [.08, .04, .04])]),
      part('spoke', [box([.06, 0, 0], [.05, .01, .04])]),
      part('cabin', [box([0, -.02, .04], [.02, .04, .02]), box([0, 0, .025], [.008, .008, .05])]),
      part('roof', [box([0, 0, 0], [.04, .02, .02])]),
    ],
    joints: [joint(wheel, spoke, 'fixed'), joint(wheel, cabin, 'revolute'), joint(cabin, roof, 'fixed')],
  };
  return { assembly, fixedGroups: [{ members: [wheel, spoke] }, { members: [cabin, roof] }] };
}

const env = { gravity_m_s2: 9.81, groundFriction: .9 };
const spec = TestSpec.parse({
  kind: 'motion', id: 'cabin-clearance', duration_s: .5,
  measure: { clearancePairs: [['wheel', 'cabin']] },
  criteria: { torqueWithinRating: false },
});
assert.equal(spec.kind, 'motion');

test('sampled clearance catches a fixed roof crossing a wheel even when its bearing disables solver contacts', async () => {
  const { assembly, fixedGroups } = fixture();
  const native = await runTest(assembly, { env, test: spec });
  assert.equal(native.passed, true);
  assert.equal(native.metrics.clearanceViolation, 0);
  const original = structuredClone(native.trace);
  const report = inspectSampledClearance(assembly, native.trace, fixedGroups, spec.measure.clearancePairs);
  assert.equal(report.complete, true);
  assert.equal(report.pairsChecked, 3);
  assert.equal(report.samplesChecked, native.trace.frames.length);
  assert.deepEqual(report.issues.map(({ firstId, secondId, time_s }) => ({ firstId, secondId, time_s })), [
    { firstId: 'wheel', secondId: 'roof', time_s: 0 },
  ]);
  assert.ok(report.issues[0].penetration_m > .001);
  assert.deepEqual(native.trace, original);
});

test('same-group parts and direct mates are excluded and reversed group requests are deduplicated', async () => {
  const { assembly, fixedGroups } = fixture(.055);
  const native = await runTest(assembly, { env, test: spec });
  const report = inspectSampledClearance(assembly, native.trace, fixedGroups, [
    ['wheel', 'cabin'], ['roof', 'spoke'], ['wheel', 'spoke'],
  ]);
  assert.deepEqual(report, { complete: true, pairsChecked: 3, samplesChecked: native.trace.frames.length, issues: [] });
  assert.deepEqual(inspectSampledClearance(assembly, native.trace, fixedGroups, []), {
    complete: true, pairsChecked: 0, samplesChecked: 0, issues: [],
  });
});

test('explicitly requested loose payload clearance is checked', async () => {
  const { assembly, fixedGroups } = fixture();
  const payload = fixedGroups[1].members[1];
  payload.free = true;
  assembly.joints.pop();
  fixedGroups[1].members.pop();
  fixedGroups.push({ members: [payload] });
  await initSimulator();
  const bodies = Object.fromEntries(assembly.instances.map(({ id, transform }) => [id, transform]));
  const report = inspectSampledClearance(assembly, { dt: 1 / 30, frames: [{ t: 0, bodies, joints: {} }] }, fixedGroups, [
    ['wheel', payload.id],
  ]);
  assert.equal(report.complete, true);
  assert.equal(report.pairsChecked, 2);
  assert.deepEqual(report.issues.map(({ firstId, secondId }) => [firstId, secondId]), [['wheel', payload.id]]);
});

test('clearance ignores shallow fitting tolerance and checks later poses', async () => {
  const { assembly, fixedGroups } = fixture(.02995);
  await initSimulator();
  const bodies = Object.fromEntries(assembly.instances.map(({ id, transform }) => [id, transform]));
  const later = { ...bodies, roof: { ...IDENTITY, position: [0, .2, .015] as Vec3 } };
  const report = inspectSampledClearance(assembly, {
    dt: 1 / 30,
    frames: [{ t: 0, bodies, joints: {} }, { t: 1 / 30, bodies: later, joints: {} }],
  }, fixedGroups, spec.measure.clearancePairs);
  assert.equal(report.complete, true);
  assert.equal(report.samplesChecked, 2);
  assert.deepEqual(report.issues.map(({ time_s }) => time_s), [1 / 30]);
});

test('an absent expanded pose or an invalid profile leaves clearance unverified', async () => {
  const { assembly, fixedGroups } = fixture(.055);
  const native = await runTest(assembly, { env, test: spec });
  delete native.trace.frames[1].bodies.roof;
  const missing = inspectSampledClearance(assembly, native.trace, fixedGroups, spec.measure.clearancePairs);
  assert.equal(missing.complete, false);
  assert.equal(missing.samplesChecked, 1);
  assert.match(missing.failureReason!, /valid sampled pose for "roof"/);

  assembly.parts.find(({ id }) => id === 'roof')!.geometry[0].shape = {
    kind: 'extrude', axis: 'z', depth: .01, profile: [[0, 0], [.1, .1], [0, .1], [.1, 0]],
  };
  const invalid = inspectSampledClearance(assembly, native.trace, fixedGroups, spec.measure.clearancePairs);
  assert.equal(invalid.complete, false);
  assert.equal(invalid.samplesChecked, 0);
  assert.match(invalid.failureReason!, /"roof" piece 1: its profile does not form a valid solid/);
});

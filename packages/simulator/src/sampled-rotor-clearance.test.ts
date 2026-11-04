import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyAssembly, getPart, quatFromAxisAngle } from '@protolab/parts';
import { IDENTITY, type Assembly, type GeometryPiece, type PartDefinition, type Trace, type Vec3 } from '@protolab/schema';
import { auditSampledRotorClearance } from './index.ts';

function box(position: Vec3, size: Vec3): GeometryPiece {
  return { shape: { kind: 'box', size }, offset: { ...IDENTITY, position }, role: 'structure', collide: true };
}

function part(id: string, geometry: GeometryPiece[], category: PartDefinition['category'] = 'frames'): PartDefinition {
  return { ...getPart('block-40')!, id, category, geometry };
}

const rotor = part('propeller', [box([.06, 0, 0], [.12, .012, .012])], 'propellers');
const block = part('frame', [box([0, 0, 0], [.04, .04, .04])]);
const ring: GeometryPiece = {
  shape: { kind: 'revolve', axis: 'z', segments: 24, profile: [[.13, -.01], [.15, -.01], [.15, .01], [.13, .01]] },
  offset: IDENTITY, role: 'shell', collide: true,
};
const shroud = part('shroud', [ring]);

function instance(id: string, partId: string, position: Vec3, free = false): Assembly['instances'][number] {
  return { id, label: id, partId, transform: { ...IDENTITY, position }, anchored: false, free };
}

function fixture() {
  const joint = (first: string, second: string, type: 'fixed' | 'revolute' = 'fixed'): Assembly['joints'][number] => ({
    id: `${first}-${second}`, type, a: { instanceId: first, connectorId: 'a' }, b: { instanceId: second, connectorId: 'b' },
  });
  const assembly: Assembly = {
    ...emptyAssembly(),
    parts: [rotor, block, shroud],
    instances: [
      instance('motor', block.id, [0, .2, 0]),
      instance('rotor', rotor.id, [0, .2, 0]),
      instance('spinner', block.id, [0, .2, 0]),
      instance('shroud', shroud.id, [0, .2, 0]),
      instance('brace', block.id, [0, .31, 0]),
      instance('payload', block.id, [0, .31, 0], true),
    ],
    joints: [
      { ...joint('motor', 'rotor', 'revolute'), motor: { controlId: 'spin', stiffness: 1, damping: 1 } },
      joint('rotor', 'spinner'), joint('motor', 'shroud'), joint('motor', 'brace'), joint('motor', 'payload'),
    ],
  };
  const bodies = Object.fromEntries(assembly.instances.map(({ id, transform }) => [id, transform]));
  const moved = { ...bodies.rotor, rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2) };
  const trace: Trace = { dt: 1 / 30, frames: [{ t: 0, joints: {}, bodies }, { t: 1 / 30, joints: {}, bodies: { ...bodies, rotor: moved } }] };
  return { assembly, trace };
}

test('sampled clearance detects an omitted brace overlap during rotation and preserves the original trace', async () => {
  const { assembly, trace } = fixture();
  const originalTrace = structuredClone(trace);
  const report = await auditSampledRotorClearance(assembly, trace);
  assert.equal(report.complete, true);
  assert.equal(report.pairsChecked, 2); // The hollow shroud and brace. The motor is a direct mate.
  assert.equal(report.samplesChecked, 2);
  assert.deepEqual(report.issues.map(({ rotorId, obstacleId, time_s }) => ({ rotorId, obstacleId, time_s })), [
    { rotorId: 'rotor', obstacleId: 'brace', time_s: 1 / 30 },
  ]);
  assert.ok(report.issues[0].penetration_m > .005);
  assert.deepEqual(trace, originalTrace);
});

test('a shallow fit under one tenth of a millimetre does not fail the clearance check', async () => {
  const { assembly, trace } = fixture();
  trace.frames = trace.frames.slice(0, 1);
  trace.frames[0].bodies.brace = { ...IDENTITY, position: [.06, .22595, 0] };
  const report = await auditSampledRotorClearance(assembly, trace);
  assert.equal(report.complete, true);
  assert.equal(report.pairsChecked, 2);
  assert.deepEqual(report.issues, []);
});

test('a non-propeller mechanism is outside the clearance check scope', async () => {
  const { assembly, trace } = fixture();
  assembly.parts[0] = { ...rotor, category: 'wheels' };
  assert.deepEqual(await auditSampledRotorClearance(assembly, trace), {
    complete: true, pairsChecked: 0, samplesChecked: 0, issues: [],
  });
});

test('missing poses and invalid nearby profiles leave the audit incomplete', async () => {
  const { assembly, trace } = fixture();
  delete trace.frames[1].bodies.brace;
  const missing = await auditSampledRotorClearance(assembly, trace);
  assert.equal(missing.complete, false);
  assert.equal(missing.samplesChecked, 1);
  assert.match(missing.failureReason!, /valid sampled pose for "brace"/);

  assembly.parts[2] = part('shroud', [{
    ...ring, shape: { kind: 'extrude', axis: 'z', depth: .01, profile: [[0, 0], [.1, .1], [0, .1], [.1, 0]] },
  }]);
  const invalid = await auditSampledRotorClearance(assembly, trace);
  assert.equal(invalid.complete, false);
  assert.equal(invalid.samplesChecked, 0);
  assert.match(invalid.failureReason!, /"shroud" piece 1: its profile does not form a valid solid/);
});

test('an expensive profile cannot silently exhaust clearance verification', async () => {
  const { assembly, trace } = fixture();
  const profile = Array.from({ length: 300 }, (_, i): [number, number] => {
    const angle = i * 2 * Math.PI / 300;
    return [.13 * Math.cos(angle), .13 * Math.sin(angle)];
  });
  assembly.parts[2] = part('shroud', [{
    ...ring, shape: { kind: 'extrude', axis: 'z', depth: .01, profile },
  }]);
  const report = await auditSampledRotorClearance(assembly, trace);
  assert.equal(report.complete, false);
  assert.equal(report.pairsChecked, 0);
  assert.equal(report.samplesChecked, 0);
  assert.match(report.failureReason!, /profile is too complex near "shroud"/);
});

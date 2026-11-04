import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyAssembly, getPart, quatFromAxisAngle } from '@protolab/parts';
import { IDENTITY, type Assembly, type GeometryPiece, type PartDefinition, type Vec3 } from '@protolab/schema';
import { auditCompoundGeometry, auditPartGeometry } from './index.ts';

function box(position: Vec3, size: Vec3, options: Partial<GeometryPiece> = {}): GeometryPiece {
  return { shape: { kind: 'box', size }, offset: { ...IDENTITY, position }, role: 'structure', collide: true, ...options };
}

function designed(id: string, geometry: GeometryPiece[]): PartDefinition {
  return { ...getPart('block-40')!, id, name: id, kind: 'designed', source: { kind: 'designed', license: 'CC0-1.0', creator: 'Test fixture' }, geometry };
}

function instance(part: PartDefinition, id: string, position: Vec3 = [0, 0, 0]): Assembly['instances'][number] {
  return { id, label: id, partId: part.id, transform: { ...IDENTITY, position }, anchored: false, free: false };
}

const ring: GeometryPiece = {
  shape: { kind: 'revolve', axis: 'z', segments: 24, profile: [[.1, -.01], [.12, -.01], [.12, .01], [.1, .01]] },
  offset: IDENTITY, role: 'structure', collide: true,
};

test('compound geometry finds rotated gaps that an AABB overlap misses', async () => {
  const rotation = quatFromAxisAngle([0, 0, 1], Math.PI / 4);
  const strip = (position: Vec3) => box(position, [.08, .004, .01], { offset: { position, rotation } });
  const panel = designed('panel', [
    strip([0, 0, 0]), strip([-.007, .007, 0]),
    box([0, 0, 0], [.1, .1, .1], { role: 'decor' }),
    box([0, 0, 0], [.1, .1, .1], { role: 'fastener' }),
    box([0, 0, 0], [.1, .1, .1], { collide: false }),
  ]);
  const issue = await auditPartGeometry(panel);
  assert.ok(issue);
  assert.equal(issue.partId, panel.id);
  assert.deepEqual(issue.pieceGroups, [[1], [2]]);
  assert.deepEqual(issue.nearestPieces, [1, 2]);
  assert.ok(Math.abs(issue.nearestGap_m! - .0059) < .0001);
});

test('a nearby fixed piece can bridge the regions of a designed part', async () => {
  const panel = designed('split-panel', [box([-.02, 0, 0], [.02, .01, .01]), box([.02, 0, 0], [.02, .01, .01])]);
  const bridge = { ...getPart('block-40')!, id: 'bridge', geometry: [box([0, 0, 0], [.024, .01, .01])] };
  const assembly: Assembly = {
    ...emptyAssembly(), parts: [panel, bridge], instances: [instance(panel, 'panel'), instance(bridge, 'bridge')],
    joints: [{ id: 'mount', type: 'fixed', a: { instanceId: 'panel', connectorId: 'top' }, b: { instanceId: 'bridge', connectorId: 'bottom' } }],
  };
  assert.deepEqual(await auditCompoundGeometry(assembly), []);
  const separated = await auditCompoundGeometry({ ...assembly, joints: [{ ...assembly.joints[0], type: 'revolute' }] });
  assert.deepEqual(separated.map(({ instanceId, pieceGroups }) => ({ instanceId, pieceGroups })), [{ instanceId: 'panel', pieceGroups: [[1], [2]] }]);
});

test('contact tolerance allows close fits and separate free payloads', async () => {
  const cradle = designed('cradle', [box([0, 0, 0], [.02, .02, .02]), box([.0205, 0, 0], [.02, .02, .02])]);
  const payload = designed('payload', [box([0, 0, 0], [.02, .02, .02], { role: 'payload' })]);
  const assembly: Assembly = {
    ...emptyAssembly(), parts: [cradle, payload], instances: [
      { ...instance(cradle, 'cradle'), anchored: true },
      { ...instance(payload, 'cargo-a', [.1, .2, 0]), free: true },
      { ...instance(payload, 'cargo-b', [.3, .2, 0]), free: true },
    ],
  };
  assert.equal(await auditPartGeometry(cradle), undefined);
  assert.deepEqual(await auditCompoundGeometry(assembly), []);
});

test('a hollow revolve does not support a detached box in its bore', async () => {
  const part = designed('hollow-ring', [ring, box([0, 0, 0], [.02, .02, .01])]);
  const issue = await auditPartGeometry(part);
  assert.deepEqual(issue?.pieceGroups, [[1], [2]]);
  assert.ok(issue?.nearestGap_m && issue.nearestGap_m > .084 && issue.nearestGap_m < .087);
});

test('nested corrugated rings remain disconnected when an exact gap hint exceeds its budget', async () => {
  const corrugated = (inner: number, outer: number): GeometryPiece => ({
    ...ring,
    shape: { kind: 'revolve', axis: 'y', segments: 96, profile: [
      [outer, -.08], [outer, .08], ...Array.from({ length: 62 }, (_, i): [number, number] =>
        [inner + (i % 2 ? .002 : 0), .08 - .16 * i / 61]),
    ] },
  });
  const part = designed('nested-corrugated', [
    box([.23, 0, 0], [.01, .01, .01]),
    corrugated(.05, .06),
    corrugated(.075, .085),
  ]);
  const issue = await auditPartGeometry(part);
  assert.deepEqual(issue?.pieceGroups, [[1], [2], [3]]);
  assert.equal(issue?.nearestGap_m, null);
  assert.equal(issue?.nearestPieces, null);
});

test('a concave extrude does not support a detached box in its recess', async () => {
  const channel: GeometryPiece = {
    shape: { kind: 'extrude', axis: 'z', depth: .02, profile: [
      [-.06, -.06], [.06, -.06], [.06, .06], [.04, .06], [.04, -.04], [-.04, -.04], [-.04, .06], [-.06, .06],
    ] },
    offset: IDENTITY, role: 'structure', collide: true,
  };
  const issue = await auditPartGeometry(designed('u-channel', [channel, box([0, 0, 0], [.02, .02, .01])]));
  assert.deepEqual(issue?.pieceGroups, [[1], [2]]);
  assert.ok(issue?.nearestGap_m && Math.abs(issue.nearestGap_m - .03) < .0001);
});

test('an intact curved rim bridges mounted tabs and a real spoke connects the hub', async () => {
  const part = designed('spoked-ring', [
    ring,
    box([.11, 0, 0], [.012, .012, .012]),
    box([-.11, 0, 0], [.012, .012, .012]),
    box([.055, 0, 0], [.1, .012, .012]),
    box([0, 0, 0], [.02, .02, .012]),
  ]);
  assert.equal(await auditPartGeometry(part), undefined);
});

test('a sub-millimetre coaxial fit remains connected after rotation', async () => {
  const curvedRib: GeometryPiece = {
    shape: { kind: 'revolve', axis: 'y', segments: 32, profile: [[.012, -.009], [.022, -.006], [.025, -.002], [.025, .002], [.022, .006], [.012, .009]] },
    offset: IDENTITY, role: 'structure', collide: true,
  };
  const collar: GeometryPiece = {
    shape: { kind: 'cylinder', axis: 'y', height: .006, radius: .012 },
    offset: { ...IDENTITY, position: [0, -.0125, 0] }, role: 'structure', collide: true,
  };
  const part = designed('coaxial-fit', [curvedRib, collar]);
  const placed = instance(part, 'fitted', [.64, .2, -.42]);
  placed.transform.rotation = quatFromAxisAngle([1, 1, 0], .91);
  assert.equal(await auditPartGeometry(part), undefined);
  assert.deepEqual(await auditCompoundGeometry({ ...emptyAssembly(), parts: [part], instances: [placed] }), []);
});

test('an invalid physical profile fails closed even in a single-piece custom part', async () => {
  const invalid: GeometryPiece = {
    shape: { kind: 'extrude', axis: 'z', depth: .02, profile: [[-.05, -.05], [.05, .05], [-.05, .05], [.05, -.05]] },
    offset: IDENTITY, role: 'structure', collide: true,
  };
  const part = designed('crossing-outline', [invalid]);
  const expected = /Cannot verify crossing-outline.*piece 1.*profile does not form a valid solid/;
  await assert.rejects(() => auditPartGeometry(part), expected);
  await assert.rejects(() => auditCompoundGeometry({ ...emptyAssembly(), parts: [part], instances: [instance(part, 'invalid')] }), expected);
});

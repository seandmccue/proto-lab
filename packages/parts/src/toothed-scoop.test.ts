import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GeometryPiece, Profile, Vec3 } from '@protolab/schema';
import { applyOps, emptyAssembly, generatePart, getPart, hullPoints, invert, ParamError, searchCatalog, shapeVolume, transformPoint } from './index.ts';

const tolerance = 1e-9;

function inProfile([x, y]: readonly number[], profile: Profile) {
  let inside = false;
  for (let i = 0, j = profile.length - 1; i < profile.length; j = i++) {
    const [ax, ay] = profile[j], [bx, by] = profile[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) <= tolerance * Math.hypot(bx - ax, by - ay)
      && x >= Math.min(ax, bx) - tolerance && x <= Math.max(ax, bx) + tolerance
      && y >= Math.min(ay, by) - tolerance && y <= Math.max(ay, by) + tolerance) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Actual solid membership, not overlapping bounding boxes that would fill the bucket. */
function contains(piece: GeometryPiece, world: Vec3) {
  const [x, y, z] = transformPoint(invert(piece.offset), world);
  const shape = piece.shape;
  if (shape.kind === 'box') return [x, y, z].every((value, axis) => Math.abs(value) <= shape.size[axis] / 2 + tolerance);
  if (shape.kind === 'extrude' && shape.axis === 'z') return Math.abs(z) <= shape.depth / 2 + tolerance && inProfile([x, y], shape.profile);
  if (shape.kind === 'revolve' && shape.axis === 'z') return inProfile([Math.hypot(x, y), z], shape.profile);
  throw new Error(`Unexpected scoop primitive ${shape.kind}`);
}

function boundaryPoints(piece: GeometryPiece): Vec3[] {
  const shape = piece.shape;
  const points = shape.kind === 'box'
    ? [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) =>
      [x * shape.size[0] / 2, y * shape.size[1] / 2, z * shape.size[2] / 2] as Vec3)))
    : hullPoints(shape);
  return points.map((point) => transformPoint(piece.offset, point));
}

test('scoop presets have open mouths, bored pivots and a connected material path to every tooth', () => {
  const examples = [getPart('toothed-scoop-160')!, getPart('toothed-scoop-250')!,
    generatePart('toothed_scoop', { width: 0.04, depth: 0.035, height: 0.03, thickness: 0.001, teeth: 2 }),
    generatePart('toothed_scoop', { width: 0.4, depth: 0.4, height: 0.3, thickness: 0.012, teeth: 8 })];
  for (const part of examples) {
    assert.equal(part.category, 'grippers');
    assert.equal(part.material, 'aluminium');
    assert(part.geometry.length <= 16);
    assert(part.connectors.length <= 16);
    assert(part.geometry.every(({ collide, role }) => collide && role !== 'decor' && role !== 'fastener'));
    assert(Math.abs(part.mass_kg - part.geometry.reduce((volume, piece) => volume + shapeVolume(piece.shape), 0) * 2700) < tolerance);
    const { depth, height, teeth } = part.params;
    const anyMaterial = (point: Vec3) => part.geometry.some((piece) => contains(piece, point));
    for (const x of [depth * 0.3, depth * 0.6, depth, depth * 1.4]) {
      assert(!anyMaterial([x, -height * 0.5, 0]), 'the middle/front cavity must be empty');
    }
    for (const y of [-height * 0.5, 0, height * 0.5]) {
      assert(!anyMaterial([depth * 0.5, y, 0]), 'the top opening must be clear');
    }
    for (const pivot of ['hinge', 'actuator']) {
      const connector = part.connectors.find(({ id }) => id === pivot)!;
      assert.equal(connector.kind, 'revolute');
      assert.deepEqual(connector.axis.slice(0, 2), [0, 0]);
      assert(!anyMaterial(connector.position), `${pivot} must have an actual open pin bore`);
    }
    const workingPoints = part.connectors.filter(({ id }) => id === 'cutting_edge' || id.startsWith('tooth_'));
    assert.equal(workingPoints.length, teeth + 1);
    assert(workingPoints.every(({ position, axis }) => anyMaterial(position) && axis[0] === 1));

    const samples = part.geometry.map(boundaryPoints);
    const reached = new Set([0]);
    for (let pass = 0; pass < part.geometry.length; pass++) {
      for (let i = 0; i < part.geometry.length; i++) {
        if (reached.has(i)) continue;
        for (const j of reached) {
          // Each edge has a real shared material point, unlike an AABB-only connection test.
          if (samples[i].some((point) => contains(part.geometry[j], point))
            || samples[j].some((point) => contains(part.geometry[i], point))) { reached.add(i); break; }
        }
      }
    }
    assert.equal(reached.size, part.geometry.length, 'barrels, walls, cutting lip and teeth must form one solid component');
    const points = samples.flat();
    const dimensions = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])) - Math.min(...points.map((point) => point[axis])));
    assert(dimensions.every((value, axis) => Math.abs(value - part.dimensions_m[axis]) < tolerance));
  }
});

test('scoop hinge mounts on an ordinary boom pin and exposes a distinct curl linkage pivot', () => {
  for (const id of ['toothed-scoop-160', 'toothed-scoop-250']) {
    assert(searchCatalog('excavator bucket', { category: 'grippers' }).some((part) => part.id === id));
    const { assembly } = applyOps(emptyAssembly(), [
      { op: 'place', id: 'boom', part: 'beam-200', position: [0, 0.3, 0] },
      { op: 'mount', id: 'bucket', part: id, onto: 'boom', connector: 'side_a', via: 'hinge', joint: 'revolute', spin_deg: 0, offset_m: 0 },
    ], getPart);
    const boom = assembly.instances[0], bucket = assembly.instances[1];
    const boomPin = getPart('beam-200')!.connectors.find(({ id }) => id === 'side_a')!;
    const scoop = getPart(id)!;
    const hinge = scoop.connectors.find(({ id }) => id === 'hinge')!;
    const worldPin = transformPoint(boom.transform, boomPin.position);
    const worldHinge = transformPoint(bucket.transform, hinge.position);
    assert(worldHinge.every((value, axis) => Math.abs(value - worldPin[axis]) < tolerance));
    assert.deepEqual(assembly.joints[0].axis, [0, 0, 1]);
    const actuator = scoop.connectors.find(({ id }) => id === 'actuator')!;
    assert(actuator.position[0] < hinge.position[0] && actuator.position[1] < hinge.position[1]);
    const edge = transformPoint(bucket.transform, scoop.connectors.find(({ id }) => id === 'cutting_edge')!.position);
    assert(edge[0] > worldHinge[0] && edge[1] < worldHinge[1], 'open mouth points forward and below the rear hinge');
  }
});

test('scoop parameters reject blocked cavities and fractional teeth while scaling physical mass', () => {
  assert.throws(() => generatePart('toothed_scoop', { teeth: 3.5 }), ParamError);
  assert.throws(() => generatePart('toothed_scoop', { width: 0.04, thickness: 0.008 }), ParamError);
  assert.throws(() => generatePart('toothed_scoop', { height: 0.03, thickness: 0.004 }), ParamError);
  const small = generatePart('toothed_scoop', { width: 0.125, depth: 0.1, height: 0.07, thickness: 0.002, teeth: 5 });
  const large = generatePart('toothed_scoop', { width: 0.25, depth: 0.2, height: 0.14, thickness: 0.004, teeth: 5 });
  assert(Math.abs(large.mass_kg / small.mass_kg - 8) < tolerance);
});

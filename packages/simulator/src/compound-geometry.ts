import RAPIER from '@dimforge/rapier3d-compat';
import { compose, hullPoints, QUAT_ID, quatFromAxisAngle, quatMul, rotate, scale, shapeHalfExtents, transformPoint } from '@protolab/parts';
import { IDENTITY, type GeometryPiece, type Instance, type PartDefinition, type Shape, type Transform, type Vec3 } from '@protolab/schema';
import { profileCells } from './profile-cells.ts';

const contactTolerance_m = .001;
const diagnosticPairBudget = 4096;
// Small contact queries are more accurate in millimetres than in the simulation's metres.
const auditScale = 1000;
const basis: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export interface CompoundGeometryIssue {
  instanceId: string;
  partId: string;
  partName: string;
  /** One-based indices into the subject part's geometry. */
  pieceGroups: number[][];
  nearestGap_m: number | null;
  nearestPieces: [number, number] | null;
}

export function isPhysicalPiece(piece: GeometryPiece) {
  return piece.collide && piece.role !== 'decor' && piece.role !== 'fastener';
}

/** Construct a simulation collider. Static audits decompose concave profiles separately. */
export function colliderAt(shape: Shape, transform: Transform): RAPIER.ColliderDesc | null {
  let rotation = transform.rotation;
  let collider: RAPIER.ColliderDesc | null;
  switch (shape.kind) {
    case 'box': collider = RAPIER.ColliderDesc.cuboid(shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2); break;
    case 'sphere': collider = RAPIER.ColliderDesc.ball(shape.radius); break;
    case 'cylinder':
    case 'capsule': {
      collider = shape.kind === 'cylinder' ? RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius) : RAPIER.ColliderDesc.capsule(shape.height / 2, shape.radius);
      const axis = shape.axis === 'x' ? quatFromAxisAngle([0, 0, 1], Math.PI / 2)
        : shape.axis === 'z' ? quatFromAxisAngle([1, 0, 0], Math.PI / 2) : QUAT_ID;
      rotation = quatMul(rotation, axis);
      break;
    }
    default: {
      const points = hullPoints(shape);
      collider = points.length >= 4 ? RAPIER.ColliderDesc.convexHull(new Float32Array(points.flat())) : null;
    }
  }
  const [x, y, z, w] = rotation;
  return collider?.setTranslation(...transform.position).setRotation({ x, y, z, w }) ?? null;
}

interface PlacedPart { id: string; part: PartDefinition; transform: Transform }
interface Bounds { center: Vec3; halfExtents: number[] }
interface LocalCell extends Bounds { shape: RAPIER.Shape }
interface PlacedCell extends Bounds { collider: RAPIER.ColliderDesc }
type CellTree = Bounds & ({ cells: PlacedCell[] } | { children: [CellTree, CellTree]; span: number });
interface PlacedPiece extends Bounds { number: number; shape: Shape; transform: Transform; tree?: CellTree | null }
type CellCache = Map<Shape, LocalCell[] | null>;

function projectedExtents(halfExtents: number[], axes: Vec3[]) {
  return basis.map((_, axis) => axes.reduce((sum, vector, index) => sum + Math.abs(vector[axis]) * halfExtents[index], 0));
}

function placedPiece(piece: GeometryPiece, number: number, instance: PlacedPart): PlacedPiece {
  const transform = compose(instance.transform, piece.offset);
  const [x, y, z, w] = transform.rotation;
  const length = Math.hypot(x, y, z, w);
  // Rapier normalizes incoming rotations. Use that same pose for the broad phase.
  transform.rotation = length > 0 ? [x / length, y / length, z / length, w / length] : QUAT_ID;
  return {
    number,
    shape: piece.shape,
    transform,
    center: transform.position,
    halfExtents: projectedExtents(shapeHalfExtents(piece.shape), basis.map((axis) => rotate(transform.rotation, axis))),
  };
}

function boundingGapSquared(a: Bounds, b: Bounds) {
  let gap = 0;
  for (let axis = 0; axis < 3; axis++) {
    const separation = Math.abs(a.center[axis] - b.center[axis]) - a.halfExtents[axis] - b.halfExtents[axis];
    gap += Math.max(0, separation) ** 2;
  }
  return gap;
}

function localCells(shape: Extract<Shape, { kind: 'extrude' | 'revolve' }>, cache: CellCache) {
  if (cache.has(shape)) return cache.get(shape)!;
  const cells: LocalCell[] = [];
  const verticesByCell = profileCells(shape);
  for (const vertices of verticesByCell) {
    const collider = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices.flat().map((value) => value * auditScale)));
    if (!collider) {
      cache.set(shape, null);
      return null;
    }
    const low: Vec3 = [Infinity, Infinity, Infinity], high: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], vertex[axis]);
      high[axis] = Math.max(high[axis], vertex[axis]);
    }
    cells.push({ shape: collider.shape, center: [(high[0] + low[0]) / 2, (high[1] + low[1]) / 2, (high[2] + low[2]) / 2],
      halfExtents: high.map((value, axis) => (value - low[axis]) / 2) });
  }
  const result = cells.length ? cells : null;
  cache.set(shape, result);
  return result;
}

function validateProfiles(part: PartDefinition, cache: CellCache) {
  for (const [index, piece] of part.geometry.entries()) {
    const shape = piece.shape;
    if (isPhysicalPiece(piece) && (shape.kind === 'extrude' || shape.kind === 'revolve') && !localCells(shape, cache)) {
      throw new Error(`Cannot verify ${part.name} (${part.id}) piece ${index + 1}: its ${shape.kind} profile does not form a valid solid. Use one simple, closed profile without crossing edges, with nonnegative radii for a revolve.`);
    }
  }
}

function scaledPrimitive(shape: Exclude<Shape, { kind: 'extrude' | 'revolve' }>): Shape {
  if (shape.kind === 'box') return { ...shape, size: scale(shape.size, auditScale) };
  if (shape.kind === 'ellipsoid') return { ...shape, radii: scale(shape.radii, auditScale) };
  if (shape.kind === 'sphere') return { ...shape, radius: shape.radius * auditScale };
  return { ...shape, radius: shape.radius * auditScale, height: shape.height * auditScale };
}

function placedCells(piece: PlacedPiece, cache: CellCache): PlacedCell[] {
  const { shape, transform } = piece;
  const translation = scale(transform.position, auditScale);
  if (shape.kind !== 'extrude' && shape.kind !== 'revolve') {
    const collider = colliderAt(scaledPrimitive(shape), { ...transform, position: translation });
    return collider ? [{ center: piece.center, halfExtents: piece.halfExtents, collider }] : [];
  }
  const [x, y, z, w] = transform.rotation;
  const axes = basis.map((axis) => rotate(transform.rotation, axis));
  return (localCells(shape, cache) ?? []).map((cell) => ({
    center: transformPoint(transform, cell.center),
    halfExtents: projectedExtents(cell.halfExtents, axes),
    collider: new RAPIER.ColliderDesc(cell.shape).setTranslation(...translation).setRotation({ x, y, z, w }),
  }));
}

function buildCellTree(cells: PlacedCell[]): CellTree {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cell of cells) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], cell.center[axis] - cell.halfExtents[axis]);
    max[axis] = Math.max(max[axis], cell.center[axis] + cell.halfExtents[axis]);
  }
  const center: Vec3 = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
  const halfExtents = max.map((value, axis) => (value - min[axis]) / 2);
  if (cells.length <= 4) return { center, halfExtents, cells };
  const span = Math.max(...halfExtents);
  const axis = halfExtents.indexOf(span);
  cells.sort((first, second) => first.center[axis] - second.center[axis]);
  const split = Math.floor(cells.length / 2);
  return { center, halfExtents, span, children: [buildCellTree(cells.slice(0, split)), buildCellTree(cells.slice(split))] };
}

function placedCellTree(piece: PlacedPiece, cache: CellCache) {
  if (piece.tree !== undefined) return piece.tree;
  const cells = placedCells(piece, cache);
  piece.tree = cells.length ? buildCellTree(cells) : null;
  return piece.tree;
}

function pieceGap(a: PlacedPiece, b: PlacedPiece, maxGap_m: number, cache: CellCache, budget?: { remaining: number }) {
  const firstTree = placedCellTree(a, cache), secondTree = placedCellTree(b, cache);
  if (!firstTree || !secondTree) return;
  let nearest: number | undefined;
  const visitNearer = (left: [CellTree, CellTree], right: [CellTree, CellTree]): boolean => {
    const leftBound = boundingGapSquared(...left), rightBound = boundingGapSquared(...right);
    return leftBound <= rightBound
      ? visit(...left, leftBound) || visit(...right, rightBound)
      : visit(...right, rightBound) || visit(...left, leftBound);
  };
  const visit = (first: CellTree, second: CellTree, lowerBound: number): boolean => {
    if (budget && budget.remaining-- <= 0) return true;
    if (lowerBound > (nearest ?? maxGap_m) ** 2) return false;
    if ('cells' in first && 'cells' in second) {
      for (const firstCell of first.cells) for (const secondCell of second.cells) {
        if (budget && budget.remaining-- <= 0) return true;
        const limit = nearest ?? maxGap_m;
        if (boundingGapSquared(firstCell, secondCell) > limit ** 2) continue;
        const p = firstCell.collider, q = secondCell.collider;
        const contact = p.shape.contactShape(p.translation, p.rotation, q.shape, q.translation, q.rotation, limit * auditScale);
        if (!contact || !Number.isFinite(contact.distance)) continue;
        const gap = contact.distance / auditScale;
        if (gap > limit) continue;
        nearest = gap;
        if (gap <= contactTolerance_m) return true;
      }
      return false;
    }
    // Split the wider node and test the nearer child pair first, so a measured
    // separation can immediately prune farther pairs.
    if ('children' in first && ('cells' in second || first.span >= second.span)) {
      const [left, right] = first.children;
      return visitNearer([left, second], [right, second]);
    }
    if ('children' in second) {
      const [left, right] = second.children;
      return visitNearer([first, left], [first, right]);
    }
    return false;
  };
  visit(firstTree, secondTree, boundingGapSquared(firstTree, secondTree));
  return budget && budget.remaining < 0 ? undefined : nearest;
}

function auditGroup(instances: PlacedPart[], subjects: PlacedPart[], cache: CellCache): CompoundGeometryIssue[] {
  const pieces: PlacedPiece[] = [];
  const byInstance = new Map<string, number[]>();
  for (const instance of instances) {
    const indices: number[] = [];
    for (const [index, piece] of instance.part.geometry.entries()) {
      if (!isPhysicalPiece(piece)) continue;
      indices.push(pieces.length);
      pieces.push(placedPiece(piece, index + 1, instance));
    }
    byInstance.set(instance.id, indices);
  }
  const parent = pieces.map((_, index) => index);
  const root = (index: number): number => {
    if (parent[index] !== index) parent[index] = root(parent[index]);
    return parent[index];
  };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (root(i) === root(j) || boundingGapSquared(pieces[i], pieces[j]) > contactTolerance_m ** 2) continue;
      const gap = pieceGap(pieces[i], pieces[j], contactTolerance_m, cache);
      if (gap !== undefined && gap <= contactTolerance_m) parent[root(j)] = root(i);
    }
  }

  const issues: CompoundGeometryIssue[] = [];
  for (const instance of subjects) {
    const indices = byInstance.get(instance.id) ?? [];
    const components = new Map<number, number[]>();
    for (const index of indices) {
      const component = root(index);
      if (!components.has(component)) components.set(component, []);
      components.get(component)!.push(pieces[index].number);
    }
    if (components.size <= 1) continue;
    // The largest supported custom part spans 2 m. Query only the subject's own pieces for the repair hint.
    // The topology above is exact even when the optional nearest-gap search is too dense to finish.
    const budget = { remaining: diagnosticPairBudget };
    let nearestGap_m = 2;
    let nearestPieces: [number, number] | null = null;
    for (const [i, first] of indices.entries()) {
      if (budget.remaining < 0) break;
      for (const second of indices.slice(i + 1)) {
        if (root(first) === root(second) || boundingGapSquared(pieces[first], pieces[second]) > nearestGap_m ** 2) continue;
        const gap = pieceGap(pieces[first], pieces[second], nearestGap_m, cache, budget);
        if (budget.remaining < 0) break;
        if (gap === undefined || gap >= nearestGap_m) continue;
        nearestGap_m = gap;
        nearestPieces = [pieces[first].number, pieces[second].number];
      }
    }
    if (budget.remaining < 0) nearestPieces = null;
    issues.push({
      instanceId: instance.id,
      partId: instance.part.id,
      partName: instance.part.name,
      pieceGroups: [...components.values()],
      nearestGap_m: nearestPieces ? nearestGap_m : null,
      nearestPieces,
    });
  }
  return issues;
}

export function auditFixedGeometry(groups: readonly Instance[][], parts: readonly PartDefinition[]) {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const cache: CellCache = new Map();
  for (const part of parts) if (part.source.kind === 'designed') validateProfiles(part, cache);
  const issues: CompoundGeometryIssue[] = [];
  for (const group of groups) {
    const instances: PlacedPart[] = group.flatMap((instance) => {
      const part = partById.get(instance.partId);
      return part ? [{ id: instance.id, part, transform: instance.transform }] : [];
    });
    const subjects = instances.filter(({ part }) => part.source.kind === 'designed' && part.geometry.filter(isPhysicalPiece).length > 1);
    if (subjects.length) issues.push(...auditGroup(instances, subjects, cache));
  }
  return issues;
}

export function auditStandalonePart(part: PartDefinition): CompoundGeometryIssue | undefined {
  const cache: CellCache = new Map();
  validateProfiles(part, cache);
  const instance = { id: part.id, part, transform: IDENTITY };
  return auditGroup([instance], [instance], cache)[0];
}

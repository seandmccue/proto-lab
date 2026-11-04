import RAPIER from '@dimforge/rapier3d-compat';
import { compose, hullPoints, QUAT_ID, quatFromAxisAngle, quatMul, rotate, scale, shapeHalfExtents, transformPoint } from '@protolab/parts';
import { IDENTITY, type Assembly, type GeometryPiece, type Instance, type PartDefinition, type Shape, type Transform, type Vec3 } from '@protolab/schema';
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

function placedPiece(piece: GeometryPiece, number: number, instance: PlacedPart, localExtents = shapeHalfExtents(piece.shape)): PlacedPiece {
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
    halfExtents: projectedExtents(localExtents, basis.map((axis) => rotate(transform.rotation, axis))),
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

function pieceGap(a: PlacedPiece, b: PlacedPiece, maxGap_m: number, cache: CellCache, budget?: { remaining: number }, stopBelow_m = contactTolerance_m) {
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
    if (lowerBound > Math.max(0, nearest ?? maxGap_m) ** 2) return false;
    if ('cells' in first && 'cells' in second) {
      for (const firstCell of first.cells) for (const secondCell of second.cells) {
        if (budget && budget.remaining-- <= 0) return true;
        const limit = Math.max(0, nearest ?? maxGap_m);
        if (boundingGapSquared(firstCell, secondCell) > limit ** 2) continue;
        const p = firstCell.collider, q = secondCell.collider;
        const contact = p.shape.contactShape(p.translation, p.rotation, q.shape, q.translation, q.rotation, limit * auditScale);
        if (!contact || !Number.isFinite(contact.distance)) continue;
        const gap = contact.distance / auditScale;
        if (gap > limit || (nearest !== undefined && gap >= nearest)) continue;
        nearest = gap;
        if (gap < stopBelow_m) return true;
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

/** Use one decomposition cache and bounded solid queries across the sampled poses. */
export function sampledMaterialQueries(assembly: Assembly, instanceIds: ReadonlySet<string>) {
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const cache: CellCache = new Map();
  const budget = { remaining: 2_000_000 };
  const budgetExceeded = 'Rotor clearance exceeded its sampled geometry query limit. Simplify the rotor or nearby supports and rerun the test.';
  const spendQuery = () => {
    if (budget.remaining-- <= 0) throw new Error(budgetExceeded);
  };
  let profileWork = 0;
  let maxCells = 0;
  const instances = assembly.instances.filter(({ id }) => instanceIds.has(id)).map((instance) => {
    const part = parts.get(instance.partId);
    if (!part) throw new Error(`Rotor clearance is missing the part definition for "${instance.id}".`);
    const geometry = part.geometry.flatMap((piece, index) => {
      spendQuery();
      if (!isPhysicalPiece(piece)) return [];
      const shape = piece.shape;
      if (!cache.has(shape) && (shape.kind === 'extrude' || shape.kind === 'revolve')) {
        const vertices = shape.profile.length;
        profileWork += vertices ** 3;
        maxCells += (vertices - 2) * (shape.kind === 'revolve' ? shape.segments : 1);
        if (profileWork > 25_000_000 || maxCells > 24_000) {
          throw new Error(`Rotor clearance profile is too complex near "${instance.id}". Simplify the outline and rerun the test.`);
        }
        if (!localCells(shape, cache)) {
          throw new Error(`Rotor clearance cannot verify "${instance.id}" piece ${index + 1}: its profile does not form a valid solid.`);
        }
      }
      return [{ piece, number: index + 1, localExtents: shapeHalfExtents(shape) }];
    });
    return { instance, part, geometry };
  });

  return (poses: Readonly<Record<string, Transform>>) => {
    const solids = new Map(instances.map(({ instance, part, geometry }) => {
      const transform = poses[instance.id];
      const rotationLength = transform ? Math.hypot(...transform.rotation) : 0;
      if (!transform || !transform.position.every(Number.isFinite) || !Number.isFinite(rotationLength) || rotationLength < 1e-8) {
        throw new Error(`Rotor clearance is missing a valid sampled pose for "${instance.id}".`);
      }
      const placed = { ...instance, part, transform };
      return [instance.id, geometry.map(({ piece, number, localExtents }) => {
        spendQuery();
        return placedPiece(piece, number, placed, localExtents);
      })] as const;
    }));
    return (first: string, second: string, minimumPenetration_m: number): number | undefined => {
      spendQuery();
      // A small prediction absorbs float rounding, while only a signed overlap counts.
      const prediction_m = 1e-8;
      for (const a of solids.get(first) ?? []) for (const b of solids.get(second) ?? []) {
        spendQuery();
        if (boundingGapSquared(a, b) > prediction_m ** 2) continue;
        const gap = pieceGap(a, b, prediction_m, cache, budget, -minimumPenetration_m);
        if (budget.remaining < 0) throw new Error(budgetExceeded);
        if (gap !== undefined && gap < -minimumPenetration_m) return -gap;
      }
    };
  };
}

/** Exact solid contacts for placed pieces. Reuse the profile cell cache across the assembly audit. */
export function assemblySolidQueries(assembly: Assembly) {
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const cache: CellCache = new Map();
  const solids = assembly.instances.flatMap((instance) => {
    const part = parts.get(instance.partId);
    if (!part) return [];
    return part.geometry.flatMap((piece, index) => isPhysicalPiece(piece)
      ? [{ instanceId: instance.id, piece: placedPiece(piece, index + 1, { ...instance, part }) }]
      : []);
  });
  const floor = new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 });
  const origin = { x: 0, y: 0, z: 0 };
  const rotation = { ...origin, w: 1 };
  const bottom = (bounds: Bounds) => bounds.center[1] - bounds.halfExtents[1];
  const contactLimit = contactTolerance_m + 1e-8; // Keep exact 1 mm fits stable across AABB rounding.

  return {
    instanceIds: solids.map(({ instanceId }) => instanceId),
    touches(first: number, second: number) {
      const a = solids[first].piece, b = solids[second].piece;
      return boundingGapSquared(a, b) <= contactLimit ** 2
        && (pieceGap(a, b, contactLimit, cache) ?? Infinity) <= contactLimit;
    },
    floorGap(index: number) {
      const tree = placedCellTree(solids[index].piece, cache);
      let closest = Infinity;
      function visit(node: CellTree) {
        if (bottom(node) >= closest) return;
        if ('children' in node) {
          const [left, right] = node.children;
          const [nearer, farther] = bottom(left) <= bottom(right) ? [left, right] : [right, left];
          visit(nearer);
          visit(farther);
          return;
        }
        for (const cell of node.cells) {
          if (bottom(cell) >= closest) continue;
          const solid = cell.collider;
          const gap = floor.contactShape(origin, rotation, solid.shape, solid.translation, solid.rotation, 5 * auditScale)?.distance;
          if (gap !== undefined && Number.isFinite(gap)) closest = Math.min(closest, gap / auditScale);
        }
      }
      if (tree) visit(tree);
      return Number.isFinite(closest) ? Math.max(0, closest) : null;
    },
    nearest(first: readonly number[], other: readonly number[]) {
      let result: { instanceId: string; gap_m: number } | null = null;
      const budget = { remaining: diagnosticPairBudget };
      for (const left of first) for (const right of other) {
        if (budget.remaining-- <= 0) return null;
        const a = solids[left].piece, b = solids[right].piece;
        const limit = result?.gap_m ?? 2;
        if (boundingGapSquared(a, b) > limit ** 2) continue;
        const gap = pieceGap(a, b, limit, cache, budget);
        if (budget.remaining < 0) return null;
        if (gap === undefined || gap >= limit) continue;
        result = { instanceId: solids[right].instanceId, gap_m: Math.max(0, gap) };
        if (result.gap_m === 0) return result;
      }
      return result;
    },
  };
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

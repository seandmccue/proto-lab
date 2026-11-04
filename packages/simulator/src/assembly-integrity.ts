import type { Assembly, Vec3 } from '@protolab/schema';
import { dot, len, scale, sub, transformDir, transformPoint } from '@protolab/parts';
import { assemblySolidQueries } from './compound-geometry.ts';

const groundTolerance_m = .01;
// Match the existing 1 mm physical-contact tolerance, with room for rounded poses.
const mateRadialTolerance_m = .001;
const mateAxisTolerance_deg = 1;

export interface AssemblyIntegrityIssue {
  kind: 'detached_part' | 'unsupported_anchor' | 'fixed_joint_gap' | 'articulated_joint_misalignment';
  instanceIds: string[];
  jointId?: string;
  nearestInstanceId?: string;
  nearestGap_m: number | null;
  groundGap_m: number | null;
  connectorIds?: [string, string];
  radialGap_m?: number | null;
  anchorRadialGap_m?: number | null;
  axisError_deg?: number | null;
  radialTolerance_m?: number;
  axisTolerance_deg?: number;
  measurementError?: string;
  suggestion: string;
}

/** Check declared bearing/slider axes, without confusing axial spacing with a disconnected mate. */
export function inspectArticulatedMateAlignment(assembly: Assembly): AssemblyIntegrityIssue[] {
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const instances = new Map(assembly.instances.map((instance) => [instance.id, instance]));
  const finiteVector = (value: readonly number[] | undefined, size: number) =>
    Array.isArray(value) && value.length === size && value.every(Number.isFinite);
  const unit = (value: Vec3 | undefined): Vec3 | null => {
    if (!finiteVector(value, 3) || len(value!) < 1e-12) return null;
    return scale(value!, 1 / len(value!));
  };
  const radial = (offset: Vec3, axis: Vec3) => len(sub(offset, scale(axis, dot(offset, axis))));
  const angle = (first: Vec3, second: Vec3) =>
    Math.acos(Math.min(1, Math.abs(dot(first, second)))) * 180 / Math.PI;
  const issues: AssemblyIntegrityIssue[] = [];
  for (const joint of assembly.joints) {
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') continue;
    const first = instances.get(joint.a.instanceId), second = instances.get(joint.b.instanceId);
    const firstConnector = first && parts.get(first.partId)?.connectors.find(({ id }) => id === joint.a.connectorId);
    const secondConnector = second && parts.get(second.partId)?.connectors.find(({ id }) => id === joint.b.connectorId);
    let measurementError: string | undefined;
    let radialGap_m: number | null = null, anchorRadialGap_m: number | null = null, axisError_deg: number | null = null;
    if (!first || !second || !firstConnector || !secondConnector) {
      measurementError = 'A declared joint instance or connector is missing.';
    } else if (![first, second].every(({ transform }) => finiteVector(transform.position, 3)
      && finiteVector(transform.rotation, 4) && Math.hypot(...transform.rotation) > 1e-12)
      || !finiteVector(firstConnector.position, 3) || !finiteVector(secondConnector.position, 3)) {
      measurementError = 'A declared connector position or instance pose is not finite.';
    } else {
      const firstAxis = unit(firstConnector.axis) && unit(transformDir(first.transform, firstConnector.axis));
      const secondAxis = unit(secondConnector.axis) && unit(transformDir(second.transform, secondConnector.axis));
      const effectiveAxis = joint.axis === undefined ? firstAxis : unit(joint.axis);
      if (!firstAxis || !secondAxis || !effectiveAxis) {
        measurementError = 'A connector or saved joint axis is zero or non-finite.';
      } else if (joint.anchor !== undefined && !finiteVector(joint.anchor, 3)) {
        measurementError = 'The saved joint anchor is not finite.';
      } else {
        const firstPoint = transformPoint(first.transform, firstConnector.position);
        const secondPoint = transformPoint(second.transform, secondConnector.position);
        radialGap_m = radial(sub(secondPoint, firstPoint), effectiveAxis);
        anchorRadialGap_m = joint.anchor ? radial(sub(joint.anchor, firstPoint), effectiveAxis) : 0;
        axisError_deg = Math.max(angle(firstAxis, secondAxis), angle(firstAxis, effectiveAxis), angle(secondAxis, effectiveAxis));
        if (![radialGap_m, anchorRadialGap_m, axisError_deg].every(Number.isFinite)) {
          measurementError = 'The declared mate geometry cannot produce a finite alignment measurement.';
          radialGap_m = anchorRadialGap_m = axisError_deg = null;
        }
      }
    }
    if (!measurementError && radialGap_m! <= mateRadialTolerance_m + 1e-8
      && anchorRadialGap_m! <= mateRadialTolerance_m + 1e-8 && axisError_deg! <= mateAxisTolerance_deg + 1e-8) continue;
    const endpoints = `${joint.a.instanceId}.${joint.a.connectorId} and ${joint.b.instanceId}.${joint.b.connectorId}`;
    issues.push({
      kind: 'articulated_joint_misalignment', instanceIds: [joint.a.instanceId, joint.b.instanceId], jointId: joint.id,
      connectorIds: [joint.a.connectorId, joint.b.connectorId], nearestGap_m: null, groundGap_m: null,
      radialGap_m, anchorRadialGap_m, axisError_deg,
      radialTolerance_m: mateRadialTolerance_m, axisTolerance_deg: mateAxisTolerance_deg,
      ...(measurementError ? { measurementError } : {}),
      suggestion: `Re-mate ${endpoints} on the same physical hinge or slider axis, then rebuild their joint if its saved axis or anchor is stale. Use mount or bridge to fit the actual connectors; preserve the original tests. Coaxial shaft spacing and travel along a slider axis are allowed, but sideways gaps or tilted axes cannot be joined by an invisible pivot.`,
    });
  }
  return issues;
}

function components(size: number) {
  const parents = Array.from({ length: size }, (_, index) => index);
  function root(index: number) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  return {
    root,
    join(first: number, second: number) { parents[root(second)] = root(first); },
  };
}

/** Audit the assembled pose. Articulated mechanisms remain subject to the physics test. */
export function inspectAssemblyIntegrity(assembly: Assembly): AssemblyIntegrityIssue[] {
  const solids = assemblySolidQueries(assembly);
  const instances = new Map(assembly.instances.map((instance, index) => [instance.id, index]));
  const byInstance = new Map<string, number[]>();
  for (const [index, id] of solids.instanceIds.entries()) {
    const indices = byInstance.get(id) ?? [];
    indices.push(index);
    byInstance.set(id, indices);
  }
  const fixed = assembly.joints.filter((joint) => joint.type === 'fixed');
  const declared = components(assembly.instances.length);
  const mechanism = components(assembly.instances.length);
  for (const joint of assembly.joints) {
    const first = instances.get(joint.a.instanceId), second = instances.get(joint.b.instanceId);
    if (first === undefined || second === undefined) continue;
    mechanism.join(first, second);
    if (joint.type === 'fixed') declared.join(first, second);
  }
  const stationary = new Set(assembly.instances.flatMap((instance, index) => instance.anchored ? [declared.root(index)] : []));
  const declaredGroups = solids.instanceIds.map((id) => declared.root(instances.get(id)!));
  const stationarySolids = declaredGroups.map((group) => stationary.has(group));
  const fixedMaterial = components(solids.instanceIds.length);
  for (let first = 0; first < solids.instanceIds.length; first++) {
    for (let second = first + 1; second < solids.instanceIds.length; second++) {
      if (declaredGroups[first] !== declaredGroups[second] || fixedMaterial.root(first) === fixedMaterial.root(second)) continue;
      if (solids.touches(first, second)) fixedMaterial.join(first, second);
    }
  }

  const ground = new Map<number, number | null>();
  function gapToFloor(index: number) {
    if (!ground.has(index)) ground.set(index, solids.floorGap(index));
    return ground.get(index) ?? null;
  }
  function floorGap(indices: readonly number[]) {
    const minimum = Math.min(...indices.map((index) => gapToFloor(index) ?? Infinity));
    return Number.isFinite(minimum) ? minimum : null;
  }
  function nearestFields(subject: readonly number[], candidates: readonly number[]) {
    const nearest = solids.nearest(subject, candidates);
    return {
      ...(nearest ? { nearestInstanceId: nearest.instanceId } : {}),
      nearestGap_m: nearest?.gap_m ?? null,
    };
  }

  const issues: AssemblyIntegrityIssue[] = inspectArticulatedMateAlignment(assembly);
  const staticComponents = new Map<number, number[]>();
  for (const [index, isStatic] of stationarySolids.entries()) {
    if (!isStatic) continue;
    const root = fixedMaterial.root(index);
    const group = staticComponents.get(root) ?? [];
    group.push(index);
    staticComponents.set(root, group);
  }
  const staticRegions = [...staticComponents.values()].map((indices) => ({ indices, groundGap_m: floorGap(indices) }));
  const grounded = staticRegions.flatMap(({ indices, groundGap_m }) => groundGap_m !== null && groundGap_m <= groundTolerance_m ? indices : []);
  for (const { indices, groundGap_m } of staticRegions) {
    if (groundGap_m !== null && groundGap_m <= groundTolerance_m) continue;
    issues.push({
      kind: 'unsupported_anchor',
      instanceIds: [...new Set(indices.map((index) => solids.instanceIds[index]))],
      groundGap_m,
      ...nearestFields(indices, grounded),
      suggestion: 'Seat the fixture on the floor or join it to a grounded support with a visible fixed bracket or stand.',
    });
  }

  const anchoredMechanisms = new Set(assembly.instances.flatMap(({ anchored }, index) => anchored ? [mechanism.root(index)] : []));
  const articulatedMechanisms = new Set(assembly.joints.flatMap(({ type, a }) => {
    const index = instances.get(a.instanceId);
    return type === 'fixed' || index === undefined ? [] : [mechanism.root(index)];
  }));
  // On articulated assemblies, free can enable contact on one part without making the machine a loose payload.
  const intentionallyFree = new Set(assembly.instances.flatMap(({ free }, index) => {
    const group = mechanism.root(index);
    return free && !articulatedMechanisms.has(group) ? [group] : [];
  }));
  const mechanismGroups = solids.instanceIds.map((id) => mechanism.root(instances.get(id)!));
  const detachedGroups = new Map<number, number[]>();
  for (const [index, group] of mechanismGroups.entries()) {
    if (anchoredMechanisms.has(group) || intentionallyFree.has(group)) continue;
    const indices = detachedGroups.get(group) ?? [];
    indices.push(index);
    detachedGroups.set(group, indices);
  }
  for (const [group, indices] of detachedGroups) {
    const groundGap_m = floorGap(indices);
    if (groundGap_m === null || groundGap_m <= groundTolerance_m) continue;
    issues.push({
      kind: 'detached_part',
      instanceIds: [...new Set(indices.map((index) => solids.instanceIds[index]))],
      groundGap_m,
      ...nearestFields(indices, mechanismGroups.flatMap((other, index) => other === group ? [] : [index])),
      suggestion: 'Join the detached solids to their physical mount or seat them on the floor. Use free only for an intentional loose payload.',
    });
  }

  for (const joint of fixed) {
    const first = byInstance.get(joint.a.instanceId), second = byInstance.get(joint.b.instanceId);
    if (!first?.length || !second?.length) continue;
    const regions = new Set(first.map(fixedMaterial.root));
    if (second.some((index) => regions.has(fixedMaterial.root(index)))) continue;
    issues.push({
      kind: 'fixed_joint_gap',
      instanceIds: [joint.a.instanceId, joint.b.instanceId],
      jointId: joint.id,
      groundGap_m: null,
      ...nearestFields(first, second),
      suggestion: 'Seat the connected solids together or add a physical bracket across the gap in this fixed assembly.',
    });
  }
  return issues;
}

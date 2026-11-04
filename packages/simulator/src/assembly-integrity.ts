import type { Assembly } from '@protolab/schema';
import { assemblySolidQueries } from './compound-geometry.ts';

const groundTolerance_m = .01;

export interface AssemblyIntegrityIssue {
  kind: 'detached_part' | 'unsupported_anchor' | 'fixed_joint_gap';
  instanceIds: string[];
  jointId?: string;
  nearestInstanceId?: string;
  nearestGap_m: number | null;
  groundGap_m: number | null;
  suggestion: string;
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

  const issues: AssemblyIntegrityIssue[] = [];
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

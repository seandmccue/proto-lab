import { piecesBoundingRadius } from '@protolab/parts';
import type { Assembly, Instance, Trace, Transform } from '@protolab/schema';
import { isPhysicalPiece, sampledMaterialQueries } from './compound-geometry.ts';

const minimumPenetration_m = .0001;
const maximumAssemblyPairs = 32_640;
const maximumAssemblyPairSamples = 4_000_000;
type FixedGroup = { members: readonly Instance[] };
type Pair = readonly [string, string];

export interface SampledClearanceIssue {
  firstId: string;
  secondId: string;
  time_s: number;
  penetration_m: number;
}

export interface SampledClearance {
  pairsChecked: number;
  samplesChecked: number;
  issues: SampledClearanceIssue[];
  complete: boolean;
  failureReason?: string;
}

function pairKey(first: string, second: string) {
  return JSON.stringify([first, second].sort());
}

function expandedPairs(assembly: Assembly, fixedGroups: readonly FixedGroup[], requested?: readonly Pair[]) {
  const groups = new Map(fixedGroups.flatMap((group, index) => group.members.map(({ id }) => [id, index] as const)));
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const mates = new Set(assembly.joints.map(({ a, b }) => pairKey(a.instanceId, b.instanceId)));
  const visited = new Set<string>();
  const pairs: Pair[] = [];
  const members = new Map<number, Instance[]>();
  const physicalMembers = (group: number) => {
    let physical = members.get(group);
    if (!physical) {
      physical = fixedGroups[group].members.filter(({ id, partId }) => {
        const part = parts.get(partId);
        if (!part) throw new Error(`Clearance check is missing the part definition for "${id}".`);
        return part.geometry.some(isPhysicalPiece);
      });
      members.set(group, physical);
    }
    return physical;
  };
  const addPairs = (first: number, second: number) => {
    const left = physicalMembers(first), right = physicalMembers(second);
    for (const a of left) for (const b of right) {
      if (mates.has(pairKey(a.id, b.id))) continue;
      if (!requested && pairs.length >= maximumAssemblyPairs) {
        throw new Error('Assembly clearance exceeded its part-pair limit. Simplify the assembly and rerun the test.');
      }
      pairs.push([a.id, b.id]);
    }
  };
  if (!requested) {
    for (let first = 0; first < fixedGroups.length; first++) {
      physicalMembers(first);
      for (let second = first + 1; second < fixedGroups.length; second++) addPairs(first, second);
    }
    return pairs;
  }
  for (const [firstId, secondId] of requested) {
    const first = groups.get(firstId), second = groups.get(secondId);
    if (first === undefined || second === undefined) {
      throw new Error(`Clearance check instance "${first === undefined ? firstId : secondId}" not found.`);
    }
    const key = pairKey(String(first), String(second));
    if (first === second || visited.has(key)) continue;
    visited.add(key);
    addPairs(first, second);
  }
  return pairs;
}

function samePose(first: Transform | undefined, second: Transform) {
  return first?.position.every((value, index) => value === second.position[index])
    && first.rotation.every((value, index) => value === second.rotation[index]);
}

function separationBroadPhase(assembly: Assembly, instanceIds: ReadonlySet<string>) {
  const radii = new Map(assembly.parts.map(part => [part.id, piecesBoundingRadius(part.geometry.filter(isPhysicalPiece))]));
  const instances = assembly.instances.filter(({ id }) => instanceIds.has(id));
  let previous: Trace['frames'][number]['bodies'] | undefined;
  return (bodies: Trace['frames'][number]['bodies']) => {
    const unchanged = new Set<string>();
    const radius = new Map(instances.map(({ id, partId }) => {
      const pose = bodies[id];
      if (samePose(previous?.[id], pose)) unchanged.add(id);
      const length = Math.hypot(...pose.rotation);
      // Piece orientations are normalized by material queries. The instance quaternion
      // can still stretch piece-center offsets when it is composed, so bound that too.
      return [id, (radii.get(partId) ?? Infinity) * Math.max(1, 2 * length ** 2 - 1) + 1e-8];
    }));
    previous = bodies;
    return ([first, second]: Pair) => {
      if (unchanged.has(first) && unchanged.has(second)) return true;
      const a = bodies[first].position, b = bodies[second].position;
      const reach = radius.get(first)! + radius.get(second)!;
      return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 > reach ** 2;
    };
  };
}

/** Inspect authored pairs across their rigid groups, or all groups when no list is supplied. */
export function inspectSampledClearance(
  assembly: Assembly, trace: Trace, fixedGroups: readonly FixedGroup[], clearancePairs?: readonly Pair[],
): SampledClearance {
  const issues: SampledClearanceIssue[] = [];
  let samplesChecked = 0;
  try {
    const pairs = expandedPairs(assembly, fixedGroups, clearancePairs);
    if (!pairs.length) return { pairsChecked: 0, samplesChecked, issues, complete: true };
    if (!trace.frames.length) throw new Error('Clearance checks require recorded simulation poses.');
    if (!clearancePairs && pairs.length * trace.frames.length > maximumAssemblyPairSamples) {
      throw new Error('Assembly clearance exceeded its sampled pair limit. Simplify the assembly or shorten the test.');
    }
    const instanceIds = new Set(pairs.flat());
    const materialAt = sampledMaterialQueries(assembly, instanceIds);
    const broadPhase = clearancePairs ? undefined : separationBroadPhase(assembly, instanceIds);
    const obstructed = new Set<Pair>();
    let previousTime_s = -Infinity;
    for (const { t, bodies } of trace.frames) {
      if (!Number.isFinite(t) || t < 0 || t <= previousTime_s) {
        throw new Error('Clearance checks require ordered, finite trace timestamps.');
      }
      const penetration = materialAt(bodies);
      const canSkip = broadPhase?.(bodies);
      for (const pair of pairs) {
        if (obstructed.has(pair) || canSkip?.(pair)) continue;
        const [firstId, secondId] = pair;
        const depth = penetration(firstId, secondId, minimumPenetration_m);
        if (depth === undefined) continue;
        obstructed.add(pair);
        issues.push({ firstId, secondId, time_s: t, penetration_m: depth });
      }
      previousTime_s = t;
      samplesChecked++;
    }
    return { pairsChecked: pairs.length, samplesChecked, issues, complete: true };
  } catch (error) {
    const failureReason = error instanceof Error
      ? error.message.replace(/^Rotor clearance/, 'Clearance check').replace('the rotor or nearby supports', 'the listed parts')
      : 'Clearance check could not verify the sampled geometry.';
    return { pairsChecked: issues.length, samplesChecked, issues, complete: false, failureReason };
  }
}

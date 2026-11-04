import type { Assembly, Instance, Trace } from '@protolab/schema';
import { isPhysicalPiece, sampledMaterialQueries } from './compound-geometry.ts';

const minimumPenetration_m = .0001;
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

function expandedPairs(assembly: Assembly, fixedGroups: readonly FixedGroup[], requested: readonly Pair[]) {
  const groups = new Map(fixedGroups.flatMap((group, index) => group.members.map(({ id }) => [id, index] as const)));
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const mates = new Set(assembly.joints.map(({ a, b }) => pairKey(a.instanceId, b.instanceId)));
  const visited = new Set<string>();
  const pairs: Pair[] = [];
  const physicalMembers = (group: number) => fixedGroups[group].members.filter(({ id, partId }) => {
    const part = parts.get(partId);
    if (!part) throw new Error(`Clearance check is missing the part definition for "${id}".`);
    return part.geometry.some(isPhysicalPiece);
  });
  for (const [firstId, secondId] of requested) {
    const first = groups.get(firstId), second = groups.get(secondId);
    if (first === undefined || second === undefined) {
      throw new Error(`Clearance check instance "${first === undefined ? firstId : secondId}" not found.`);
    }
    const key = pairKey(String(first), String(second));
    if (first === second || visited.has(key)) continue;
    visited.add(key);
    const left = physicalMembers(first), right = physicalMembers(second);
    for (const a of left) for (const b of right) {
      if (!mates.has(pairKey(a.id, b.id))) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

/** Inspect authored clearance pairs across their rigid groups without changing solver contacts. */
export function inspectSampledClearance(
  assembly: Assembly, trace: Trace, fixedGroups: readonly FixedGroup[], clearancePairs: readonly Pair[],
): SampledClearance {
  const issues: SampledClearanceIssue[] = [];
  let samplesChecked = 0;
  try {
    const pairs = expandedPairs(assembly, fixedGroups, clearancePairs);
    if (!pairs.length) return { pairsChecked: 0, samplesChecked, issues, complete: true };
    if (!trace.frames.length) throw new Error('Clearance checks require recorded simulation poses.');
    const materialAt = sampledMaterialQueries(assembly, new Set(pairs.flat()));
    const obstructed = new Set<Pair>();
    let previousTime_s = -Infinity;
    for (const { t, bodies } of trace.frames) {
      if (!Number.isFinite(t) || t < 0 || t <= previousTime_s) {
        throw new Error('Clearance checks require ordered, finite trace timestamps.');
      }
      const penetration = materialAt(bodies);
      for (const pair of pairs) {
        if (obstructed.has(pair)) continue;
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

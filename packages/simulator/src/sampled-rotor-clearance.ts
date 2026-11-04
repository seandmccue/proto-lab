import type { Assembly, Instance, Trace } from '@protolab/schema';
import { isPhysicalPiece, sampledMaterialQueries } from './compound-geometry.ts';

const minimumPenetration_m = .0001;

interface RotorPair {
  rotorId: string;
  obstacleId: string;
}

export interface SampledRotorClearanceIssue extends RotorPair {
  time_s: number;
  penetration_m: number;
}

export interface SampledRotorClearance {
  pairsChecked: number;
  samplesChecked: number;
  issues: SampledRotorClearanceIssue[];
  complete: boolean;
  failureReason?: string;
}

function rotorPairs(assembly: Assembly, fixedGroups: readonly { members: readonly Instance[] }[]) {
  const groups = new Map(fixedGroups.flatMap((group) => group.members.map(({ id }) => [id, group] as const)));
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  const isPropeller = (instance: Instance) => parts.get(instance.partId)?.category === 'propellers';
  const pairKey = (first: string, second: string) => JSON.stringify([first, second].sort());
  const directMates = new Set(assembly.joints.map(({ a, b }) => pairKey(a.instanceId, b.instanceId)));
  const pairs = new Map<string, RotorPair>();
  for (const joint of assembly.joints) {
    if (joint.type !== 'revolute' || !joint.motor) continue;
    const first = groups.get(joint.a.instanceId), second = groups.get(joint.b.instanceId);
    if (!first || !second || first === second) continue;
    const firstRotors = first.members.filter(isPropeller), secondRotors = second.members.filter(isPropeller);
    // A propeller rigid group must spin relative to a non-propeller stator group.
    if (Boolean(firstRotors.length) === Boolean(secondRotors.length)) continue;
    const rotors = firstRotors.length ? firstRotors : secondRotors;
    const stator = firstRotors.length ? second : first;
    for (const rotor of rotors) {
      if (rotor.free) continue;
      if (!parts.get(rotor.partId)?.geometry.some(isPhysicalPiece)) {
        throw new Error(`Rotor clearance cannot verify "${rotor.id}" without physical rotor geometry.`);
      }
      for (const obstacle of stator.members) {
        const key = pairKey(rotor.id, obstacle.id);
        if (obstacle.free || directMates.has(key)) continue;
        const part = parts.get(obstacle.partId);
        if (part && !part.geometry.some(isPhysicalPiece)) continue;
        pairs.set(key, { rotorId: rotor.id, obstacleId: obstacle.id });
      }
    }
  }
  return [...pairs.values()];
}

/** Check the material geometry at recorded poses, without enabling solver contacts. */
export function inspectSampledRotorClearance(assembly: Assembly, trace: Trace, fixedGroups: readonly { members: readonly Instance[] }[]): SampledRotorClearance {
  const issues: SampledRotorClearanceIssue[] = [];
  let samplesChecked = 0;
  try {
    const pairs = rotorPairs(assembly, fixedGroups);
    if (!pairs.length) return { pairsChecked: 0, samplesChecked, issues, complete: true };
    if (!trace.frames.length) throw new Error('Rotor clearance requires recorded simulation poses.');
    const instanceIds = new Set(pairs.flatMap(({ rotorId, obstacleId }) => [rotorId, obstacleId]));
    const materialAt = sampledMaterialQueries(assembly, instanceIds);
    const obstructed = new Set<RotorPair>();
    let previousTime_s = -Infinity;
    for (const { t, bodies } of trace.frames) {
      if (!Number.isFinite(t) || t < 0 || t <= previousTime_s) throw new Error('Rotor clearance requires ordered, finite trace timestamps.');
      const penetration = materialAt(bodies);
      for (const pair of pairs) {
        if (obstructed.has(pair)) continue;
        const depth = penetration(pair.rotorId, pair.obstacleId, minimumPenetration_m);
        if (depth === undefined) continue;
        obstructed.add(pair);
        issues.push({ ...pair, time_s: t, penetration_m: depth });
      }
      previousTime_s = t;
      samplesChecked++;
    }
    return { pairsChecked: pairs.length, samplesChecked, issues, complete: true };
  } catch (error) {
    return {
      pairsChecked: issues.length,
      samplesChecked,
      issues,
      complete: false,
      failureReason: error instanceof Error ? error.message : 'Rotor clearance could not verify the sampled geometry.',
    };
  }
}

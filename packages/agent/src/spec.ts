import { Spec } from '@protolab/schema';

/** Deterministic interpretation of a prompt into an explicit, editable spec. The model may refine it. */
export function heuristicSpec(prompt: string, base?: Spec): Spec {
  const p = prompt.toLowerCase();
  const legCount: 4 | 6 = /\b(six|6)[\s-]*leg/.test(p) || /hexapod/.test(p) ? 6 : /\b(four|4)[\s-]*leg|quadruped/.test(p) ? 4 : base?.constraints.legCount ?? 4;
  let walkDistance = base?.targets.walkDistance_m ?? 0.3;
  const m = p.match(/(\d+(?:\.\d+)?)\s*(m|metre|meter|cm)\b/);
  if (m) walkDistance = m[2] === 'cm' ? +m[1] / 100 : +m[1];
  const pct = p.match(/(\d+)\s*%/);
  if (pct && /(further|farther|range|distance|more)/.test(p)) walkDistance = +(walkDistance * (1 + +pct[1] / 100)).toFixed(3);
  if (/double/.test(p) && /(distance|range|far)/.test(p)) walkDistance = +(walkDistance * 2).toFixed(3);
  const followUps: Array<'dance'> = /dance|dancing/.test(p) ? ['dance'] : base?.followUps ?? [];
  const assumptions = [
    'Rigid-body simulation only; no material deformation, fatigue or manufacturing tolerances are modelled.',
    'Servo torque is checked against the catalog rating; the position-servo model has no saturation.',
    'Ground is flat with a friction coefficient of 0.9 (rubber on wood).',
    `Walking direction is +X; the body must stay within ${base?.targets.maxTilt_deg ?? 25}° of upright.`,
  ];
  return Spec.parse({
    task: prompt,
    family: 'legged_walker',
    targets: { walkDistance_m: walkDistance, maxTilt_deg: base?.targets.maxTilt_deg ?? 25, duration_s: base?.targets.duration_s ?? 6 },
    environment: { gravity_m_s2: 9.81, groundFriction: 0.9 },
    constraints: { legCount, maxBodyLength_m: 0.25, maxMass_kg: legCount === 6 ? 1.5 : 1.0, maxParts: 60 },
    followUps,
    assumptions,
  });
}

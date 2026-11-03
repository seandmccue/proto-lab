import { Spec } from '@protolab/schema';

/** Baseline spec before the model writes its plan. Honest defaults; nothing invention-specific. */
export function baseSpec(prompt: string, base?: Spec): Spec {
  return Spec.parse({
    task: prompt,
    plan: base?.plan,
    environment: base?.environment ?? { gravity_m_s2: 9.81, groundFriction: 0.9 },
    constraints: base?.constraints ?? { maxMass_kg: 5, maxParts: 80, maxSize_m: 1.5 },
    assumptions: base?.assumptions ?? [
      'Rigid-body simulation only: no aerodynamics, fluid, deformation, fatigue or manufacturing tolerances are modelled.',
      'Motors are position/velocity servos saturated at their catalog rating; gears mesh is not modelled tooth-by-tooth.',
      'Ground is a flat plane at y = 0 with friction 0.9.',
    ],
    followUps: base?.followUps ?? [],
  });
}

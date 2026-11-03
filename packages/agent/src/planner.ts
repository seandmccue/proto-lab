import { searchCatalog, DEFAULT_WALKER, DEFAULT_DANCE, type WalkerParams } from '@protolab/parts';
import type { Spec, TestResult } from '@protolab/schema';
import type { ToolRuntime } from './tools.ts';

/**
 * Deterministic planner used when no model key is configured. Every revision is a fixed rule
 * applied to a measured test result; nothing is scripted to fail.
 */
export async function runPlanner(rt: ToolRuntime, spec: Spec, opts: { startParams?: WalkerParams; changeRequest?: string; maxIterations: number }): Promise<void> {
  const base: WalkerParams = opts.startParams ?? { ...DEFAULT_WALKER, legCount: spec.constraints.legCount, chassisPartId: spec.constraints.legCount === 6 ? 'chassis-hex-200' : 'chassis-quad-160', gait: { ...DEFAULT_WALKER.gait, gaitType: spec.constraints.legCount === 6 ? 'tripod' : 'crawl', swingDuty: spec.constraints.legCount === 6 ? 0.5 : DEFAULT_WALKER.gait.swingDuty } };
  let params = applyChangeRequest(base, spec, opts.changeRequest);
  if (params.legCount !== spec.constraints.legCount) {
    params = { ...params, legCount: spec.constraints.legCount, chassisPartId: spec.constraints.legCount === 6 ? 'chassis-hex-200' : 'chassis-quad-160', gait: { ...params.gait, gaitType: spec.constraints.legCount === 6 ? 'tripod' : 'crawl', swingDuty: spec.constraints.legCount === 6 ? 0.5 : 0.22 } };
  }
  await rt.call('search_catalog', { query: 'servo', category: 'motors' });
  await rt.call('search_catalog', { query: 'leg bar chassis', category: 'frames' });
  await rt.call('build_walker', { params, rationale: opts.startParams ? `Starting from the parent design${opts.changeRequest ? ` and applying the request: "${opts.changeRequest}"` : ''}.` : `Starting from catalog defaults: ${params.chassisPartId} chassis, ${params.hipServoPartId} servos, ${params.upperLegPartId} leg bars, ${params.gait.gaitType} gait at ${params.gait.frequency_hz} Hz.` });

  let last: TestResult | null = null;
  for (let i = 0; i < opts.maxIterations; i++) {
    const r = (await rt.call('run_test', { kind: 'walk' })) as { passed: boolean; metrics: Record<string, number>; failureReasons: string[]; testId: string; error?: string };
    if ('error' in r && r.error) break;
    last = rt.tests[rt.tests.length - 1];
    if (r.passed) break;
    const revision = planRevision(rt.params!, r, rt);
    if (!revision) break;
    await rt.call('revise_walker', { changes: revision.changes, rationale: revision.rationale, based_on: `${r.testId}: ${r.failureReasons[0] ?? 'failed'}` });
  }

  if (spec.followUps.includes('dance') && last?.passed) {
    for (let k = 0; k < 2; k++) {
      const d = (await rt.call('run_test', { kind: 'dance' })) as { passed: boolean; failureReasons: string[]; testId: string; metrics: Record<string, number> };
      if (d.passed || k === 1) break;
      const dm = d.metrics;
      const dance = rt.params!.dance ?? DEFAULT_DANCE;
      if (dm.fell || dm.maxTilt_deg > spec.targets.maxTilt_deg) await rt.call('revise_walker', { changes: { 'dance.bobAmplitude_rad': +(dance.bobAmplitude_rad * 0.6).toFixed(3), 'dance.frequency_hz': +(dance.frequency_hz * 0.75).toFixed(3) }, rationale: `Dance test ${d.testId} failed (${d.failureReasons[0]}); smaller, slower bobbing keeps the body inside its support polygon.`, based_on: `${d.testId}: ${d.failureReasons[0]}` });
      else await rt.call('revise_walker', { changes: { 'dance.swayAmplitude_rad': +(dance.swayAmplitude_rad * 0.5).toFixed(3) }, rationale: `Dance test ${d.testId} drifted ${Math.hypot(dm.distance_m, dm.lateralDrift_m).toFixed(3)} m; halving the hip sway so the feet scissor in place instead of pushing the body along.`, based_on: `${d.testId}: ${d.failureReasons[0]}` });
    }
  }

  const walkPassed = rt.tests.some((t) => t.kind === 'walk' && t.passed);
  const dancePassed = rt.tests.some((t) => t.kind === 'dance' && t.passed);
  const danceAsked = spec.followUps.includes('dance');
  const lastWalk = [...rt.tests].reverse().find((t) => t.kind === 'walk');
  const summary = walkPassed
    ? `Walked ${lastWalk?.metrics.distance_m} m in ${spec.targets.duration_s} s with ${lastWalk?.metrics.maxTilt_deg}° peak tilt after ${rt.tests.filter((t) => t.kind === 'walk').length} walk test(s).${danceAsked ? dancePassed ? ' The dance test also passed.' : ' The dance test did not pass; see its failure reasons.' : ''}`
    : `Prototype did not pass the walk test after ${rt.tests.filter((t) => t.kind === 'walk').length} iteration(s). Best distance ${Math.max(...rt.tests.filter((t) => t.kind === 'walk').map((t) => t.metrics.distance_m))} m. The design is inspectable; retry with different constraints.`;
  await rt.call('finalize_design', { summary, status: walkPassed && (!danceAsked || dancePassed) ? 'passed' : 'failed' });
}

export function applyChangeRequest(base: WalkerParams, spec: Spec, req?: string): WalkerParams {
  if (!req) return base;
  const p = req.toLowerCase();
  let next: WalkerParams = { ...base, gait: { ...base.gait } };
  if (/\b(six|6)[\s-]*leg|hexapod/.test(p)) next = { ...next, legCount: 6, chassisPartId: 'chassis-hex-200', gait: { ...next.gait, gaitType: 'tripod', swingDuty: 0.5 } };
  if (/\b(four|4)[\s-]*leg|quadruped/.test(p)) next = { ...next, legCount: 4, chassisPartId: 'chassis-quad-160', gait: { ...next.gait, gaitType: 'crawl', swingDuty: 0.22 } };
  if (/(faster|quick|speed|further|farther|double|more distance|range)/.test(p)) next.gait = { ...next.gait, hipAmplitude_rad: Math.min(0.9, next.gait.hipAmplitude_rad * 1.25), frequency_hz: Math.min(4, next.gait.frequency_hz * 1.2) };
  if (/(slower|calmer|gentle)/.test(p)) next.gait = { ...next.gait, frequency_hz: Math.max(0.3, next.gait.frequency_hz * 0.7) };
  if (/(taller|longer legs|higher)/.test(p)) next = { ...next, upperLegPartId: 'leg-bar-80', lowerLegPartId: 'leg-bar-80' };
  if (/(shorter legs|lower|squat)/.test(p)) next = { ...next, upperLegPartId: 'leg-bar-40', lowerLegPartId: 'leg-bar-40' };
  if (/(bigger|larger|stronger) (servo|motor)/.test(p)) next = { ...next, hipServoPartId: 'servo-ds3218', kneeServoPartId: 'servo-ds3218' };
  if (/no shell|without shell|remove (the )?shell/.test(p)) next.shell = false;
  void spec;
  return next;
}

function planRevision(params: WalkerParams, r: { metrics: Record<string, number>; failureReasons: string[] }, rt: ToolRuntime): { changes: Record<string, unknown>; rationale: string } | null {
  const m = r.metrics;
  const g = params.gait;
  const feet = rt.summariseAssembly(rt.assembly!).footOffsets;
  const meanFootOffset = feet.reduce((s, f) => s + f.footBehindHip_m, 0) / feet.length;
  // 1. Fell with feet behind the hips → centre the feet (geometry fix).
  if (m.fell && Math.abs(meanFootOffset) > 0.01 && Math.abs(params.hipOffset_rad - params.kneeFlex_rad / 2) > 0.02) {
    const to = +(params.kneeFlex_rad / 2).toFixed(3);
    return { changes: { hipOffset_rad: to }, rationale: `The robot fell at ${m.fellAt_s} s; feet sit ${(meanFootOffset * 1000).toFixed(0)} mm behind the hips so the support polygon misses the centre of mass. Rotating the rest hip angle to ${to} rad centres the feet under the hips.` };
  }
  // 2. Fell with centred feet → calmer gait before anything else (torque spikes during a fall are not a servo problem).
  if (m.fell) {
    return { changes: { 'gait.frequency_hz': +Math.max(0.4, g.frequency_hz * 0.8).toFixed(3), 'gait.hipAmplitude_rad': +Math.max(0.1, g.hipAmplitude_rad * 0.85).toFixed(3), 'gait.kneeAmplitude_rad': +Math.max(0.05, g.kneeAmplitude_rad * 0.7).toFixed(3) }, rationale: `Fell at ${m.fellAt_s} s with ${m.maxTilt_deg}° tilt while stepping. Slowing the stride (${g.frequency_hz} → ${(g.frequency_hz * 0.8).toFixed(2)} Hz) and lowering step height to cut the rocking that tipped it.` };
  }
  // 3. Walked without falling but servo torque demand exceeds the rating → pick a stronger servo with 25 % margin.
  const hipOver = m.peakHipTorque_Nm > m.hipServoRating_Nm, kneeOver = m.peakKneeTorque_Nm > m.kneeServoRating_Nm;
  if (hipOver || kneeOver) {
    const need = Math.max(hipOver ? m.peakHipTorque_Nm : 0, kneeOver ? m.peakKneeTorque_Nm : 0) * 1.25;
    const servos = searchCatalog('servo', { category: 'motors' }).sort((a, b) => (a.limits.maxTorque_Nm ?? 0) - (b.limits.maxTorque_Nm ?? 0));
    const pick = servos.find((s) => (s.limits.maxTorque_Nm ?? 0) >= need) ?? servos[servos.length - 1];
    if (pick.id !== params.hipServoPartId || pick.id !== params.kneeServoPartId) {
      return { changes: { hipServoPartId: pick.id, kneeServoPartId: pick.id }, rationale: `Measured torque demand (hip ${m.peakHipTorque_Nm} N·m, knee ${m.peakKneeTorque_Nm} N·m) exceeds the ${m.hipServoRating_Nm} N·m servo rating. Selecting ${pick.name} (${pick.limits.maxTorque_Nm} N·m) with 25 % margin; it is heavier, so the gait may need retuning.` };
    }
  }
  // 4. Too much rocking.
  if (m.maxTilt_deg > rt.spec.targets.maxTilt_deg) {
    return { changes: { 'gait.kneeAmplitude_rad': +(g.kneeAmplitude_rad * 0.7).toFixed(3), 'gait.stiffness': +Math.min(50, g.stiffness * 1.5).toFixed(3) }, rationale: `Peak tilt ${m.maxTilt_deg}° exceeds the ${rt.spec.targets.maxTilt_deg}° limit. Lower step height and stiffer servos reduce body rocking.` };
  }
  // 5. Stable but short → longer stride first, then faster.
  if (m.distance_m < rt.spec.targets.walkDistance_m) {
    const ratio = rt.spec.targets.walkDistance_m / Math.max(0.02, m.distance_m);
    const amp = +Math.min(0.55, g.hipAmplitude_rad * Math.min(1.3, Math.max(1.15, ratio))).toFixed(3);
    const freq = amp >= 0.55 && g.hipAmplitude_rad >= 0.55 ? +Math.min(2.5, g.frequency_hz * 1.2).toFixed(3) : g.frequency_hz;
    const knee = +Math.max(0.15, g.kneeAmplitude_rad * 0.85).toFixed(3);
    const stiff = +Math.min(50, g.stiffness * 1.3).toFixed(3);
    return { changes: { 'gait.hipAmplitude_rad': amp, 'gait.frequency_hz': freq, 'gait.kneeAmplitude_rad': knee, 'gait.stiffness': stiff }, rationale: `Walked ${m.distance_m} m of the ${rt.spec.targets.walkDistance_m} m target without falling. Lengthening the stride (hip amplitude ${g.hipAmplitude_rad} → ${amp} rad)${freq !== g.frequency_hz ? `, raising cadence to ${freq} Hz` : ''}, lowering step height to ${knee} rad and stiffening servos to ${stiff} N·m/rad so stance feet grip instead of sagging.` };
  }
  return null;
}

import type { Spec, VersionRecord } from '@protolab/schema';
import { searchCatalog, DEFAULT_WALKER, DEFAULT_DANCE, walkerOps, danceDrives, flattenWalkerParams, type WalkerParams } from '@protolab/parts';
import type { ToolRuntime } from './tools.ts';

/**
 * Deterministic fallback used only when no model key is configured. It knows one thing — the legged
 * walker example — and says so. Every revision is a fixed rule applied to a measured result.
 */
export async function runPlanner(rt: ToolRuntime, spec: Spec, opts: { parent: VersionRecord | null; changeRequest?: string; maxIterations: number }): Promise<void> {
  const p = (spec.task + ' ' + (opts.changeRequest ?? '')).toLowerCase();
  const legCount: 4 | 6 = /\b(six|6)[\s-]*leg|hexapod/.test(p) ? 6 : 4;
  const walkDistance = /double/.test(p) ? 0.6 : (p.match(/(\d+)\s*cm/) ? +p.match(/(\d+)\s*cm/)![1] / 100 : 0.3) * (p.match(/(\d+)\s*%/) && /further|farther|more/.test(p) ? 1 + +p.match(/(\d+)\s*%/)![1] / 100 : 1);
  const wantsDance = /dance/.test(p);
  await rt.call('write_plan', { purpose: 'Legged walking robot (deterministic planner example)', features: ['chassis', `${legCount} legs with hip and knee servos`, 'rubber feet', 'shell and eyes'], motions: ['crawl gait', ...(wantsDance ? ['in-place dance'] : [])], subassemblies: ['chassis', 'legs', 'shell'], successCriteria: [`walk ${walkDistance} m in 6 s`, 'tilt under 25°', 'servo demand within rating'], unverified: ['battery life', 'real servo backlash'], assumptions: spec.assumptions });
  let params: WalkerParams = (opts.parent?.assembly.familyConfig as unknown as WalkerParams | undefined)?.legCount ? { ...(opts.parent!.assembly.familyConfig as unknown as WalkerParams) } : { ...DEFAULT_WALKER, hipOffset_rad: 0.3, hipServoPartId: 'servo-mg996r', kneeServoPartId: 'servo-mg996r', gait: { ...DEFAULT_WALKER.gait, hipAmplitude_rad: 0.4, kneeAmplitude_rad: 0.3, swingDuty: 0.2, stiffness: 5, damping: 0.2 } };
  if (params.legCount !== legCount) params = { ...params, legCount, chassisPartId: legCount === 6 ? 'chassis-hex-200' : 'chassis-quad-160', gait: { ...params.gait, gaitType: legCount === 6 ? 'tripod' : 'crawl', swingDuty: legCount === 6 ? 0.5 : 0.22 } };
  await rt.call('search_catalog', { query: 'servo', category: 'motors' });
  const build = async (rationale: string, basedOn?: string) => {
    const { ops, drives } = walkerOps(params, rt.resolve);
    if (rt.assembly.instances.length) await rt.call('assemble', { ops: rt.assembly.instances.map((i) => ({ op: 'remove', id: i.id })), rationale: 'Clearing the previous build', based_on: basedOn });
    const r = (await rt.call('assemble', { ops, rationale, based_on: basedOn })) as { error?: string };
    if (r.error) throw new Error(r.error);
    // lift so the lowest foot touches the ground
    const foot = rt.resolve(params.footPartId)!; const lowest = Math.min(...rt.assembly.instances.filter((x) => x.partId === foot.id).map((x) => x.transform.position[1] - foot.params.radius));
    if (Math.abs(lowest) > 1e-6) await rt.call('assemble', { ops: rt.assembly.instances.map((i) => ({ op: 'move', id: i.id, translate: [0, -lowest, 0], withAttached: false })), rationale: 'Resting the feet on the ground' });
    await rt.call('set_drives', { drives });
    rt.assembly.family = 'legged_walker'; rt.assembly.familyConfig = { ...params }; rt.assembly.familyParams = flattenWalkerParams(params);
  };
  await build(`Starting from catalog defaults: ${params.chassisPartId}, ${params.hipServoPartId} servos, ${params.upperLegPartId} leg bars, ${params.gait.gaitType} gait at ${params.gait.frequency_hz} Hz.`);
  await rt.call('define_test', { test: { kind: 'walk', id: 'walk', duration_s: 6, base: 'body', minDistance_m: walkDistance, maxTilt_deg: 25, direction: 'x' } });
  for (let i = 0; i < opts.maxIterations; i++) {
    const r = (await rt.call('run_test', { test_id: 'walk' })) as { passed?: boolean; metrics?: Record<string, number>; failureReasons?: string[]; testId?: string; error?: string };
    if (r.error || r.passed) break;
    const m = r.metrics!; const g = params.gait; let rationale = ''; let next = { ...params, gait: { ...g } };
    if (m.fell) { next.gait.frequency_hz = +Math.max(0.4, g.frequency_hz * 0.8).toFixed(3); next.gait.hipAmplitude_rad = +Math.max(0.1, g.hipAmplitude_rad * 0.85).toFixed(3); next.gait.kneeAmplitude_rad = +Math.max(0.05, g.kneeAmplitude_rad * 0.7).toFixed(3); rationale = `Fell at ${m.fellAt_s} s; slowing the stride and lowering the step height.`; }
    else if (m.peakHipTorque_Nm > m.hipServoRating_Nm || m.peakKneeTorque_Nm > m.kneeServoRating_Nm) { const servos = searchCatalog('servo', { category: 'motors' }).sort((a, b) => (a.limits.maxTorque_Nm ?? 0) - (b.limits.maxTorque_Nm ?? 0)); const idx = servos.findIndex((s) => s.id === params.hipServoPartId); const pick = servos[Math.min(servos.length - 1, idx + 1)]; next.hipServoPartId = pick.id; next.kneeServoPartId = pick.id; rationale = `Servos saturated (demand ${Math.max(m.peakHipTorque_Nm, m.peakKneeTorque_Nm)} N·m vs ${m.hipServoRating_Nm} N·m rating); stepping up to ${pick.name}, the next size that does not add more mass than needed.`; }
    else if (m.maxTilt_deg > 25) { next.gait.kneeAmplitude_rad = +(g.kneeAmplitude_rad * 0.7).toFixed(3); rationale = `Tilt ${m.maxTilt_deg}° too high; lowering step height.`; }
    else { next.gait.hipAmplitude_rad = +Math.min(0.55, g.hipAmplitude_rad * 1.25).toFixed(3); rationale = `Walked ${m.distance_m} m of ${walkDistance} m; lengthening the stride.`; }
    params = next;
    await build(rationale, `${r.testId}: ${r.failureReasons?.[0] ?? 'failed'}`);
  }
  const walkPassed = rt.tests.some((t) => t.passed && t.kind === 'walk');
  if (wantsDance && walkPassed) {
    const walkOk = rt.tests.find((t) => t.passed && t.kind === 'walk')!; await rt.call('set_drives', { drives: danceDrives({ ...params, dance: DEFAULT_DANCE }), rationale: 'Switching to the dance routine: knees bob together with hip compensation, hips sway alternately.', based_on: `${walkOk.testId}: walked ${walkOk.metrics.distance_m} m, so the structure is stable enough to dance in place` });
    await rt.call('define_test', { test: { kind: 'motion', id: 'dance', duration_s: 5, measure: { base: 'body', joints: [], clearancePairs: [], noGroundContact: [] }, criteria: { maxBaseTilt_deg: 25, maxBaseDrift_m: 0.15, torqueWithinRating: true } } });
    await rt.call('run_test', { test_id: 'dance' });
  }
  const last = rt.tests[rt.tests.length - 1];
  await rt.call('finalize_design', { summary: walkPassed ? `Walker passed: ${rt.tests.find((t) => t.passed && t.kind === 'walk')!.metrics.distance_m} m in 6 s.${wantsDance ? last?.passed ? ' Dance passed.' : ' Dance did not pass.' : ''}` : 'Walker did not pass within the iteration budget.', status: walkPassed && (!wantsDance || !!last?.passed) ? 'passed' : 'failed' });
}

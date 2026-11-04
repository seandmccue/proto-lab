import { Fragment, useEffect, useRef, useState } from 'react';
import type { JobEvent, VersionMeta } from '../api.ts';
import { fmt } from '../api.ts';
import type { Spec } from '@protolab/schema';

const LABELS: Record<string, string> = { distance_m: 'Distance', speed_m_s: 'Speed', lateralDrift_m: 'Lateral drift', maxTilt_deg: 'Peak tilt', fell: 'Fell', fellAt_s: 'Fell at', minBaseHeight_m: 'Min base height', baseDisplacement_m: 'Base drift', peakHipTorque_Nm: 'Hip torque', peakKneeTorque_Nm: 'Knee torque', energyProxy_J: 'Energy proxy', landingDistance_m: 'Landing distance', maxHeight_m: 'Peak height', targetError_m: 'Target error', released: 'Released', landed: 'Landed', payloadSeparation_m: 'Payload separation', payloadDrop_m: 'Payload drop', clearanceViolation: 'Clearance hit', groundContactViolation: 'Ground contact', motorSaturation_fraction: 'Motor saturation', peakMotorEffort: 'Peak motor effort' };
const HIDE = new Set(['duration_s', 'startBodyHeight_m', 'hipServoRating_Nm', 'kneeServoRating_Nm']);
const HIGHLIGHT_LABELS: Record<string, string> = { payloadLift_m: 'Payload lift', maxInstanceTilt_deg: 'Tracked part peak tilt' };
function fmtMetric(k: string, v: number): string {
  if (k.endsWith('_m_s')) return `${v.toFixed(3)} m/s`;
  if (k.endsWith('_rad_s')) return `${v.toFixed(2)} rad/s`;
  if (k.endsWith('_m')) return fmt.m2(v); if (k.endsWith('_deg')) return fmt.deg(v); if (k.endsWith('_Nm')) return fmt.nm(v); if (k.endsWith('_s')) return `${v.toFixed(2)} s`; if (k.endsWith('_J')) return `${v.toFixed(2)} J`;
  if (k.endsWith('_rad')) return `${v.toFixed(3)} rad (${((v * 180) / Math.PI).toFixed(0)}°)`; if (k.endsWith('_fraction')) return fmt.pct(v); if (k.endsWith('_N')) return `${v.toFixed(2)} N`;
  if (k === 'fell' || k === 'released' || k === 'landed' || k.endsWith('Violation')) return v ? 'yes' : 'no'; if (k.endsWith('revolutions')) return `${v.toFixed(2)} rev`; return `${v}`;
}
export function Metrics({ metrics, kind }: { metrics: Record<string, number>; kind: string }) {
  const rows: Array<[string, string]> = [];
  const highlighted = Object.entries(HIGHLIGHT_LABELS).filter(([k]) => metrics[k] !== undefined);
  const entries = Object.entries(metrics).filter(([k]) => !HIDE.has(k) && !HIGHLIGHT_LABELS[k] && !(k === 'fellAt_s' && metrics.fell === 0));
  for (const [k, label] of highlighted) rows.push([label, fmtMetric(k, metrics[k])]);
  for (const [k, v] of entries) {
    if (k === 'peakHipTorque_Nm' && metrics.hipServoRating_Nm) { rows.push(['Hip torque', `${fmt.nm(v)} / ${fmt.nm(metrics.hipServoRating_Nm)}`]); continue; }
    if (k === 'peakKneeTorque_Nm' && metrics.kneeServoRating_Nm) { rows.push(['Knee torque', `${fmt.nm(v)} / ${fmt.nm(metrics.kneeServoRating_Nm)}`]); continue; }
    if (k.endsWith('.rating')) continue;
    if (k.includes('.')) {
      const [j, m] = k.split('.');
      if (m.startsWith('peakTorque') || m.startsWith('peakForce')) { const rating = metrics[`${j}.rating`]; const unit = m.startsWith('peakTorque') ? 'N·m' : 'N'; rows.push([`${j} ${m.startsWith('peakTorque') ? 'torque' : 'force'}`, rating ? `${v.toFixed(3)} / ${rating} ${unit}` : `${v.toFixed(3)} ${unit}`]); continue; }
      if (m.startsWith('peakRate')) { rows.push([`${j} peak rate`, `${v.toFixed(2)} ${m.endsWith('rad_s') ? 'rad/s' : 'm/s'}`]); continue; }
      if (m.startsWith('cycles')) { rows.push([`${j} cadence`, `${v.toFixed(2)} Hz`]); continue; }
      rows.push([`${j} ${m.replace(/_.*/, '')}`, fmtMetric(m, v)]); continue;
    }
    rows.push([LABELS[k] ?? k, fmtMetric(k, v)]);
  }
  void kind;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mono">
      {rows.slice(0, 14).map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className="text-ink">{v}</dd></Fragment>)}
    </dl>
  );
}

export function SpecPanel({ spec }: { spec: Spec }) {
  const p = spec.plan;
  return (
    <div className="text-xs space-y-2">
      {p ? (<>
        <div><div className="panel-title">Purpose</div><p className="text-ink">{p.purpose}</p></div>
        <div><div className="panel-title">Recognisable features</div><ul className="list-disc pl-4 text-ink">{p.features.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Required motions</div><ul className="list-disc pl-4 text-ink">{p.motions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Sub-assemblies</div><ul className="list-disc pl-4 text-ink">{p.subassemblies.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Success criteria</div><ul className="list-disc pl-4 text-ink">{p.successCriteria.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        {p.unverified.length > 0 && <div className="rounded-md border border-warn/30 bg-warn/15 p-2"><div className="panel-title text-warn">Not verified by this physics</div><ul className="list-disc pl-4 text-warn">{p.unverified.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      </>) : <p className="text-dim">The agent has not written its plan yet.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mono">
        <dt className="text-muted">Mass budget</dt><dd>{fmt.kg(spec.constraints.maxMass_kg)}</dd>
        <dt className="text-muted">Workspace</dt><dd>{spec.constraints.maxSize_m} m, ≤ {spec.constraints.maxParts} parts</dd>
        <dt className="text-muted">Ground</dt><dd>μ = {spec.environment.groundFriction}, g = {spec.environment.gravity_m_s2} m/s²</dd>
      </dl>
      <div><div className="panel-title">Assumptions</div><ul className="list-disc pl-4 text-ink">{spec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
    </div>
  );
}

export const STAGES = ['Plan', 'Parts', 'Assemble', 'Test', 'Revise', 'Done'] as const;
export function stageOf(events: JobEvent[]): number {
  let s = 0;
  const tools = events.filter((e) => e.type === 'tool').map((e) => String(e.tool));
  if (events.some((e) => e.type === 'spec' && (e.spec as { plan?: unknown })?.plan)) s = 1;
  if (tools.some((t) => t === 'search_catalog' || t === 'create_part' || t === 'design_part')) s = Math.max(s, 1);
  if (tools.some((t) => t === 'assemble')) s = Math.max(s, 2);
  const latest = [...events].reverse().find((e) => e.type === 'test' || e.type === 'test_start' || e.type === 'assembly' || e.type === 'done');
  if (latest?.type === 'test' || latest?.type === 'test_start') s = 3;
  if (latest?.type === 'assembly') s = Number(latest.iteration) > 1 ? 4 : 2;
  if (latest?.type === 'done') s = 5;
  return s;
}
export function useElapsed(events: JobEvent[], running: boolean): string {
  const [, tick] = useState(0);
  useEffect(() => { if (!running) return; const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, [running]);
  const first = events[0]?.t ? new Date(events[0].t).getTime() : null; const last = events[events.length - 1]?.t ? new Date(events[events.length - 1].t).getTime() : null;
  if (!first) return '';
  const ms = (running ? Date.now() : last ?? Date.now()) - first; const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function ActivityPanel({ events, running, versions, currentVersionId, onPickVersion, status }: { events: JobEvent[]; running: boolean; versions: VersionMeta[]; currentVersionId: string | null; onPickVersion: (id: string) => void; status?: string }) {
  const activityList = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = activityList.current;
    if (running && list) list.scrollTop = list.scrollHeight;
  }, [events.length, running]);
  const visible = events.filter((e) => e.type !== 'version' && e.type !== 'timing' && e.type !== 'test_start' && !(e.type === 'spec' && !(e.spec as { plan?: unknown } | undefined)?.plan));
  const stage = stageOf(events); const elapsed = useElapsed(events, running);
  const lastStatus = [...events].reverse().find((e) => e.type === 'status');
  const timing = [...events].reverse().find((e) => e.type === 'timing')?.timing as { firstAssemblyMs: number | null; modelMs: number } | undefined;
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="panel-title">Agent activity</span>
        {running && <span className="inline-flex items-center gap-1.5 text-xs text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />working{elapsed && <span className="mono text-dim">· {elapsed}</span>}</span>}
        {!running && elapsed && <span className="mono text-xs text-dim">{elapsed}</span>}
      </div>
      {events.length > 0 && (
        <div className="px-3 pb-2">
          <ol className="flex items-center gap-1 text-[10px]">
            {STAGES.map((name, i) => <li key={name} className={`flex items-center gap-1 ${i < stage ? 'text-pass' : i === stage && running ? 'text-accent' : 'text-dim'}`}><span className={`h-1.5 w-1.5 rounded-full ${i < stage ? 'bg-pass' : i === stage && running ? 'bg-accent animate-pulse' : 'bg-line2'}`} />{name}{i < STAGES.length - 1 && <span className="mx-0.5 h-px w-3 bg-line" />}</li>)}
          </ol>
          {running && lastStatus && <p className="mt-1 truncate text-[11px] text-muted" title={String(lastStatus.message)}>{String(lastStatus.message)}</p>}
          {timing && timing.firstAssemblyMs !== null && <p className="mt-1 text-[11px] text-muted">
            First assembly in {Math.round(timing.firstAssemblyMs / 1000)} s{!running && timing.modelMs > 0 && ` · Model calls ${Math.round(timing.modelMs / 1000)} s`}
          </p>}
        </div>
      )}
      {versions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {versions.map((v) => (
            <button key={v.id} aria-pressed={currentVersionId === v.id} onClick={() => onPickVersion(v.id)} className={`rounded-full border px-2 py-0.5 text-xs ${currentVersionId === v.id ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:border-line'}`} title={v.tests.map((t) => `${t.testId}: ${t.passed ? 'pass' : 'fail'}`).join('\n') || 'No completed simulation'}>
              v{v.iteration} <span className={!v.tests.length ? 'text-muted' : v.status === 'passed' ? 'text-pass' : 'text-fail'}>{!v.tests.length ? 'Not tested' : v.status === 'passed' ? '✓' : '✗'}</span>
            </button>
          ))}
        </div>
      )}
      <ol ref={activityList} className="min-h-0 max-h-[50dvh] flex-1 overflow-auto px-3 pb-3 text-xs space-y-1.5 lg:max-h-none">
        {visible.length === 0 && <li className="text-dim">{status === 'error' ? 'This build was interrupted; its activity log was not kept.' : 'Waiting for the agent…'}</li>}
        {visible.map((e, i) => <li key={i}><EventRow e={e} /></li>)}
      </ol>
    </div>
  );
}

function EventRow({ e }: { e: JobEvent }) {
  switch (e.type) {
    case 'status': return <div className="text-muted">{String(e.message)}</div>;
    case 'tool': {
      const ok = Boolean(e.ok);
      return <div className={`rounded-md border px-2 py-1 ${ok ? 'border-line bg-surface2' : 'border-fail/30 bg-fail/15'}`}><span className="mono font-medium text-ink">{String(e.tool)}</span> <span className="text-muted">{String(e.summary)}</span></div>;
    }
    case 'assembly': return <div className="rounded-md border border-accent/30 bg-accent/15 px-2 py-1 text-ink"><span className="font-medium">Iteration {String(e.iteration)}:</span> {String(e.rationale)}</div>;
    case 'test': {
      const passed = Boolean(e.passed);
      const reasons = (e.failureReasons as string[]) ?? [];
      return (
        <div className={`rounded-md border px-2 py-1 ${passed ? 'border-pass/30 bg-pass/15' : 'border-warn/30 bg-warn/15'}`}>
          <div className="font-medium text-ink">{String(e.testId)} — {passed ? 'passed' : 'did not pass'} <span className="text-dim font-normal">(simulator result)</span></div>
          <Metrics metrics={e.metrics as Record<string, number>} kind={String(e.kind)} />
          {reasons.length > 0 && <ul className="mt-1 list-disc pl-4 text-warn">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      );
    }
    case 'spec': {
      const plan = (e.spec as { plan?: { purpose: string; features: string[]; motions: string[]; subassemblies: string[]; unverified: string[] } }).plan!;
      return (
        <div className="rounded-md border border-accent/30 bg-accent/15 px-2 py-1.5 text-ink">
          <div className="font-medium">Engineering plan</div>
          <p className="text-ink">{plan.purpose}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <div><span className="text-muted">Features:</span> {plan.features.join(', ')}</div>
            <div><span className="text-muted">Motions:</span> {plan.motions.join(', ')}</div>
            <div className="col-span-2"><span className="text-muted">Sub-assemblies:</span> {plan.subassemblies.join(' · ')}</div>
            {plan.unverified.length > 0 && <div className="col-span-2 text-warn"><span className="text-warn">Not verifiable here:</span> {plan.unverified.join('; ')}</div>}
          </div>
        </div>
      );
    }
    case 'handoff': return <div className="rounded-md border border-accent/30 bg-accent/15 px-2 py-1 text-accent"><span className="font-medium">Model handoff:</span> {String(e.message)} <span className="text-accent">({String(e.from)} → {String(e.to)})</span></div>;
    case 'done': return <div className={`rounded-md px-2 py-1 ${e.status === 'passed' ? 'bg-pass/15 text-pass' : 'bg-warn/15 text-warn'}`}>{String(e.summary)}</div>;
    case 'error': return <div className="rounded-md bg-fail/15 px-2 py-1 text-fail">Error: {String(e.message)}</div>;
    default: return null;
  }
}

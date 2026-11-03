import { Fragment, useEffect, useRef, useState } from 'react';
import type { JobEvent, VersionMeta } from '../api.ts';
import { fmt } from '../api.ts';
import type { Spec } from '@protolab/schema';

const LABELS: Record<string, string> = { distance_m: 'Distance', speed_m_s: 'Speed', lateralDrift_m: 'Lateral drift', maxTilt_deg: 'Peak tilt', fell: 'Fell', fellAt_s: 'Fell at', minBaseHeight_m: 'Min base height', baseDisplacement_m: 'Base drift', peakHipTorque_Nm: 'Hip torque', peakKneeTorque_Nm: 'Knee torque', energyProxy_J: 'Energy proxy', landingDistance_m: 'Landing distance', maxHeight_m: 'Peak height', targetError_m: 'Target error', released: 'Released', landed: 'Landed', payloadSeparation_m: 'Payload separation', payloadDrop_m: 'Payload drop', clearanceViolation: 'Clearance hit', groundContactViolation: 'Ground contact', motorSaturation_fraction: 'Motor saturation', peakMotorEffort: 'Peak motor effort' };
const HIDE = new Set(['duration_s', 'startBodyHeight_m', 'hipServoRating_Nm', 'kneeServoRating_Nm']);
function fmtMetric(k: string, v: number): string {
  if (k.endsWith('_m')) return fmt.m2(v); if (k.endsWith('_deg')) return fmt.deg(v); if (k.endsWith('_Nm')) return fmt.nm(v); if (k.endsWith('_s')) return `${v.toFixed(2)} s`; if (k.endsWith('_J')) return `${v.toFixed(2)} J`;
  if (k.endsWith('_rad')) return `${v.toFixed(3)} rad (${((v * 180) / Math.PI).toFixed(0)}°)`; if (k.endsWith('_rad_s')) return `${v.toFixed(2)} rad/s`; if (k.endsWith('_fraction')) return fmt.pct(v); if (k.endsWith('_N')) return `${v.toFixed(2)} N`;
  if (k === 'fell' || k === 'released' || k === 'landed' || k.endsWith('Violation')) return v ? 'yes' : 'no'; if (k.endsWith('revolutions')) return `${v.toFixed(2)} rev`; return `${v}`;
}
export function Metrics({ metrics, kind }: { metrics: Record<string, number>; kind: string }) {
  const rows: Array<[string, string]> = [];
  const entries = Object.entries(metrics).filter(([k]) => !HIDE.has(k) && !(k === 'fellAt_s' && metrics.fell === 0));
  for (const [k, v] of entries) {
    if (k === 'peakHipTorque_Nm' && metrics.hipServoRating_Nm) { rows.push(['Hip torque', `${fmt.nm(v)} / ${fmt.nm(metrics.hipServoRating_Nm)}`]); continue; }
    if (k === 'peakKneeTorque_Nm' && metrics.kneeServoRating_Nm) { rows.push(['Knee torque', `${fmt.nm(v)} / ${fmt.nm(metrics.kneeServoRating_Nm)}`]); continue; }
    if (k.endsWith('.rating')) continue;
    if (k.includes('.')) { const [j, m] = k.split('.'); if (m.startsWith('peak')) { const rating = metrics[`${j}.rating`]; rows.push([`${j} ${m.startsWith('peakTorque') ? 'torque' : 'force'}`, rating ? `${v.toFixed(3)} / ${rating}` : v.toFixed(3)]); continue; } rows.push([`${j} ${m.replace(/_.*/, '')}`, fmtMetric(m, v)]); continue; }
    rows.push([LABELS[k] ?? k, fmtMetric(k, v)]);
  }
  void kind;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mono">
      {rows.slice(0, 14).map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></Fragment>)}
    </dl>
  );
}

export function SpecPanel({ spec }: { spec: Spec }) {
  const p = spec.plan;
  return (
    <div className="text-xs space-y-2">
      {p ? (<>
        <div><div className="panel-title">Purpose</div><p className="text-slate-800">{p.purpose}</p></div>
        <div><div className="panel-title">Recognisable features</div><ul className="list-disc pl-4 text-slate-700">{p.features.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Required motions</div><ul className="list-disc pl-4 text-slate-700">{p.motions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Sub-assemblies</div><ul className="list-disc pl-4 text-slate-700">{p.subassemblies.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><div className="panel-title">Success criteria</div><ul className="list-disc pl-4 text-slate-700">{p.successCriteria.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        {p.unverified.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-2"><div className="panel-title text-amber-800">Not verified by this physics</div><ul className="list-disc pl-4 text-amber-900">{p.unverified.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      </>) : <p className="text-slate-400">The agent has not written its plan yet.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mono">
        <dt className="text-slate-500">Mass budget</dt><dd>{fmt.kg(spec.constraints.maxMass_kg)}</dd>
        <dt className="text-slate-500">Workspace</dt><dd>{spec.constraints.maxSize_m} m, ≤ {spec.constraints.maxParts} parts</dd>
        <dt className="text-slate-500">Ground</dt><dd>μ = {spec.environment.groundFriction}, g = {spec.environment.gravity_m_s2} m/s²</dd>
      </dl>
      <div><div className="panel-title">Assumptions</div><ul className="list-disc pl-4 text-slate-700">{spec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
    </div>
  );
}

export default function ActivityPanel({ events, running, versions, currentVersionId, onPickVersion, status }: { events: JobEvent[]; running: boolean; versions: VersionMeta[]; currentVersionId: string | null; onPickVersion: (id: string) => void; status?: string }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { if (running) end.current?.scrollIntoView({ block: 'nearest' }); }, [events.length, running]);
  const visible = events.filter((e) => e.type !== 'version' && !(e.type === 'spec' && !(e.spec as { plan?: unknown } | undefined)?.plan));
  const stage = stageOf(events); const elapsed = useElapsed(events, running);
  const lastStatus = [...events].reverse().find((e) => e.type === 'status');
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="panel-title">Agent activity</span>
        {running && <span className="inline-flex items-center gap-1.5 text-xs text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />working{elapsed && <span className="mono text-slate-400">· {elapsed}</span>}</span>}
        {!running && elapsed && <span className="mono text-xs text-slate-400">{elapsed}</span>}
      </div>
      {events.length > 0 && (
        <div className="px-3 pb-2">
          <ol className="flex items-center gap-1 text-[10px]">
            {STAGES.map((name, i) => <li key={name} className={`flex items-center gap-1 ${i < stage ? 'text-emerald-700' : i === stage && running ? 'text-accent' : 'text-slate-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${i < stage ? 'bg-emerald-500' : i === stage && running ? 'bg-accent animate-pulse' : 'bg-slate-300'}`} />{name}{i < STAGES.length - 1 && <span className="mx-0.5 h-px w-3 bg-slate-200" />}</li>)}
          </ol>
          {running && lastStatus && <p className="mt-1 truncate text-[11px] text-slate-500" title={String(lastStatus.message)}>{String(lastStatus.message)}</p>}
        </div>
      )}
      {versions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {versions.map((v) => (
            <button key={v.id} aria-pressed={currentVersionId === v.id} onClick={() => onPickVersion(v.id)} className={`rounded-full border px-2 py-0.5 text-xs ${currentVersionId === v.id ? 'border-accent bg-accent-soft text-accent-dark' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`} title={v.tests.map((t) => `${t.testId}: ${t.passed ? 'pass' : 'fail'}`).join('\n')}>
              v{v.iteration} <span className={v.status === 'passed' ? 'text-emerald-600' : 'text-rose-500'}>{v.status === 'passed' ? '✓' : '✗'}</span>
            </button>
          ))}
        </div>
      )}
      <ol className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-xs space-y-1.5">
        {visible.length === 0 && <li className="text-slate-400">{status === 'error' ? 'This build was interrupted; its activity log was not kept.' : 'Waiting for the agent…'}</li>}
        {visible.map((e, i) => <li key={i}><EventRow e={e} /></li>)}
        <li ref={end} aria-hidden="true" />
      </ol>
    </div>
  );
}

function EventRow({ e }: { e: JobEvent }) {
  switch (e.type) {
    case 'status': return <div className="text-slate-500">{String(e.message)}</div>;
    case 'tool': {
      const ok = Boolean(e.ok);
      return <div className={`rounded-md border px-2 py-1 ${ok ? 'border-slate-200 bg-slate-50' : 'border-rose-200 bg-rose-50'}`}><span className="mono font-medium text-slate-700">{String(e.tool)}</span> <span className="text-slate-600">{String(e.summary)}</span></div>;
    }
    case 'assembly': return <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-slate-700"><span className="font-medium">Iteration {String(e.iteration)}:</span> {String(e.rationale)}</div>;
    case 'test': {
      const passed = Boolean(e.passed);
      const reasons = (e.failureReasons as string[]) ?? [];
      return (
        <div className={`rounded-md border px-2 py-1 ${passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="font-medium text-slate-800">{String(e.testId)} — {passed ? 'passed' : 'did not pass'} <span className="text-slate-400 font-normal">(simulator result)</span></div>
          <Metrics metrics={e.metrics as Record<string, number>} kind={String(e.kind)} />
          {reasons.length > 0 && <ul className="mt-1 list-disc pl-4 text-amber-800">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      );
    }
    case 'spec': {
      const plan = (e.spec as { plan?: { purpose: string; features: string[]; motions: string[]; subassemblies: string[]; unverified: string[] } }).plan!;
      return (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-slate-800">
          <div className="font-medium">Engineering plan</div>
          <p className="text-slate-700">{plan.purpose}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <div><span className="text-slate-500">Features:</span> {plan.features.join(', ')}</div>
            <div><span className="text-slate-500">Motions:</span> {plan.motions.join(', ')}</div>
            <div className="col-span-2"><span className="text-slate-500">Sub-assemblies:</span> {plan.subassemblies.join(' · ')}</div>
            {plan.unverified.length > 0 && <div className="col-span-2 text-amber-800"><span className="text-amber-700">Not verifiable here:</span> {plan.unverified.join('; ')}</div>}
          </div>
        </div>
      );
    }
    case 'handoff': return <div className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-violet-900"><span className="font-medium">Model handoff:</span> {String(e.message)} <span className="text-violet-500">({String(e.from)} → {String(e.to)})</span></div>;
    case 'done': return <div className={`rounded-md px-2 py-1 ${e.status === 'passed' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{String(e.summary)}</div>;
    case 'error': return <div className="rounded-md bg-rose-100 px-2 py-1 text-rose-900">Error: {String(e.message)}</div>;
    default: return null;
  }
}

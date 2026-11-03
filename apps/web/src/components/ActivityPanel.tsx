import { useEffect, useRef } from 'react';
import type { JobEvent, VersionMeta } from '../api.ts';
import { fmt } from '../api.ts';
import type { Spec } from '@protolab/schema';

export function Metrics({ metrics, kind }: { metrics: Record<string, number>; kind: string }) {
  const rows: Array<[string, string]> = [
    [kind === 'walk' ? 'Distance' : 'Drift', kind === 'walk' ? fmt.m2(metrics.distance_m) : fmt.m2(Math.hypot(metrics.distance_m ?? 0, metrics.lateralDrift_m ?? 0))],
    ['Peak tilt', fmt.deg(metrics.maxTilt_deg)],
    ['Fell', metrics.fell ? `yes, at ${metrics.fellAt_s} s` : 'no'],
    ['Hip torque', `${fmt.nm(metrics.peakHipTorque_Nm)} / ${fmt.nm(metrics.hipServoRating_Nm)}`],
    ['Knee torque', `${fmt.nm(metrics.peakKneeTorque_Nm)} / ${fmt.nm(metrics.kneeServoRating_Nm)}`],
    ['Energy proxy', `${metrics.energyProxy_J?.toFixed(2)} J`],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mono">
      {rows.map(([k, v]) => <><dt key={k + 'k'} className="text-slate-500">{k}</dt><dd key={k + 'v'} className="text-slate-800">{v}</dd></>)}
    </dl>
  );
}

export function SpecPanel({ spec }: { spec: Spec }) {
  return (
    <div className="text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mono">
        <dt className="text-slate-500">Family</dt><dd>legged walker, {spec.constraints.legCount} legs</dd>
        <dt className="text-slate-500">Walk target</dt><dd>{fmt.m2(spec.targets.walkDistance_m)} in {spec.targets.duration_s} s</dd>
        <dt className="text-slate-500">Max tilt</dt><dd>{fmt.deg(spec.targets.maxTilt_deg)}</dd>
        <dt className="text-slate-500">Mass budget</dt><dd>{fmt.kg(spec.constraints.maxMass_kg)}</dd>
        <dt className="text-slate-500">Ground</dt><dd>μ = {spec.environment.groundFriction}, g = {spec.environment.gravity_m_s2} m/s²</dd>
        {spec.followUps.length > 0 && <><dt className="text-slate-500">Follow-ups</dt><dd>{spec.followUps.join(', ')}</dd></>}
      </dl>
      <div className="mt-2 text-slate-500">Assumptions</div>
      <ul className="list-disc pl-4 text-slate-700">{spec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
    </div>
  );
}

export default function ActivityPanel({ events, running, versions, currentVersionId, onPickVersion }: { events: JobEvent[]; running: boolean; versions: VersionMeta[]; currentVersionId: string | null; onPickVersion: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (running) end.current?.scrollIntoView({ block: 'nearest' }); }, [events.length, running]);
  const visible = events.filter((e) => e.type !== 'spec' && e.type !== 'version');
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="panel-title">Agent activity</span>
        {running && <span className="inline-flex items-center gap-1.5 text-xs text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />working</span>}
      </div>
      {versions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {versions.map((v) => (
            <button key={v.id} onClick={() => onPickVersion(v.id)} className={`rounded-full border px-2 py-0.5 text-xs ${currentVersionId === v.id ? 'border-accent bg-accent-soft text-accent-dark' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`} title={v.tests.map((t) => `${t.testId}: ${t.passed ? 'pass' : 'fail'}`).join('\n')}>
              v{v.iteration} <span className={v.status === 'passed' ? 'text-emerald-600' : 'text-rose-500'}>{v.status === 'passed' ? '✓' : '✗'}</span>
            </button>
          ))}
        </div>
      )}
      <ol className="min-h-0 flex-1 overflow-auto px-3 pb-3 text-xs space-y-1.5">
        {visible.length === 0 && <li className="text-slate-400">Waiting for the agent…</li>}
        {visible.map((e, i) => <li key={i}><EventRow e={e} /></li>)}
        <div ref={end} />
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
    case 'done': return <div className={`rounded-md px-2 py-1 ${e.status === 'passed' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{String(e.summary)}</div>;
    case 'error': return <div className="rounded-md bg-rose-100 px-2 py-1 text-rose-900">Error: {String(e.message)}</div>;
    default: return null;
  }
}

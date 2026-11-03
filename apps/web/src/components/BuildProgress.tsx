import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGES, stageOf, useElapsed } from './ActivityPanel.tsx';
import PartsBin, { pickedParts } from './PartsBin.tsx';
import { fmt, type JobEvent, type VersionMeta } from '../api.ts';

/** Seconds since the last event, ticking: long model rounds read as "reasoning", not as a hang. */
function useSinceLast(events: JobEvent[], running: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => { if (!running) return; const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, [running]);
  const last = events[events.length - 1]?.t; if (!last) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 1000));
}

const STAGE_BLURB: Record<number, string> = {
  0: 'Reading the brief and writing an engineering plan: features, motions, sub-assemblies, success criteria.',
  1: 'Choosing parts from the library and designing anything that is missing.',
  2: 'Mounting parts at their connectors; the 3D view fills in as soon as the first batch lands.',
  3: 'Running the physics test and reading the measurements.',
  4: 'Revising from the measured result.',
  5: 'Finished.',
};

export default function BuildProgress({ events, running, jobStatus, load }: { events: JobEvent[]; running: boolean; jobStatus: string | null; load: { active: number; queued: number; maxConcurrent: number } | null }) {
  const stage = stageOf(events); const elapsed = useElapsed(events, running); const since = useSinceLast(events, running);
  const last = [...events].reverse().find((e) => e.type === 'status' || e.type === 'tool');
  const line = last ? String(last.type === 'status' ? last.message : last.summary) : 'Starting the engineering agent…';
  const parts = pickedParts(events); const tools = events.filter((e) => e.type === 'tool').length;
  const thinking = running && since >= 8;
  return (
    <div className="build-progress">
      <ol className="build-progress-stages" aria-label="Build stages">
        {STAGES.map((name, i) => <li key={name} data-state={i < stage ? 'done' : i === stage && running ? 'active' : 'todo'}><span className="build-progress-dot" />{name}</li>)}
      </ol>
      <p className="build-progress-blurb">{STAGE_BLURB[stage]}</p>
      {jobStatus === 'queued' && load && load.queued > 0 && <p className="text-sm text-slate-600">Queued behind {load.queued} other build{load.queued === 1 ? '' : 's'} ({load.active} of {load.maxConcurrent} workers busy).</p>}
      <div className="build-progress-now">
        <span className={`build-progress-spinner${thinking ? ' is-thinking' : ''}`} aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-700" title={line}>{line}</div>
          <div className="mono text-[11px] text-slate-500">{elapsed && <span>{elapsed} elapsed</span>}{tools > 0 && <span> · {tools} tool calls</span>}{parts.length > 0 && <span> · {parts.length} parts picked</span>}{thinking && <span className="text-accent"> · Muse is reasoning, {since} s on this step</span>}</div>
        </div>
      </div>
      <PartsBin events={events} />
      <p className="text-[11px] text-slate-400">Each model round takes 5–60 s; simple mechanisms finish in under a minute, legged or multi-stage ones in 2–5. <Link to="/gallery" className="text-accent hover:underline">Open a finished build in another tab →</Link></p>
    </div>
  );
}

/** The one number a test is about, for chips and toasts: distance, landing, payload drop, amplitude or tilt. */
export function keyMetric(t: { metrics: Record<string, number> } | null | undefined): string {
  if (!t) return '';
  const m = t.metrics;
  if (m.distance_m !== undefined) return fmt.m2(m.distance_m);
  if (m.landingDistance_m !== undefined) return `landed ${fmt.m2(m.landingDistance_m)}`;
  if (m.payloadDrop_m !== undefined) return `drop ${fmt.m2(m.payloadDrop_m)}`;
  const rev = Object.entries(m).find(([k]) => k.endsWith('revolutions'));
  if (rev && rev[1] >= 0.5) return `${rev[1].toFixed(1)} rev`; // a rotor's "swing" is thousands of degrees; revolutions is the number
  const amp = Object.entries(m).find(([k]) => k.endsWith('amplitude_rad'));
  if (amp && amp[1] * 180 / Math.PI <= 360) return `${((amp[1] * 180) / Math.PI).toFixed(0)}° swing`;
  if (rev) return `${rev[1].toFixed(1)} rev`;
  if (m.maxTilt_deg !== undefined) return `tilt ${fmt.deg(m.maxTilt_deg)}`;
  return '';
}

/** Compact build status over the 3D view once the first assembly is on screen: the stepper, the current line,
 *  the reasoning timer, and a short-lived toast for each test result as it lands. */
export function BuildStrip({ events, running }: { events: JobEvent[]; running: boolean }) {
  const stage = stageOf(events); const elapsed = useElapsed(events, running); const since = useSinceLast(events, running);
  const last = [...events].reverse().find((e) => e.type === 'status' || e.type === 'tool');
  const line = last ? String(last.type === 'status' ? last.message : last.summary) : '';
  const tools = events.filter((e) => e.type === 'tool').length; const parts = pickedParts(events).length;
  const thinking = running && since >= 8;
  const lastTest = [...events].reverse().find((e) => e.type === 'test');
  const flash = lastTest && Date.now() - new Date(lastTest.t).getTime() < 7000 ? (lastTest as unknown as { t: string; testId: string; passed: boolean; metrics: Record<string, number>; failureReasons: string[] }) : null;
  const flashMetric = flash ? keyMetric(flash) : '';
  if (!running) return null;
  return (
    <div className="build-strip" aria-live="polite">
      {flash && (
        <div className={`build-strip-toast ${flash.passed ? 'is-pass' : 'is-fail'}`} key={flash.t}>
          <span className="build-strip-toast-mark">{flash.passed ? '✓' : '✗'}</span>
          <span><strong>{flash.testId}</strong> {flash.passed ? 'passed' : 'did not pass'}{flashMetric && <> · {flashMetric}</>}{!flash.passed && flash.failureReasons?.[0] ? <> · {String(flash.failureReasons[0]).slice(0, 90)}</> : null}</span>
        </div>
      )}
      <div className="build-strip-panel">
        <ol className="build-progress-stages build-strip-stages" aria-label="Build stages">
          {STAGES.map((name, i) => <li key={name} data-state={i < stage ? 'done' : i === stage ? 'active' : 'todo'}><span className="build-progress-dot" />{name}</li>)}
        </ol>
        <div className="build-strip-now">
          <span className={`build-progress-spinner build-strip-spinner${thinking ? ' is-thinking' : ''}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-xs text-slate-700" title={line}>{line}</div>
            <div className="mono text-[10px] text-slate-500">{elapsed && <span>{elapsed} elapsed</span>}{tools > 0 && <span> · {tools} tool calls</span>}{parts > 0 && <span> · {parts} parts</span>}{thinking && <span className="text-accent"> · Muse is reasoning, {since} s</span>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One chip per iteration (✓/✗ and its key number) plus a pulsing chip for the one being built. Click a chip to view that version. */
export function IterationRibbon({ versions, currentId, running, events, onPick }: { versions: VersionMeta[]; currentId: string | null; running: boolean; events: JobEvent[]; onPick: (id: string) => void }) {
  if (!versions.length && !running) return null;
  const stage = stageOf(events);
  const nextLabel = stage <= 2 ? 'assembling' : stage === 3 ? 'testing' : 'revising';
  const building = running && (!versions.length || events.some((e) => e.type === 'assembly' && Number(e.iteration) > versions[versions.length - 1].iteration) || stage <= 2);
  return (
    <ol className="iteration-ribbon" aria-label="Iterations">
      {versions.map((v) => { const t = v.tests[v.tests.length - 1]; return (
        <li key={v.id}>
          <button type="button" className={`iteration-chip ${v.status === 'passed' ? 'is-pass' : 'is-fail'}`} aria-pressed={v.id === currentId} onClick={() => onPick(v.id)} title={t ? `${t.testId}: ${t.passed ? 'passed' : 'did not pass'}` : `v${v.iteration}`}>
            v{v.iteration} <span className="iteration-chip-mark">{v.status === 'passed' ? '✓' : '✗'}</span>{t && keyMetric(t) && <span className="iteration-chip-metric">{keyMetric(t)}</span>}
          </button>
        </li>); })}
      {building && <li><span className="iteration-chip is-building"><span className="build-progress-dot" />v{(versions[versions.length - 1]?.iteration ?? 0) + 1} · {nextLabel}</span></li>}
    </ol>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { Spec, TestSpec, VersionRecord } from '@protolab/schema';
import { STAGES, stageOf, useElapsed } from './ActivityPanel.tsx';
import PartsBin, { pickedParts } from './PartsBin.tsx';
import { fmt, type JobEvent, type TestSummary, type VersionMeta } from '../api.ts';

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

export default function BuildProgress({ events, running, jobStatus, load, brief }: { brief?: string; events: JobEvent[]; running: boolean; jobStatus: string | null; load: { active: number; queued: number; maxConcurrent: number } | null }) {
  const stage = stageOf(events); const elapsed = useElapsed(events, running); const since = useSinceLast(events, running);
  const last = [...events].reverse().find((e) => e.type === 'status' || e.type === 'tool');
  const line = last ? String(last.type === 'status' ? last.message : last.summary) : 'Starting the engineering agent…';
  const parts = useMemo(() => pickedParts(events), [events]);
  const plan = [...events].reverse().find((e) => e.type === 'spec' && (e.spec as Spec | undefined)?.plan)?.spec as Spec | undefined;
  const thinking = running && since >= 8;
  return (
    <div className="build-progress">
      <ol className="build-progress-stages" aria-label="Build stages">
        {STAGES.map((name, i) => <li key={name} data-state={i < stage ? 'done' : i === stage && running ? 'active' : 'todo'}><span className="build-progress-dot" />{name}</li>)}
      </ol>
      <PartsBin parts={parts} plan={plan?.plan} brief={brief} />
      <div className="build-progress-now">
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-700" title={line}>{line}</div>
          <div className="mono text-[11px] text-slate-500">{elapsed ? `${elapsed} elapsed · ` : ''}{jobStatus === 'queued' && load && load.queued > 0 ? `Queued · ${load.active} of ${load.maxConcurrent} workers busy` : thinking ? `Muse is reasoning · ${since} s on this step` : STAGE_BLURB[stage]}</div>
        </div>
      </div>
    </div>
  );
}

/** The one number a test is about, for chips and toasts: distance, landing, payload drop, amplitude or tilt. */
export function keyMetric(t: { metrics: Record<string, number> } | null | undefined): string {
  if (!t) return '';
  const m = t.metrics;
  if (m.distance_m !== undefined) return fmt.m2(m.distance_m);
  if (m.landingDistance_m !== undefined) return `landed ${fmt.m2(m.landingDistance_m)}`;
  if (m.payloadLift_m !== undefined) return `${fmt.cm(m.payloadLift_m)} lift`;
  if (m.maxInstanceTilt_deg !== undefined) return `${fmt.deg(m.maxInstanceTilt_deg)} peak part tilt`;
  if (m.payloadDrop_m !== undefined) return `drop ${fmt.m2(m.payloadDrop_m)}`;
  const rev = Object.entries(m).find(([k]) => k.endsWith('revolutions'));
  if (rev && rev[1] >= 0.5) return `${rev[1].toFixed(1)} rev`; // a rotor's "swing" is thousands of degrees; revolutions is the number
  const amp = Object.entries(m).find(([k]) => k.endsWith('amplitude_rad'));
  if (amp && amp[1] * 180 / Math.PI <= 360) return `${((amp[1] * 180) / Math.PI).toFixed(0)}° swing`;
  if (rev) return `${rev[1].toFixed(1)} rev`;
  if (m.maxTilt_deg !== undefined) return `tilt ${fmt.deg(m.maxTilt_deg)}`;
  return '';
}

function latestPhysicsEvent(events: JobEvent[]) {
  return [...events].reverse().find((event) =>
    ['test_start', 'test', 'assembly', 'done', 'error'].includes(event.type) ||
    (event.type === 'tool' && event.tool === 'run_test' && event.ok === false));
}

export function recordedTestSpec(testId: string, versions: (VersionRecord | null)[]): TestSpec | undefined {
  const id = testId.replace(/#\d+$/, '');
  for (const version of versions) {
    const entry = version?.toolLog.slice().reverse().find((log) =>
      log.ok && log.tool === 'define_test' && (log.args as { test?: TestSpec } | null)?.test?.id === id);
    if (entry) return (entry.args as { test: TestSpec }).test;
  }
}

function testEvidence(metrics: TestSummary['metrics'], definition?: TestSpec) {
  const items: { label: string; value: string; target?: string }[] = [];
  const distance = (v: number) => fmt.cm(v);
  const angle = (v: number) => fmt.deg(v);
  const revolutions = (v: number) => `${v.toFixed(2)} rev`;
  const add = (label: string, value: number | undefined, format: (v: number) => string, limit?: number, atLeast = false) => {
    if (value === undefined) return;
    items.push({ label, value: format(value), target: limit === undefined ? undefined : `${atLeast ? 'Minimum' : 'Maximum'} ${format(limit)}` });
  };
  const motion = definition?.kind === 'motion' ? definition.criteria : undefined;
  const walk = definition?.kind === 'walk' ? definition : undefined;
  add('Distance travelled', walk && !walk.signed && metrics.distance_m !== undefined ? Math.abs(metrics.distance_m) : metrics.distance_m, distance, walk?.minDistance_m, true);
  add('Peak tilt', metrics.distance_m !== undefined ? metrics.maxTilt_deg : undefined, angle, walk?.maxTilt_deg);
  add('Payload lift', metrics.payloadLift_m, distance, motion?.minPayloadLift_m, true);
  add('Furthest from holder', metrics.payloadSeparation_m, distance, motion?.maxPayloadSeparation_m ?? (definition?.kind === 'grip' ? definition.maxSeparation_m : undefined));
  add('Return error', metrics.payloadReturnError_m, (v) => `${(v * 1000).toFixed(1)} mm`, motion?.maxPayloadReturnError_m);
  add('Landing distance', metrics.landingDistance_m, distance);
  add('Peak tracked-part tilt', metrics.maxInstanceTilt_deg, angle, motion?.maxInstanceTilt_deg);
  const rotation = Object.entries(metrics).find(([name, value]) => name.endsWith('.revolutions') && value >= .5);
  const swing = Object.entries(metrics).find(([name]) => name.endsWith('.amplitude_rad'));
  if (rotation) add('Rotation', rotation[1], revolutions, motion?.minRevolutions, true);
  else if (swing && items.length === 0) add('Joint swing', swing[1], (v) => angle(v * 180 / Math.PI), motion?.minJointAmplitude_rad, true);
  if (definition?.kind === 'motion' && definition.measure?.clearancePairs?.length && metrics.clearanceViolation === 0) {
    items.push({ label: 'Checked parts', value: 'No contact detected' });
  }
  return items.slice(0, 4);
}

export function SimulationStatus({ events, running, replay }: {
  events: JobEvent[];
  running: boolean;
  replay: { iteration: number; test: TestSummary; playing: boolean; definition?: TestSpec; adjustment?: string } | null;
}) {
  const event = running ? latestPhysicsEvent(events) : undefined;
  const live = event?.type === 'test_start';
  const result = event?.type === 'test' ? event : undefined;
  const assembly = event?.type === 'assembly';
  const iteration = live || result || assembly ? Number(event?.iteration) : replay?.iteration;
  if (!iteration || (!live && !result && !assembly && !replay)) return null;

  const metrics = result ? result.metrics as TestSummary['metrics'] | undefined : replay?.test.metrics;
  const passed = result ? result.passed === true : replay?.test.passed;
  const metric = !live && !assembly && metrics ? keyMetric({ metrics }) : '';
  const previous = live || assembly ? [...events].reverse().find((item) => item.type === 'test') : undefined;
  const recorded = result ?? previous;
  const matchesReplay = !recorded || (Number(recorded.iteration) === replay?.iteration && recorded.testId === replay.test.testId);
  const reasons = recorded ? (Array.isArray(recorded.failureReasons) ? recorded.failureReasons.map(String) : []) : replay?.test.failureReasons ?? [];
  const evidenceMetrics = recorded ? recorded.metrics as TestSummary['metrics'] | undefined : metrics;
  const evidence = evidenceMetrics ? testEvidence(evidenceMetrics, matchesReplay ? replay?.definition : undefined) : [];
  const evidencePassed = recorded ? recorded.passed === true : passed;
  const adjustment = matchesReplay ? replay?.adjustment : undefined;
  const mode = live ? 'live' : assembly ? 'assembly' : passed ? 'pass' : 'fail';
  const title = live ? 'Simulation running'
    : result ? passed ? 'Simulation passed' : 'Simulation failed'
    : assembly ? 'Preparing simulation'
    : replay?.playing ? 'Simulation replay playing' : 'Simulation replay paused';
  const detail = live ? String(event?.testId ?? '')
    : assembly ? 'Muse is assembling or revising the mechanism.'
    : [result ? 'Test complete' : passed ? 'Saved test passed' : 'Saved test failed', metric].filter(Boolean).join(' · ');

  return (
    <div role="status">
      <div className="simulation-status" data-mode={mode}>
        <span className="simulation-status-version">v{iteration}</span>
        <div className="simulation-status-copy">
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        {live && <span className="simulation-status-signal" aria-hidden="true" />}
      </div>
      {(previous || (!live && !assembly)) && (
        <div className="simulation-evidence" data-outcome={evidencePassed ? 'pass' : 'fail'}>
          {previous && <span className="workbench-label">Previous result · v{Number(previous.iteration)}</span>}
          <h3>{evidencePassed ? 'What the test verified' : 'Why this test failed'}</h3>
          {evidencePassed && evidence.length === 0 && <p>The simulation met its recorded criteria.</p>}
          {!evidencePassed && (reasons.length ? <ul>{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p>The saved test did not meet its criteria.</p>)}
          {evidence.length > 0 && <dl>{evidence.map((item) => (
            <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd>{item.target && <dd className="simulation-evidence-target">{item.target}</dd>}</div>
          ))}</dl>}
          {adjustment && <p><strong>Muse’s recorded change</strong> {adjustment}</p>}
        </div>
      )}
    </div>
  );
}

/** Build activity and elapsed time below the assembly. */
export function BuildStrip({ events, running }: { events: JobEvent[]; running: boolean }) {
  const stage = stageOf(events); const elapsed = useElapsed(events, running); const since = useSinceLast(events, running);
  const last = [...events].reverse().find((e) => e.type === 'status' || e.type === 'tool');
  const line = last ? String(last.type === 'status' ? last.message : last.summary) : '';
  const tools = events.filter((e) => e.type === 'tool').length; const parts = pickedParts(events).length;
  const thinking = running && since >= 8;
  if (!running) return null;
  return (
    <div className="build-strip">
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

/** Saved version history. Click a version to load its recorded simulation. */
export function IterationRibbon({ versions, currentId, onPick }: { versions: VersionMeta[]; currentId: string | null; onPick: (id: string) => void }) {
  if (!versions.length) return null;
  return (
    <ol className="iteration-ribbon" aria-label="Saved versions">
      <li className="iteration-ribbon-label">Versions</li>
      {versions.map((v) => { const t = v.tests[v.tests.length - 1]; return (
        <li key={v.id}>
          <button type="button" className={`iteration-chip ${v.status === 'passed' ? 'is-pass' : 'is-fail'}`} aria-pressed={v.id === currentId} onClick={() => onPick(v.id)} title={t ? `${t.testId}: ${t.passed ? 'passed' : 'did not pass'}` : `v${v.iteration}`}>
            v{v.iteration} <span className="iteration-chip-mark">{v.status === 'passed' ? 'Passed' : 'Failed'}</span>{t && keyMetric(t) && <span className="iteration-chip-metric">{keyMetric(t)}</span>}
          </button>
        </li>); })}
    </ol>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { tiltDeg } from '@protolab/parts';
import type { Assembly, TestResult, TestSpec, VersionRecord } from '@protolab/schema';
import { api, fmt, type JobEvent } from '../api.ts';
import { keyMetric, recordedTestSpec } from './BuildProgress.tsx';
import type { DiagnosticTone } from './diagnosticColors.ts';
import { recordedPenPath } from './replayEvidence.ts';
import Viewer, { replayBounds } from './Viewer.tsx';

type Replay = { inventionId: string; versionId: string; testId: string; label: string };
type Tilt = { highlights: ReadonlyMap<string, DiagnosticTone>; tilt: number; limit: number; feet: number };

const millimetres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatTravel = (metres: number) => `${millimetres.format(metres * 1000)} mm`;

function travelComparison(
  before: TestResult,
  after: TestResult,
  versions: [VersionRecord, VersionRecord],
  definitions: [TestSpec | undefined, TestSpec | undefined],
) {
  const tests = [before, after] as const;
  const minima = definitions.map((definition) => new Map(
    definition?.kind === 'motion'
      ? definition.measure.linearTravel?.map(({ instance, axis, minTravel_m }) => [`${instance}.travel_${axis}_m`, minTravel_m])
      : undefined,
  ));
  const keys = new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)]);
  return [...keys].flatMap((key) => {
    const match = /^(.+)\.travel_([xyz])_m$/.exec(key);
    if (!match) return [];
    const [, instance, axis] = match;
    const part = versions[1].assembly.instances.find(({ id }) => id === instance)
      ?? versions[0].assembly.instances.find(({ id }) => id === instance);
    const name = part?.label || instance.replace(/[_-]+/g, ' ');
    return [{
      key,
      label: `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${axis.toUpperCase()} axis`,
      readings: tests.map((test, index) => ({ value: test.metrics[key], minimum: minima[index].get(key) })),
    }];
  });
}

interface Props {
  before: Replay;
  after: Replay;
  reducedMotion: boolean;
  events: JobEvent[];
  baselineDefinition?: TestSpec;
  findTilt: (assembly: Assembly, test: TestResult, definition: TestSpec | undefined, time: number) => Tilt | null;
  revisionChanges: (before: Assembly, after: Assembly) => { changed: Set<string>; drives: Set<string> };
}

export default function ReplayComparison({ before, after, reducedMotion, baselineDefinition, findTilt, revisionChanges, events }: Props) {
  const [versions, setVersions] = useState<[VersionRecord, VersionRecord] | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const { inventionId: beforeInvention, versionId: beforeId } = before;
  const { inventionId: afterInvention, versionId: afterId } = after;
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.version(beforeInvention, beforeId), api.version(afterInvention, afterId)])
      .then(([a, b]) => { if (!cancelled) setVersions([a.version, b.version]); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [beforeInvention, beforeId, afterInvention, afterId]);

  const beforeTest = versions?.[0].tests.find((test) => test.testId === before.testId);
  const afterTest = versions?.[1].tests.find((test) => test.testId === after.testId);
  const cameraBounds = useMemo(() => versions && replayBounds(versions[0].assembly, beforeTest)
    .union(replayBounds(versions[1].assembly, afterTest)), [versions, beforeTest, afterTest]);
  const duration = Math.min(beforeTest?.trace.frames.at(-1)?.t ?? 0, afterTest?.trace.frames.at(-1)?.t ?? 0);
  useEffect(() => {
    if (!playing || !duration) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (now - last >= 30) {
        const elapsed = (now - last) * speed / 1000;
        last = now;
        setTime((current) => (current + elapsed) % duration);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing, speed]);

  const changes = useMemo(() => {
    const highlights = new Map<string, DiagnosticTone>();
    if (versions) {
      const { changed, drives } = revisionChanges(versions[0].assembly, versions[1].assembly);
      for (const id of [...changed, ...drives]) highlights.set(id, 'change');
    }
    return highlights;
  }, [versions, revisionChanges]);
  const definition = recordedTestSpec(before.testId, [versions?.[0] ?? null]) ?? baselineDefinition;
  const travel = useMemo(() => {
    if (!versions || !beforeTest || !afterTest) return [];
    const afterDefinition = recordedTestSpec(after.testId, [versions[1]]);
    return travelComparison(beforeTest, afterTest, versions, [definition, afterDefinition]);
  }, [versions, beforeTest, afterTest, after.testId, definition]);
  const peakTime = useMemo(() => {
    if (!beforeTest || beforeTest.passed || definition?.kind !== 'walk') return null;
    let peakTilt = definition.maxTilt_deg;
    let peak = null;
    for (const frame of beforeTest.trace.frames) {
      if (frame.t > duration) break;
      const pose = frame.bodies[definition.base];
      const tilt = pose ? tiltDeg(pose.rotation) : 0;
      if (tilt > peakTilt) { peakTilt = tilt; peak = frame.t; }
    }
    return peak;
  }, [beforeTest, definition, duration]);

  if (error || (versions && !duration)) return <p className="workbench-comparison-message" role="status">Both recorded traces are needed for side-by-side replay.</p>;
  if (!versions || !beforeTest || !afterTest) return <p className="workbench-comparison-message" role="status">Loading both recorded simulations…</p>;

  const tilt = findTilt(versions[0].assembly, beforeTest, definition, time);
  const adjustment = versions[1].decisions.slice().reverse().find((decision) => decision.source === 'model' && (decision.previousTestId || decision.basedOn));
  const panes = [
    { replay: before, version: versions[0], test: beforeTest, highlights: tilt?.highlights },
    { replay: after, version: versions[1], test: afterTest, highlights: changes },
  ];

  return <section className="workbench-comparison" aria-label="Side-by-side simulation comparison">
    <div className="workbench-toolbar workbench-comparison-controls">
      <div className="workbench-control-group" role="group" aria-label="Synchronized replay controls">
        <button className="btn-secondary" type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <button className="btn-ghost" type="button" onClick={() => setTime(0)}>Reset</button>
        {peakTime !== null && <button className="btn-ghost" type="button" onClick={() => { setPlaying(false); setTime(peakTime); }}>Jump to peak tilt</button>}
        <input type="range" min={0} max={duration} step={0.01} value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} className="workbench-timeline" aria-label="Scrub both simulations" />
        <span className="mono whitespace-nowrap text-xs text-slate-600">{time.toFixed(2)} / {duration.toFixed(1)} s</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Playback speed"><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
      </div>
      <span className="workbench-view-hint">Same clock · Same camera</span>
    </div>
    <div className="workbench-comparison-panes">
      {panes.map(({ replay, version, test, highlights }, index) => <article key={replay.versionId} className="workbench-comparison-pane" aria-label={`${replay.label}, version ${version.iteration}`}>
        <header><strong>{replay.label} · v{version.iteration}</strong><span className={`workbench-badge ${test.passed ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>{test.passed ? 'Passed' : 'Failed'}</span></header>
        <p className="workbench-comparison-metric">{test.metrics.distance_m !== undefined ? `${fmt.cm(test.metrics.distance_m)} travelled` : keyMetric(test)}{test.metrics.maxTilt_deg !== undefined && ` · ${fmt.deg(test.metrics.maxTilt_deg)} peak tilt`}</p>
        <div className="workbench-comparison-canvas">
          <Viewer assembly={version.assembly} test={test} playing={false} playbackTime={time} cameraBounds={cameraBounds ?? undefined} explode={0} blueprint={false} follow={false} selectedId={null} diagnosticHighlights={highlights} pathInstanceId={recordedPenPath(version.assembly, test)} />
        </div>
        <div className={`workbench-comparison-note${index === 0 ? ' is-failure' : ''}`}>
          {index === 0 ? <><strong>{tilt ? 'Tilt limit exceeded' : test.passed ? 'Recorded result' : 'Why this failed'}</strong><span>{tilt ? `${fmt.deg(tilt.tilt)} · ${fmt.deg(tilt.limit)} limit${tilt.feet ? ' · Lean-side legs highlighted' : ''}` : test.failureReasons.join(' · ') || 'No failure recorded.'}</span></> : <><strong>{changes.size ? adjustment ? 'Changed by Muse' : 'Revised parts' : 'Recorded result'}</strong><span>{adjustment?.summary || (changes.size ? `${changes.size} changed parts highlighted` : 'This replay has no recorded part changes.')}</span></>}
        </div>
      </article>)}
    </div>
    <ModelHandoff events={events} versions={versions} before={beforeTest} after={afterTest} />
    {travel.length > 0 && (
      <div className="border-t border-slate-200 bg-white px-3 pb-3">
        <table className="w-full table-fixed text-left text-xs">
          <caption className="py-2 text-left text-sm font-semibold">Recorded linear travel</caption>
          <thead className="border-b border-slate-200">
            <tr>
              <th scope="col" className="w-2/5 pb-2 pr-2">Part and axis</th>
              <th scope="col" className="pb-2 pr-2">{before.label} · v{versions[0].iteration}</th>
              <th scope="col" className="pb-2">{after.label} · v{versions[1].iteration}</th>
            </tr>
          </thead>
          <tbody>
            {travel.map(({ key, label, readings }) => (
              <tr key={key} className="border-b border-slate-100">
                <th scope="row" className="break-words py-2 pr-2 font-medium">{label}</th>
                {readings.map(({ value, minimum }, index) => (
                  <td key={panes[index].replay.versionId} className="py-2 pr-2 align-top">
                    {value === undefined ? 'Unmeasured' : <strong>{formatTravel(value)}</strong>}
                    {minimum !== undefined && <span className="block text-slate-600">Minimum {formatTravel(minimum)}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>;
}

const museLabels: Record<string, string> = {
  'muse-spark-1.3': 'Muse Spark 1.3',
  'muse-wonder-1.0': 'Muse Wonder 1.0',
};

function ModelHandoff({ events, versions, before, after }: {
  events: JobEvent[];
  versions: [VersionRecord, VersionRecord];
  before: TestResult;
  after: TestResult;
}) {
  if (before.passed || !after.passed) return null;
  const [from, to] = versions;
  const savedAfter = events.findIndex((event) => event.type === 'version' && event.versionId === to.id);
  const savedBefore = events.findIndex((event) => event.type === 'version' && event.versionId === from.id);
  if (savedBefore < 0 || savedAfter <= savedBefore) return null;
  const revision = events.slice(savedBefore + 1, savedAfter);
  const handoff = revision.findIndex((event) => event.type === 'handoff'
    && event.from === from.modelId && event.to === to.modelId);
  if (handoff < 0) return null;
  const actions = revision.slice(handoff + 1);
  const passingTest = actions.findIndex((event) => event.type === 'test' && event.testId === after.testId
    && event.iteration === to.iteration && event.passed === true);
  if (passingTest < 0) return null;
  const build = actions.slice(0, passingTest);
  if (build.some((event) => event.type === 'handoff')) return null;
  const tools = [...new Set(build.flatMap((event) => event.type === 'tool' && event.ok === true
    && typeof event.tool === 'string' ? [event.tool] : []))];
  if (!tools.length) return null;
  return (
    <div className="workbench-handoff" aria-label="Recorded model handoff">
      <span className="workbench-label">Recorded build log</span>
      <p><strong>{museLabels[from.modelId] ?? from.modelId}</strong> handed off after v{from.iteration} failed. <strong>{museLabels[to.modelId] ?? to.modelId}</strong> revised the design and passed v{to.iteration}.</p>
      <ul aria-label="Successful tool calls before the passing test">
        {tools.map((tool) => <li key={tool}><code>{tool}</code></li>)}
      </ul>
    </div>
  );
}

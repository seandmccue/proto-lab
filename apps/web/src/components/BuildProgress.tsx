import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGES, stageOf, useElapsed } from './ActivityPanel.tsx';
import PartsBin, { pickedParts } from './PartsBin.tsx';
import type { JobEvent } from '../api.ts';

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
      <p className="text-[11px] text-slate-400">Each model round takes 5–60 s; simple mechanisms finish in about a minute, legged or multi-stage ones in 3–10. <Link to="/gallery" className="text-accent hover:underline">Open a finished build in another tab →</Link></p>
    </div>
  );
}

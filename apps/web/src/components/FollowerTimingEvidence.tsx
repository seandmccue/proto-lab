import { useMemo } from 'react';
import type { TestResult, TestSpec, Trace } from '@protolab/schema';
import { measureFollowerTiming } from '@protolab/simulator/follower-timing';
import { fmt } from '../api.ts';

const savedSemaphore = {
  shaft: 'cam_spin',
  followers: ['amber_flag', 'teal_flag'] as [string, string],
  axis: 'y' as const,
  minLowDwell_s: 1,
  minPhaseGap_deg: 165,
};

function recordedSemaphoreTiming(test: TestResult) {
  const turns = measureFollowerTiming(test.trace, savedSemaphore);
  if (turns.length === 0) return null;
  return {
    count: turns.length,
    dwell: [
      Math.min(...turns.map(({ flags }) => flags[0].lowDwell_s)),
      Math.min(...turns.map(({ flags }) => flags[1].lowDwell_s)),
    ],
    phase: Math.min(...turns.map(({ phaseGap_deg }) => phaseGap_deg)),
  };
}

function followerName(id: string) {
  const name = id.replace(/[_-]+/g, ' ');
  return name[0].toUpperCase() + name.slice(1);
}

type FollowerTracks = { followers: [string, string]; axis: 'x' | 'y' | 'z' };

function tracePaths(trace: Trace, { followers, axis }: FollowerTracks) {
  const { frames } = trace;
  const first = frames[0]?.t;
  const last = frames.at(-1)?.t;
  if (first === undefined || last === undefined || last <= first) return null;

  const coordinate = { x: 0, y: 1, z: 2 }[axis];
  const positions = followers.map((id) => frames.map(({ bodies }) => bodies[id]?.position[coordinate]));
  if (positions.some((series) => series.some((value) => !Number.isFinite(value)))) return null;

  const lows = positions.map((series) => Math.min(...series));
  const peakMm = Math.max(...positions.map((series, index) => (Math.max(...series) - lows[index]) * 1000));
  const scaleMm = Math.max(5, 5 * Math.ceil(peakMm / 5));
  const lines = positions.map((series, index) => series.map((position, sample) => {
    const x = (frames[sample].t - first) / (last - first) * 1000;
    const y = 100 - ((position - lows[index]) * 1000 / scaleMm) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' '));

  return { first, last, scaleMm, lines };
}

function FollowerTrace({ trace, followers, axis, time }: FollowerTracks & { trace: Trace; time: number }) {
  const chart = useMemo(() => tracePaths(trace, { followers, axis }), [trace, followers, axis]);
  if (!chart) return null;
  const { first, last, scaleMm, lines } = chart;
  const cursor = Math.max(0, Math.min(1000, (time - first) / (last - first) * 1000));

  return (
    <figure className="workbench-follower-chart">
      <figcaption>Recorded displacement from each follower’s lowest position</figcaption>
      <div className="workbench-follower-legend">
        {followers.map((id, index) => <span key={id} data-line={index}>{followerName(id)}</span>)}
      </div>
      <div className="workbench-follower-plot">
        <div className="workbench-follower-axis" aria-hidden="true"><span>{scaleMm} mm</span><span>0 mm</span></div>
        <div>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`Recorded displacement over time for ${followers.map(followerName).join(' and ')}. The marker follows the replay.`}>
            {[0, 50, 100].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="workbench-follower-gridline" />)}
            {lines.map((line, index) => <polyline key={followers[index]} points={line} data-line={index} />)}
            <line x1={cursor} x2={cursor} y1="0" y2="100" className="workbench-follower-cursor" />
          </svg>
          <div className="workbench-follower-time" aria-hidden="true"><span>{first.toFixed(1)} s</span><span>{last.toFixed(1)} s</span></div>
        </div>
      </div>
    </figure>
  );
}

export default function FollowerTimingEvidence({ test, definition, isSemaphore, time }: {
  test: TestResult;
  definition?: TestSpec;
  isSemaphore: boolean;
  time: number;
}) {
  const timing = definition?.kind === 'motion' ? definition.measure.followerTiming : undefined;
  const archived = useMemo(() => isSemaphore && !timing ? recordedSemaphoreTiming(test) : null, [isSemaphore, test, timing]);
  const target = timing ?? (isSemaphore ? savedSemaphore : null);
  const evidence = timing ? {
    count: test.metrics.followerCycles,
    dwell: timing.followers.map((id) => test.metrics[`${id}.lowDwell_s`]),
    phase: test.metrics.followerPhaseGap_deg,
  } : archived;
  if (!evidence || !target || !Number.isFinite(evidence.count)) return null;

  const { count, dwell, phase } = evidence;

  return (
    <section className="workbench-follower-evidence" aria-labelledby="follower-timing-heading">
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id="follower-timing-heading">{isSemaphore ? 'Measured flag timing' : 'Measured follower timing'}</h3>
        <p>
          {count ? `Lowest readings across ${count} full ${count === 1 ? 'turn' : 'turns'} after startup.` : 'No full turns measured after startup.'}
          {timing && ` Goal ≥ ${timing.minCycles} full ${timing.minCycles === 1 ? 'turn' : 'turns'}.`}
        </p>
        {!!count && <dl>
          {target.followers.map((id, index) => {
            const stroke = test.metrics[`${id}.cycleStroke_m`];
            return <div key={id}>
              <dt>{followerName(id)}{!timing && ' held low'}</dt>
              <dd>{Number.isFinite(dwell[index]) ? `${dwell[index].toFixed(2)} s${timing ? ' low' : ''}` : 'Unmeasured'} <small>≥ {target.minLowDwell_s} s goal</small></dd>
              {timing && <dd><small>Stroke {Number.isFinite(stroke) ? `${(stroke * 1000).toFixed(1)} mm` : 'unmeasured'} · ≥ {(timing.minStroke_m * 1000).toLocaleString()} mm goal</small></dd>}
            </div>;
          })}
          <div>
            <dt>Shaft angle between peaks</dt>
            <dd>{Number.isFinite(phase) ? fmt.deg(phase) : 'Unmeasured'} <small>≥ {target.minPhaseGap_deg}° goal</small></dd>
          </div>
        </dl>}
      </div>
      <FollowerTrace trace={test.trace} followers={target.followers} axis={target.axis} time={time} />
    </section>
  );
}

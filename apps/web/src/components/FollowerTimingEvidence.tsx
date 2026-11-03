import { useMemo } from 'react';
import type { TestResult, TestSpec } from '@protolab/schema';
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

export default function FollowerTimingEvidence({ test, definition, isSemaphore }: {
  test: TestResult;
  definition?: TestSpec;
  isSemaphore: boolean;
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
      <div>
        <h3 className="workbench-label" id="follower-timing-heading">{isSemaphore ? 'Measured flag timing' : 'Measured follower timing'}</h3>
        <p>
          {count ? `Lowest readings across ${count} full ${count === 1 ? 'turn' : 'turns'} after startup.` : 'No full turns measured after startup.'}
          {timing && ` Goal ≥ ${timing.minCycles} full ${timing.minCycles === 1 ? 'turn' : 'turns'}.`}
        </p>
      </div>
      {!!count && <dl>
        {target.followers.map((id, index) => {
          const name = id.replace(/[_-]+/g, ' ');
          const stroke = test.metrics[`${id}.cycleStroke_m`];
          return <div key={id}>
            <dt>{name[0].toUpperCase() + name.slice(1)}{!timing && ' held low'}</dt>
            <dd>{Number.isFinite(dwell[index]) ? `${dwell[index].toFixed(2)} s${timing ? ' low' : ''}` : 'Unmeasured'} <small>≥ {target.minLowDwell_s} s goal</small></dd>
            {timing && <dd><small>Stroke {Number.isFinite(stroke) ? `${(stroke * 1000).toFixed(1)} mm` : 'unmeasured'} · ≥ {(timing.minStroke_m * 1000).toLocaleString()} mm goal</small></dd>}
          </div>;
        })}
        <div>
          <dt>Shaft angle between peaks</dt>
          <dd>{Number.isFinite(phase) ? fmt.deg(phase) : 'Unmeasured'} <small>≥ {target.minPhaseGap_deg}° goal</small></dd>
        </div>
      </dl>}
    </section>
  );
}

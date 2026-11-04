import { useId, useMemo } from 'react';
import type { TestResult, TestSpec } from '@protolab/schema';
import { measureIndexedMotion } from '@protolab/simulator/indexed-motion';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

export default function IndexedMotionEvidence({ test, definition, time, iteration }: {
  test: TestResult;
  definition?: TestSpec;
  time: number;
  iteration?: number;
}) {
  const headingId = useId();
  const goal = definition?.kind === 'motion' ? definition.measure.indexedMotion : undefined;
  const measured = useMemo(() => {
    const result = goal && measureIndexedMotion(test.trace, goal);
    if (!result) return null;
    return {
      result,
      times: result.series.map(({ t }) => t),
      tracks: [
        { id: 'input', label: 'Input progress', values: result.series.map(({ input_deg }) => input_deg) },
        { id: 'output', label: 'Output angle', values: result.series.map(({ output_deg }) => output_deg) },
      ],
    };
  }, [goal, test.trace]);
  if (!goal || !measured) return null;

  const { result, times, tracks } = measured;
  const passed = result.consecutiveSteps >= goal.minSteps;
  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>Recorded indexing{iteration !== undefined && ` · v${iteration}`}</h3>
        <p>A flat output line shows the wheel holding its position while the input continues turning.</p>
        <dl>
          <div><dt>Consecutive steps with dwell</dt><dd>{result.consecutiveSteps}</dd><dd><small>Minimum {goal.minSteps}</small></dd></div>
          <div><dt>Target step size</dt><dd>{goal.step_deg}° ± {goal.stepTolerance_deg}°</dd></div>
          <div><dt>Required hold</dt><dd>≥ {goal.minDwell_s} s</dd><dd><small>≤ {goal.maxDwellDrift_deg}° drift</small></dd></div>
        </dl>
        <span className={`workbench-badge mt-2 inline-flex ${passed ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>
          Indexing goal {passed ? 'met' : 'missed'}
        </span>
      </div>
      <RecordedSeriesChart times={times} tracks={tracks} time={time} unit="°" signed={tracks[1].values.some((value) => value < 0)}
        title="Input progress and output angle" description="Input progress and output angle from the saved simulation" />
    </section>
  );
}

import { useId, useMemo } from 'react';
import type { TestResult, TestSpec } from '@protolab/schema';
import { measureIndexedMotion } from '@protolab/simulator/indexed-motion';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

export const carouselBaselineVersionId = 'ver_2f10af17ef3e466d';
const baselineIndexing = {
  body: 'jewel_0', center: 'hub', plane: 'xz' as const, input: 'spin',
  step_deg: 90, stepTolerance_deg: 8, minDwell_s: 0.6, maxDwellDrift_deg: 3,
};

export default function IndexedMotionEvidence({ test, definition, time, iteration, versionId }: {
  test: TestResult;
  definition?: TestSpec;
  time: number;
  iteration?: number;
  versionId?: string;
}) {
  const headingId = useId();
  const goal = definition?.kind === 'motion' ? definition.measure.indexedMotion : undefined;
  const archive = versionId === carouselBaselineVersionId && test.testId === 'geneva_10s#1' && !goal;
  const settings = goal ?? (archive ? baselineIndexing : undefined);
  const measured = useMemo(() => {
    const result = settings && measureIndexedMotion(test.trace, settings);
    if (!result) return null;
    return {
      result,
      times: result.series.map(({ t }) => t),
      tracks: [
        { id: 'input', label: 'Input progress', values: result.series.map(({ input_deg }) => input_deg) },
        { id: 'output', label: 'Output angle', values: result.series.map(({ output_deg }) => output_deg) },
      ],
    };
  }, [settings, test.trace]);
  if (!measured) return null;

  const { result, times, tracks } = measured;
  const passed = goal && result.consecutiveSteps >= goal.minSteps;
  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>{archive ? 'Motion in the original recording' : 'Recorded indexing'}{iteration !== undefined && ` · v${iteration}`}</h3>
        {archive ? <>
          <p>The original test measured jewel orbit. The step count below comes from a later analysis of the saved trace.</p>
          <dl>
            <div><dt>Indexed steps observed</dt><dd>{result.consecutiveSteps}</dd></div>
            <div><dt>Driver turns</dt><dd>{test.metrics['spin.revolutions'].toFixed(2)}</dd></div>
            <div><dt>Jewel orbit turns</dt><dd>{test.metrics['jewel_0.orbitSignedTurns'].toFixed(2)}</dd></div>
          </dl>
        </> : goal && <>
          <p>{result.steps.length ? 'Shaded intervals show the wheel holding its position while the input continues turning.' : 'The output trace shows whether the wheel moves or holds while the input turns.'}</p>
          <dl>
            <div><dt>Consecutive steps with dwell</dt><dd>{result.consecutiveSteps}</dd><dd><small>Minimum {goal.minSteps}</small></dd></div>
            <div><dt>Target step size</dt><dd>{goal.step_deg}° ± {goal.stepTolerance_deg}°</dd></div>
            <div><dt>Required hold</dt><dd>≥ {goal.minDwell_s} s</dd><dd><small>≤ {goal.maxDwellDrift_deg}° drift</small></dd></div>
          </dl>
          <span className={`workbench-badge mt-2 inline-flex ${passed ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>
            Indexing goal {passed ? 'met' : 'missed'}
          </span>
        </>}
      </div>
      <RecordedSeriesChart times={times} tracks={tracks} time={time} unit="°" signed={tracks[1].values.some((value) => value < 0)}
        title="Input progress and output angle" description="Input progress and output angle from the saved simulation"
        regions={goal && result.steps.length ? { label: 'Observed dwell', ranges: result.holds } : undefined} />
    </section>
  );
}

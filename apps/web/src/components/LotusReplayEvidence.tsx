import { useId, useMemo } from 'react';
import type { TestResult, Trace, VersionRecord } from '@protolab/schema';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

const tips = ['tip0', 'tip1', 'tip2', 'tip3', 'tip4', 'tip5'];
const mm = (value: number) => `${value.toFixed(2)} mm`;

function range(values: number[]) {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function interval({ min, max }: ReturnType<typeof range>) {
  return min.toFixed(2) === max.toFixed(2) ? mm(min) : `${min.toFixed(2)}–${mm(max)}`;
}

function measureLotus(trace: Trace) {
  const { frames } = trace;
  if (frames.length < 2) return null;
  const positions = frames.map(({ bodies }) => tips.map((id) => bodies[id]?.position));
  if (positions.some((sample) => sample.some((position) => !position?.every(Number.isFinite)))) return null;

  const times = frames.map(({ t }) => t);
  const diameters = positions.map((sample) => sample.slice(0, 3).reduce((total, [x,,z], index) => {
    const [oppositeX,,oppositeZ] = sample[index + 3];
    return total + Math.hypot(x - oppositeX, z - oppositeZ) * 1000;
  }, 0) / 3);
  const diameter = range(diameters);
  const spreads = positions.map((sample) => {
    const displacement = range(sample.map(([, y], index) => (y - positions[0][index][1]) * 1000));
    return displacement.max - displacement.min;
  });
  const tipStroke = range(tips.map((_, index) => {
    const height = range(positions.map((sample) => sample[index][1]));
    return (height.max - height.min) * 1000;
  }));
  const tracks = [
    { id: 'opening', label: 'Diameter above minimum', values: diameters.map((value) => value - diameter.min) },
    { id: 'spread', label: 'Tip motion spread', values: spreads },
  ];

  return { times, diameters, diameter, tipStroke, spreads, peakSpread: Math.max(...spreads), tracks };
}

export default function LotusReplayEvidence({ version, test, time, iteration }: {
  version: VersionRecord;
  test: TestResult;
  time: number;
  iteration?: number;
}) {
  const headingId = useId();
  const eligible = version.inventionId === 'inv_ba7b3c7716564397' && /^lotus_cycle#\d+$/.test(test.testId);
  const result = useMemo(() => eligible ? measureLotus(test.trace) : null, [eligible, test.trace]);
  if (!result) return null;

  const { times, diameters, diameter, tipStroke, spreads, peakSpread, tracks } = result;
  const next = times.findIndex((sample) => sample >= time);
  const closest = next < 0 ? times.length - 1
    : next > 0 && time - times[next - 1] < times[next] - time ? next - 1 : next;

  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>Recorded lotus motion{iteration !== undefined && ` · v${iteration}`}</h3>
        <p>Six petal tips. Values at the cursor use the nearest recorded sample at {times[closest].toFixed(2)} s.</p>
        <dl>
          <div>
            <dt>Opening diameter at sample</dt>
            <dd>{mm(diameters[closest])}</dd>
            <dd><small>{interval(diameter)} across the run</small></dd>
          </div>
          <div>
            <dt>Vertical stroke per tip</dt>
            <dd>{interval(tipStroke)}</dd>
            <dd><small>≥ 40 mm goal</small></dd>
          </div>
          <div>
            <dt>Peak tip motion spread</dt>
            <dd>{mm(peakSpread)}</dd>
            <dd><small>{mm(spreads[closest])} at sample</small></dd>
          </div>
        </dl>
        <p className="mt-2">Diameter averages three opposite tip pairs in the horizontal plane. Spread is the difference between the largest and smallest vertical movements at the same instant.</p>
      </div>
      <RecordedSeriesChart times={times} tracks={tracks} time={time} unit=" mm"
        title="Opening change and tip motion spread" description="Recorded change in opening diameter and spread between the six tip movements" />
    </section>
  );
}

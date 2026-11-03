import { useId, useMemo } from 'react';
import { tiltDeg } from '@protolab/parts';
import type { TestResult, Trace } from '@protolab/schema';
import { fmt } from '../api.ts';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

const invention = 'inv_f72fb06c611342eb';
const limit = 8;
const parts = [{ id: 'cradle', label: 'Cradle' }, { id: 'tray', label: 'Tray' }];

function tiltSeries(trace: Trace) {
  const times = trace.frames.map(({ t }) => t);
  if (times.length < 2) return null;

  const tracks = parts.map((part) => ({
    ...part,
    values: trace.frames.map(({ bodies }) => {
      const rotation = bodies[part.id]?.rotation;
      return rotation ? tiltDeg(rotation) : Number.NaN;
    }),
  }));
  if (tracks.some(({ values }) => values.some((value) => !Number.isFinite(value)))) return null;
  return { times, tracks, peaks: tracks.map(({ values }) => Math.max(...values)) };
}

export default function TrayTiltEvidence({ inventionId, versionId, test, time, iteration }: {
  inventionId: string;
  versionId: string;
  test: TestResult;
  time: number;
  iteration?: number;
}) {
  const headingId = useId();
  const series = useMemo(() => inventionId === invention ? tiltSeries(test.trace) : null, [inventionId, test.trace]);
  if (!series) return null;
  const { times, tracks, peaks } = series;
  const meetsGoal = peaks[1] <= limit;
  const next = times.findIndex((sample) => sample >= time);
  const closest = next < 0 ? times.length - 1
    : next > 0 && time - times[next - 1] < times[next] - time ? next - 1 : next;

  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>Recorded tilt{iteration !== undefined && ` · v${iteration}`}</h3>
        <p>Angles from upright, measured from the saved orientations.</p>
        <dl>
          {tracks.map(({ id, label, values }, index) => <div key={id}>
            <dt>{label} peak</dt>
            <dd>{fmt.deg(peaks[index])} <small>{fmt.deg(values[closest])} at cursor</small></dd>
          </div>)}
          <div><dt>Tray tilt limit</dt><dd>≤ {limit}°</dd></div>
        </dl>
        <span className={`workbench-badge mt-2 inline-flex ${meetsGoal ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>Tray tilt goal {meetsGoal ? 'met' : 'missed'}</span>
        {versionId === 'ver_442a53c14ea94869' && (
          <p className="mt-2"><strong>Separate control rerun.</strong> Locking only the inner pivot raised peak tray tilt to 29.84°.</p>
        )}
      </div>
      <RecordedSeriesChart times={times} tracks={tracks} time={time} unit="°" limit={limit}
        title="Absolute tilt from upright" description="Recorded tilt over time for the cradle and tray, with an 8° tray limit" />
    </section>
  );
}

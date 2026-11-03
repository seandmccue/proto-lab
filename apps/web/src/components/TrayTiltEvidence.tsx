import { useId, useMemo } from 'react';
import { tiltDeg } from '@protolab/parts';
import type { Assembly, TestResult, Trace, VersionRecord } from '@protolab/schema';
import { fmt } from '../api.ts';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

const singleAxisId = 'inv_f72fb06c611342eb';
const twoAxisId = 'inv_d3f76fcc393b49d6';
const sweepGoal_deg = 0.35 * 180 / Math.PI;
const signedAngle = (angle: number) => `${angle > 0 ? '+' : ''}${fmt.deg(angle)}`;
const parts = [{ id: 'cradle', label: 'Cradle' }, { id: 'tray', label: 'Tray' }];

function tiltSeries(trace: Trace, assembly: Assembly, twoAxis: boolean) {
  const times = trace.frames.map(({ t }) => t);
  if (times.length < 2) return null;

  const tilt = (id: string) => trace.frames.map(({ bodies }) => {
    const rotation = bodies[id]?.rotation;
    return rotation ? tiltDeg(rotation) : Number.NaN;
  });
  const tilts = (twoAxis ? parts.slice(1) : parts).map((part) => ({ ...part, values: tilt(part.id) }));
  const active = twoAxis ? assembly.controller.drives.filter(({ controlId }) =>
    assembly.joints.some((joint) => joint.type === 'revolute' && joint.motor?.controlId === controlId)) : [];
  if (twoAxis && active.length !== 2) return null;
  const sweeps = active.map(({ controlId: id }) => ({
    id,
    label: id.replace(/[_-]+/g, ' '),
    values: trace.frames.map(({ joints }) => joints[id] * 180 / Math.PI),
  }));
  const tracks = [...sweeps, ...tilts];
  if (tracks.some(({ values }) => values.some((value) => !Number.isFinite(value)))) return null;
  const sweepRanges = sweeps.map(({ values }) => ({ min: Math.min(...values), max: Math.max(...values) }));
  return { times, tracks, peaks: tilts.map(({ values }) => Math.max(...values)), sweepRanges };
}

export default function TrayTiltEvidence({ version, test, time, iteration }: {
  version: VersionRecord;
  test: TestResult;
  time: number;
  iteration?: number;
}) {
  const headingId = useId();
  const { inventionId, assembly } = version;
  const twoAxis = inventionId === twoAxisId;
  const limit = twoAxis ? 10 : 8;
  const series = useMemo(() => twoAxis || inventionId === singleAxisId
    ? tiltSeries(test.trace, assembly, twoAxis) : null, [assembly, inventionId, test.trace, twoAxis]);
  if (!series) return null;
  const { times, tracks, peaks, sweepRanges } = series;
  const meetsGoal = peaks[peaks.length - 1] <= limit;
  const meetsSweepGoal = sweepRanges.every(({ min, max }) => min <= -sweepGoal_deg && max >= sweepGoal_deg);
  const next = times.findIndex((sample) => sample >= time);
  const closest = next < 0 ? times.length - 1
    : next > 0 && time - times[next - 1] < times[next] - time ? next - 1 : next;

  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>Recorded tilt{iteration !== undefined && ` · v${iteration}`}</h3>
        <p>{twoAxis ? 'Signed drive sweeps and tray tilt from upright, measured from the saved run.' : 'Angles from upright, measured from the saved orientations.'}</p>
        <dl>
          {tracks.map(({ id, label, values }, index) => <div key={id}>
            <dt className="capitalize">{label}{index < sweepRanges.length ? ' sweep' : ' peak'}</dt>
            <dd>{index < sweepRanges.length
              ? `${signedAngle(sweepRanges[index].min)} to ${signedAngle(sweepRanges[index].max)}`
              : fmt.deg(peaks[index - sweepRanges.length])} <small>{index < sweepRanges.length ? signedAngle(values[closest]) : fmt.deg(values[closest])} at cursor</small></dd>
          </div>)}
          <div><dt>Tray tilt limit</dt><dd>≤ {limit}°</dd></div>
        </dl>
        <span className={`workbench-badge mt-2 inline-flex ${meetsGoal ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>Tray tilt goal {meetsGoal ? 'met' : 'missed'}</span>
        {twoAxis && (
          <p className="mt-2"><strong>Drive sweep goal {meetsSweepGoal ? 'met' : 'missed'}.</strong> Each drive must reach at least {fmt.deg(sweepGoal_deg)} in both directions.</p>
        )}
        {version.id === 'ver_442a53c14ea94869' && (
          <p className="mt-2"><strong>Separate control rerun.</strong> Locking only the inner pivot raised peak tray tilt to 29.84°.</p>
        )}
      </div>
      <RecordedSeriesChart times={times} tracks={tracks} time={time} unit="°" limit={limit} signed={twoAxis}
        title={twoAxis ? 'Signed drive angles and absolute tray tilt' : 'Absolute tilt from upright'}
        description={twoAxis ? 'Recorded sweeps for both active joints and absolute tray tilt, with a 10° tray limit'
          : 'Recorded tilt over time for the cradle and tray, with an 8° tray limit'} />
    </section>
  );
}

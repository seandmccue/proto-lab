import { useMemo } from 'react';
import type { Trace } from '@protolab/schema';

type Tracks = { tracks: readonly { id: string; label: string }[]; axis: 'x' | 'y' | 'z' };

function tracePaths(trace: Trace, { tracks, axis }: Tracks) {
  const { frames } = trace;
  const first = frames[0]?.t;
  const last = frames.at(-1)?.t;
  if (!tracks.length || first === undefined || last === undefined || last <= first) return null;

  const coordinate = { x: 0, y: 1, z: 2 }[axis];
  const positions = tracks.map(({ id }) => frames.map(({ bodies }) => bodies[id]?.position[coordinate]));
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

export default function RecordedDisplacementChart({ trace, tracks, axis, time }: Tracks & { trace: Trace; time: number }) {
  const chart = useMemo(() => tracePaths(trace, { tracks, axis }), [trace, tracks, axis]);
  if (!chart) return null;
  const { first, last, scaleMm, lines } = chart;
  const cursor = Math.max(0, Math.min(1000, (time - first) / (last - first) * 1000));

  return (
    <figure className="workbench-follower-chart">
      <figcaption>Recorded displacement from each part’s lowest position</figcaption>
      <div className="workbench-follower-legend">
        {tracks.map(({ id, label }, index) => <span key={id} data-line={index}>{label}</span>)}
      </div>
      <div className="workbench-follower-plot">
        <div className="workbench-follower-axis" aria-hidden="true"><span>{scaleMm} mm</span><span>0 mm</span></div>
        <div>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`Recorded displacement over time for ${tracks.map(({ label }) => label).join(', ')}. The marker follows the replay.`}>
            {[0, 50, 100].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="workbench-follower-gridline" />)}
            {lines.map((line, index) => <polyline key={tracks[index].id} points={line} data-line={index} />)}
            <line x1={cursor} x2={cursor} y1="0" y2="100" className="workbench-follower-cursor" />
          </svg>
          <div className="workbench-follower-time" aria-hidden="true"><span>{first.toFixed(1)} s</span><span>{last.toFixed(1)} s</span></div>
        </div>
      </div>
    </figure>
  );
}

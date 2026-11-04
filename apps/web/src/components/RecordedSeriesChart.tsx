import { useMemo } from 'react';

type Track = { id: string; label: string; values: number[] };

function chartPaths(times: number[], tracks: Track[], signed: boolean, limit?: number) {
  const first = times[0], last = times.at(-1);
  if (!tracks.length || first === undefined || last === undefined || last <= first) return null;
  const peak = Math.max(limit ?? 0, ...tracks.map(({ values }) => signed ? Math.max(...values.map(Math.abs)) : Math.max(...values)));
  const scale = Math.max(5, 5 * Math.ceil(peak / 5));
  const floor = signed ? -scale : 0;
  const range = scale - floor;
  const lines = tracks.map(({ values }) => values.map((value, index) => {
    const x = (times[index] - first) / (last - first) * 1000;
    const y = 100 - (value - floor) / range * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' '));
  return { first, last, scale, floor, range, lines };
}

export default function RecordedSeriesChart({ times, tracks, time, title, description, unit, limit, signed = false, regions }: {
  times: number[];
  tracks: Track[];
  time: number;
  title: string;
  description: string;
  unit: string;
  limit?: number;
  signed?: boolean;
  regions?: { label: string; ranges: { start_s: number; end_s: number }[] };
}) {
  const chart = useMemo(() => chartPaths(times, tracks, signed, limit), [times, tracks, signed, limit]);
  if (!chart) return null;
  const { first, last, scale, floor, range, lines } = chart;
  const position = (seconds: number) => Math.max(0, Math.min(1000, (seconds - first) / (last - first) * 1000));
  const cursor = position(time);
  const limitY = limit === undefined ? undefined : 100 - (limit - floor) / range * 100;

  return (
    <figure className="workbench-follower-chart">
      <figcaption>{title}</figcaption>
      <div className="workbench-follower-legend">
        {tracks.map(({ id, label }, index) => <span key={id} data-line={index}>{label}</span>)}
        {!!regions?.ranges.length && <span className="workbench-chart-region-label">{regions.label}</span>}
        {limit !== undefined && <span className="workbench-chart-limit-label">{limit}{unit} limit</span>}
      </div>
      <div className="workbench-follower-plot">
        <div className="workbench-follower-axis" aria-hidden="true"><span>{scale}{unit}</span>{signed && <span>0{unit}</span>}<span>{floor}{unit}</span></div>
        <div>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`${description}. The marker follows the replay.`}>
            {regions?.ranges.map(({ start_s, end_s }) => (
              <rect key={start_s} x={position(start_s)} y="0" width={position(end_s) - position(start_s)}
                height="100" className="workbench-chart-region" />
            ))}
            {[0, 50, 100].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} className={signed && y === 50 ? 'workbench-chart-zero' : 'workbench-follower-gridline'} />)}
            {limitY !== undefined && <line x1="0" x2="1000" y1={limitY} y2={limitY} className="workbench-chart-limit" />}
            {lines.map((line, index) => <polyline key={tracks[index].id} points={line} data-line={index} />)}
            <line x1={cursor} x2={cursor} y1="0" y2="100" className="workbench-follower-cursor" />
          </svg>
          <div className="workbench-follower-time" aria-hidden="true"><span>{first.toFixed(1)} s</span><span>{last.toFixed(1)} s</span></div>
        </div>
      </div>
    </figure>
  );
}

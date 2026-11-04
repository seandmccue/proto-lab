import { useMemo } from 'react';
import type { Trace } from '@protolab/schema';
import RecordedSeriesChart from './RecordedSeriesChart.tsx';

type Tracks = { tracks: readonly { id: string; label: string }[]; axis: 'x' | 'y' | 'z' };

function displacementSeries(trace: Trace, { tracks, axis }: Tracks) {
  const coordinate = { x: 0, y: 1, z: 2 }[axis];
  const positions = tracks.map(({ id }) => trace.frames.map(({ bodies }) => bodies[id]?.position[coordinate]));
  if (positions.some((series) => series.some((value) => !Number.isFinite(value)))) return null;

  return {
    times: trace.frames.map(({ t }) => t),
    tracks: tracks.map((track, index) => {
      const low = Math.min(...positions[index]);
      return { ...track, values: positions[index].map((position) => (position - low) * 1000) };
    }),
  };
}

export default function RecordedDisplacementChart({ trace, tracks, axis, time }: Tracks & { trace: Trace; time: number }) {
  const series = useMemo(() => displacementSeries(trace, { tracks, axis }), [trace, tracks, axis]);
  if (!series) return null;
  return <RecordedSeriesChart {...series} time={time} unit=" mm"
    title="Recorded displacement from each part’s lowest position"
    description={`Recorded displacement over time for ${tracks.map(({ label }) => label).join(', ')}`} />;
}

import { useId, useMemo } from 'react';
import type { TestResult, VersionRecord } from '@protolab/schema';
import { measureFollowerTiming } from '@protolab/simulator/follower-timing';
import { fmt } from '../api.ts';
import RecordedDisplacementChart from './RecordedDisplacementChart.tsx';

const reference = {
  shaft: 'shaft_spin',
  followers: ['piston_1', 'piston_2', 'piston_3'] as [string, string, string],
  axis: 'y' as const,
};
const musePump = {
  shaft: 'spin',
  followers: ['pist0', 'pist1', 'pist2'] as [string, string, string],
  axis: 'y' as const,
};
const target = { min: 110, max: 130 };

export default function TriplexTimingEvidence({ version, test, time }: {
  version: VersionRecord;
  test: TestResult;
  time: number;
}) {
  const headingId = useId();
  const isMuse = version.inventionId === 'inv_c618332e234d447d' &&
    (version.id === 'ver_d2c2ecd5ab714ac1' || version.id === 'ver_acc66928f8a94c26') && test.testId === 'pump_motion#1';
  const timing = isMuse ? musePump
    : version.id === 'ver_triplex_pump_1' && test.testId === 'triplex_pump_cycles' ? reference : null;
  const turns = useMemo(() => timing ? measureFollowerTiming(test.trace, timing) : [], [test.trace, timing]);
  const tracks = useMemo(() => timing?.followers.map((id, index) => ({ id, label: `Piston ${index + 1}` })) ?? [], [timing]);
  if (!turns.length) return null;

  const gaps = turns.flatMap(({ phaseGaps_deg }) => phaseGaps_deg);
  const strokesMm = turns.flatMap(({ flags }) => flags.map(({ stroke_m }) => stroke_m * 1000));
  const minStroke = Math.min(...strokesMm).toFixed(1);
  const maxStroke = Math.max(...strokesMm).toFixed(1);
  const strokeRange = minStroke === maxStroke ? minStroke : `${minStroke}–${maxStroke}`;
  const minGap = Math.min(...gaps), maxGap = Math.max(...gaps);
  const meetsTarget = minGap >= target.min && maxGap <= target.max;

  return (
    <section className="workbench-follower-evidence" aria-labelledby={headingId}>
      <div className="workbench-follower-metrics">
        <h3 className="workbench-label" id={headingId}>Measured piston timing{isMuse && ` · v${version.iteration}`}</h3>
        <p>One shaft drives three pistons in sequence. Measured across {turns.length} full turns after startup.</p>
        <dl>
          <div><dt>Stroke per piston</dt><dd>{strokeRange} mm</dd></div>
          <div>
            <dt>Shaft angle between successive peaks</dt>
            <dd>{fmt.deg(minGap)}–{fmt.deg(maxGap)} <small>{isMuse ? '110°–130° goal' : '120° design spacing'}</small></dd>
          </div>
        </dl>
        {isMuse && <span className={`workbench-badge mt-2 inline-flex ${meetsTarget ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>Phase target {meetsTarget ? 'met' : 'missed'}</span>}
      </div>
      <RecordedDisplacementChart trace={test.trace} tracks={tracks} axis="y" time={time} />
    </section>
  );
}

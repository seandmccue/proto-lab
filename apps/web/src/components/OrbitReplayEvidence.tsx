import { useId, useMemo } from 'react';
import type { TestResult, TestSpec } from '@protolab/schema';
import { measurePlanarOrbit } from '@protolab/simulator/planar-orbit';

export const curatedOrreryId = 'inv_adc081059ea44ab9';
const earthFrame = { body: 'earth', center: 'sun', plane: 'xz' as const };
const moonFrame = { body: 'moon', center: 'earth', plane: 'xz' as const, reference: { from: 'sun', to: 'earth' } };

type Orbit = NonNullable<ReturnType<typeof measurePlanarOrbit>>;
type Sample = Orbit['points'][number];
type OrbitTarget = NonNullable<Extract<TestSpec, { kind: 'motion' }>['measure']['orbits']>[number];
type OrbitGoal = Pick<OrbitTarget, 'minTurns' | 'direction'>;

function partName(id: string) {
  return id.replace(/[_-]+/g, ' ');
}

function cursorAt(points: Orbit['points'], time: number): Pick<Sample, 'u_m' | 'v_m'> {
  const next = points.findIndex(({ t }) => t > time);
  if (next === -1) return points[points.length - 1];
  if (next === 0) return points[0];
  const from = points[next - 1];
  const to = points[next];
  const progress = (time - from.t) / (to.t - from.t);
  return { u_m: from.u_m + (to.u_m - from.u_m) * progress, v_m: from.v_m + (to.v_m - from.v_m) * progress };
}

function OrbitPlot({ orbit, time, title, frame, tone, target }: {
  orbit: Orbit;
  time: number;
  title: string;
  frame: string;
  tone: 'earth' | 'moon';
  target?: OrbitGoal;
}) {
  const scale = 43 / orbit.maxRadius_m;
  const path = useMemo(() => orbit.points.map(({ u_m, v_m }) => `${(u_m * scale).toFixed(2)},${(-v_m * scale).toFixed(2)}`).join(' '), [orbit, scale]);
  const cursor = cursorAt(orbit.points, time);
  const minMm = (orbit.minRadius_m * 1000).toFixed(1);
  const maxMm = (orbit.maxRadius_m * 1000).toFixed(1);
  const radius = minMm === maxMm ? minMm : `${minMm}–${maxMm}`;
  const turns = (target?.direction ? orbit.signedTurns : Math.abs(orbit.signedTurns)).toFixed(2);
  const turnsTowardGoal = target?.direction === 'negative' ? -orbit.signedTurns
    : target?.direction === 'positive' ? orbit.signedTurns : Math.abs(orbit.signedTurns);
  const met = target !== undefined && turnsTowardGoal >= target.minTurns;

  return (
    <figure className="workbench-orbit-plot" data-orbit={tone}>
      <figcaption>
        <strong>{title}</strong>
        <span>{frame}</span>
      </figcaption>
      <svg viewBox="-50 -50 100 100" role="img" aria-label={`${title}. The dot follows the replay.`}>
        <path d="M-47 0H47M0-47V47" className="workbench-orbit-crosshair" />
        <polyline points={path} />
        <circle cx="0" cy="0" r="3" className="workbench-orbit-center" />
        <circle cx={cursor.u_m * scale} cy={-cursor.v_m * scale} r="3.5" className="workbench-orbit-cursor" />
      </svg>
      <p>
        <strong>{turns} net {Math.abs(Number(turns)) === 1 ? 'turn' : 'turns'}</strong>
        <span>{radius} mm radius</span>
        {target && <span>Goal ≥ {target.minTurns} {target.direction ? `${target.direction} ` : ''}{target.minTurns === 1 ? 'turn' : 'turns'}</span>}
        {target && <span className={`workbench-badge mt-1 justify-self-center ${met ? 'workbench-pass' : 'bg-warn/15 text-warn'}`}>Turn goal {met ? 'met' : 'missed'}</span>}
      </p>
    </figure>
  );
}

export default function OrbitReplayEvidence({ inventionId, test, definition, time, iteration }: {
  inventionId: string;
  test: TestResult;
  definition?: TestSpec;
  time: number;
  iteration?: number;
}) {
  const headingId = useId();
  const targets = definition?.kind === 'motion' ? definition.measure.orbits : undefined;
  const plots = useMemo(() => {
    if (targets?.length) {
      return targets.flatMap((target) => {
        const orbit = measurePlanarOrbit(test.trace, target);
        if (!orbit) return [];
        const { reference } = target;
        const frame = typeof reference === 'string' ? `Frame turns with ${partName(reference)}`
          : reference ? `Frame turns with ${partName(reference.from)} → ${partName(reference.to)}`
          : `Fixed ${target.plane.toUpperCase()} axes`;
        return [{ orbit, title: `${partName(target.body)} around ${partName(target.center)}`, frame, target }];
      });
    }
    if (inventionId !== curatedOrreryId) return [];
    const earth = measurePlanarOrbit(test.trace, earthFrame);
    const moon = measurePlanarOrbit(test.trace, moonFrame);
    if (!earth || !moon) return [];
    return [
      { orbit: earth, title: 'Earth around Sun', frame: 'Tabletop frame', target: { minTurns: 1 } },
      { orbit: moon, title: 'Moon around Earth', frame: 'Frame turns with Earth’s arm', target: { minTurns: 3 } },
    ];
  }, [inventionId, targets, test.trace]);
  if (!plots.length) return null;

  return (
    <section className="workbench-orbit-evidence" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="workbench-label">Recorded orbital paths{iteration !== undefined && ` · v${iteration}`}</h3>
        <p>The dots move with replay. Each plot uses its own scale.</p>
      </div>
      <div className="workbench-orbit-plots">
        {plots.map((plot, index) => <OrbitPlot key={plot.title} {...plot} time={time} tone={index % 2 === 0 ? 'earth' : 'moon'} />)}
      </div>
    </section>
  );
}

import { useId, useMemo } from 'react';
import { receiverChecks, type TestResult, type TestSpec } from '@protolab/schema';
import { receiverOccupancyAt, sampleReceiverOccupancy } from '@protolab/simulator/end-in';

type ReceiverTargets = Extract<TestSpec, { kind: 'motion' }>['measure']['endIn'];

export function replayReceiverTargets(definition?: TestSpec): ReceiverTargets {
  return definition?.kind === 'motion' ? definition.measure.endIn : undefined;
}

export default function ReceiverReplayEvidence({ targets, test, time, compareTarget = false }: {
  targets: ReceiverTargets;
  test: TestResult;
  time: number;
  compareTarget?: boolean;
}) {
  const headingId = useId();
  const receivers = useMemo(() => receiverChecks(targets).flatMap(({ check, holdKey }) => {
    const samples = sampleReceiverOccupancy(test.trace, check);
    return samples || !compareTarget ? [{ check, holdKey, samples }] : [];
  }), [targets, test.trace, compareTarget]);
  if (!receivers.length) return null;

  return <section className="workbench-receiver-evidence" aria-labelledby={headingId}>
    <h3 id={headingId} className="workbench-label">Receiver check</h3>
    <ul>
      {receivers.map(({ check, holdKey, samples }) => {
        const current = samples && receiverOccupancyAt(samples, time);
        const final = samples?.at(-1);
        const savedHold = compareTarget ? undefined : test.metrics[holdKey];
        const finalHold = final?.hold_s ?? savedHold;
        const passed = finalHold !== undefined && finalHold + 1e-8 >= check.minHold_s;
        const resultLabel = savedHold === undefined ? 'Trace' : 'Saved';
        return <li key={holdKey}>
          <strong>{check.instance.replace(/[_-]+/g, ' ')} → {check.receiver.replace(/[_-]+/g, ' ')}</strong>
          <span className={current?.inside ? 'is-inside' : ''}>
            {current ? <>{current.inside ? 'Inside receiver' : 'Outside receiver'} · {current.hold_s.toFixed(2)} s inside now</> : 'Position unavailable'}
          </span>
          <span className="workbench-receiver-result">
            {finalHold === undefined ? 'Final hold unavailable' : <>
              <span className={`workbench-badge ${passed ? 'workbench-pass' : 'bg-amber-100 text-amber-800'}`}>{resultLabel} {passed ? 'pass' : 'miss'}</span>
              {finalHold.toFixed(2)} s held / {check.minHold_s.toFixed(2)} s required
            </>}
          </span>
        </li>;
      })}
    </ul>
  </section>;
}

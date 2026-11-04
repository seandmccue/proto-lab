import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, generatePart, piece, sub, transformPoint, type AssemblyOp } from '@protolab/parts';
import { TestSpec, type TestResult } from '@protolab/schema';
import { buildMarbleElevator, marbleElevatorEndIn } from '@protolab/simulator/marble-elevator';
import { baseSpec, ToolRuntime } from './index.ts';
import { failedReceiverPaths } from './test-feedback.ts';

test('failed transfer feedback contains observed paths for the missed receiver only', async () => {
  const fixture = buildMarbleElevator();
  const firstBallPart = fixture.instances.find(({ id }) => id === 'marble')!.partId;
  const firstReceiverPart = fixture.instances.find(({ id }) => id === 'catcher')!.partId;
  const base = fixture.instances.find(({ id }) => id === 'base')!;
  const basePart = fixture.parts.find(({ id }) => id === base.partId)!;
  const baseTopY = base.transform.position[1] + basePart.dimensions_m[1] / 2;
  const supportJoints = [['actuator', 'base'], ['ramp', 'bottom'], ['catcher', 'bottom']].map(([id, connector]): AssemblyOp => {
    const instance = fixture.instances.find((candidate) => candidate.id === id)!;
    const part = fixture.parts.find((candidate) => candidate.id === instance.partId)!;
    const [x, y, z] = transformPoint(instance.transform, part.connectors.find((candidate) => candidate.id === connector)!.position);
    // Seat each post against the mechanism without changing any moving part or receiver pose.
    const topY = y + 0.002;
    const height = topY - baseTopY;
    basePart.geometry.push(piece({ kind: 'box', size: [0.012, height, 0.012] }, sub([x, baseTopY + height / 2, z], base.transform.position)));
    basePart.connectors.push({ id, position: sub([x, topY, z], base.transform.position), axis: [0, 1, 0], kind: 'fixed' });
    return { op: 'connect', a: 'base', a_connector: id, b: id, b_connector: connector, joint: 'fixed' };
  });
  const missedStand = generatePart('beam', { length: 0.15, width: 0.012, height: 0.012 }, 'receiver-stand-150');
  const { assembly } = applyOps(fixture, [
    ...supportJoints,
    { op: 'place', id: 'missed_stand', part: missedStand.id, position: [0.45, 0.075, 0], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'missed_catcher', part: firstReceiverPart, position: [0.45, 0.15, 0] },
    { op: 'connect', a: 'missed_stand', a_connector: 'end_b', b: 'missed_catcher', b_connector: 'bottom', joint: 'fixed' },
    { op: 'place', id: 'missed_marble', part: firstBallPart, position: [0.60, 0.18, 0], free: true },
  ], (id) => id === missedStand.id ? missedStand : fixture.parts.find((part) => part.id === id));
  const spec = TestSpec.parse({
    kind: 'motion', id: 'two_catches', duration_s: 9,
    measure: { endIn: [marbleElevatorEndIn, { ...marbleElevatorEndIn, instance: 'missed_marble', receiver: 'missed_catcher' }] },
    criteria: { torqueWithinRating: false },
  });
  let observed: TestResult | undefined;
  const rt = new ToolRuntime(baseSpec('Catch both marbles'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: (result) => { observed = result; },
  }, undefined, assembly);
  await rt.call('define_test', { test: spec });
  const reply = await rt.call('run_test', { test_id: spec.id }) as {
    passed: boolean; payloadPaths: ReturnType<typeof failedReceiverPaths>;
  };
  assert.equal(reply.passed, false);
  assert.ok(observed);
  assert.ok(observed.metrics['endInHold_s.1'] >= 0.75);
  assert.equal(observed.metrics['endInHold_s.2'], 0);
  assert.equal(reply.payloadPaths.length, 1);
  const path = reply.payloadPaths[0];
  assert.equal(path.instance, 'missed_marble');
  assert.equal(path.receiver, 'missed_catcher');
  assert.ok(path.samples.length >= 7 && path.samples.length <= 9);
  assert.equal(path.samples[0][0], observed.trace.frames[0].t);
  assert.equal(path.samples.at(-1)![0], +observed.trace.frames.at(-1)!.t.toFixed(5));
  for (const row of path.samples) {
    const frame: TestResult['trace']['frames'][number] | undefined = observed.trace.frames.find(({ t }) => +t.toFixed(5) === row[0]);
    assert.ok(frame);
    assert.deepEqual(row.slice(1), frame.bodies.missed_marble.position.map((value) => +value.toFixed(5)));
  }
  // The missed marble falls long before the first uniform sample at 1.5 s.
  assert.ok(path.samples.some((row) => row[0]! > 0 && row[0]! < 0.5));
  assert.deepEqual(failedReceiverPaths(spec, { ...observed, passed: true }), []);
});

test('missing payload observations remain missing and a short trace is not duplicated', () => {
  const spec = TestSpec.parse({ kind: 'motion', id: 'catch', duration_s: 1,
    measure: { endIn: marbleElevatorEndIn }, criteria: {} });
  const result: TestResult = {
    testId: 'catch#1', kind: 'motion', passed: false, metrics: {}, failureReasons: [], notes: [], engine: 'fixture',
    trace: { dt: 1, frames: [{ t: 0, bodies: {}, joints: {} }, { t: 1, bodies: {}, joints: {} }] },
  };
  const paths = failedReceiverPaths(spec, result);
  assert.deepEqual(paths[0].samples, [[0, null, null, null], [1, null, null, null]]);
  assert.deepEqual(failedReceiverPaths(spec, { ...result, trace: { dt: 1, frames: [] } }), []);
});

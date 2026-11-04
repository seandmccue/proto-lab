import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, AssemblyOp, emptyAssembly, getPart, setDrives } from '@protolab/parts';
import { TestSpec } from '@protolab/schema';
import { runTest } from './index.ts';

test('a steadily turning wheel passes the orbit target but fails indexed motion', async () => {
  const ops = [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-200', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute',
      motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    { op: 'mount', id: 'marker', part: 'marker-tip-8', onto: 'wheel', connector: 'rim_0', via: 'mount', joint: 'fixed' },
  ].map((op) => AssemblyOp.parse(op));
  const assembly = setDrives(applyOps(emptyAssembly(), ops, getPart).assembly, [
    { controlId: 'spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 1.6 } },
  ]);
  const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
  const measure = { joints: ['spin'], orbits: [{ body: 'marker', center: 'wheel', plane: 'xy', minTurns: 1 }] };
  const motion = { kind: 'motion', id: 'wheel', duration_s: 10, measure, criteria: { torqueWithinRating: true } };
  const continuous = await runTest(assembly, { env, test: TestSpec.parse(motion) });
  assert.ok(continuous.passed, continuous.failureReasons.join(', '));

  const indexed = await runTest(assembly, { env, test: TestSpec.parse({
    ...motion, measure: { ...measure, indexedMotion: {
      input: 'spin', body: 'marker', center: 'wheel', plane: 'xy', minSteps: 2, step_deg: 90,
      stepTolerance_deg: 8, minDwell_s: 0.6, maxDwellDrift_deg: 3,
    } },
  }) });
  assert.equal(indexed.passed, false);
  assert.equal(indexed.metrics.indexedConsecutiveSteps, 0);
  assert.match(indexed.failureReasons.join(', '), /0 consecutive 90° steps with dwell/);
});

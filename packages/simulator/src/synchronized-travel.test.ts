import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, AssemblyOp, emptyAssembly, getPart, setDrives } from '@protolab/parts';
import { TestSpec } from '@protolab/schema';
import { runTest } from './index.ts';

test('synchronized travel catches two sliders reaching the same stroke out of phase', async () => {
  const actuators = ['left', 'right'];
  const sliders = actuators.map((id) => `${id}_slider`);
  const assembly = applyOps(emptyAssembly(), actuators.flatMap((id, index) => [
    AssemblyOp.parse({ op: 'place', id, part: 'actuator-50', position: [index * 0.2, 0.08, 0], rotation_deg: [0, 0, 90], anchored: true }),
    AssemblyOp.parse({ op: 'mount', id: sliders[index], part: 'carriage-20', onto: id, connector: 'rod', via: 'rail_face', joint: 'prismatic',
      limits: [0, 0.05], motor: { controlId: id, stiffness: 1800, damping: 9 } }),
  ]), getPart).assembly;

  const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
  const options = TestSpec.parse({
    kind: 'motion', id: 'sync_slides', duration_s: 4,
    measure: { synchronizedTravel: { instances: sliders, axis: 'y', minTravel_m: 0.035, maxSpread_m: 0.005 } },
    criteria: { torqueWithinRating: true },
  });
  const run = (phaseShift: number) => runTest(setDrives(assembly, actuators.map((controlId, index) => ({
    controlId, mode: 'position', rampIn_s: 0.25,
    profile: { kind: 'sine', amplitude: 0.022, offset: 0.022, frequency_hz: 0.5, phase: -Math.PI / 2 + phaseShift * index },
  }))), { env, test: options });

  const synchronized = await run(0);
  assert.ok(synchronized.passed, synchronized.failureReasons.join(', '));
  assert.ok(synchronized.metrics.synchronizedMaxSpread_m < 0.001);
  const shifted = await run(Math.PI);
  assert.ok(shifted.metrics.synchronizedMinTravel_m >= 0.035);
  assert.ok(shifted.metrics.synchronizedMaxSpread_m > 0.04);
  assert.equal(shifted.passed, false);
  assert.match(shifted.failureReasons.join(', '), /Synchronized displacement spread reached .* limit 5 mm/);
});

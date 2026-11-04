import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TestResult } from '@protolab/schema';
import { ToolRuntime } from './tools.ts';
import { baseSpec } from './spec.ts';

test('a spinning compound part cannot pass or finalize until its floating blade is connected', async () => {
  const recorded: TestResult[] = [];
  const rt = new ToolRuntime(baseSpec('A connected rotor'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: (result) => recorded.push(result),
  });
  const rotor = (bladeY: number) => ({
    name: 'Rotor with one blade', category: 'propellers', material: 'PLA',
    pieces: [
      { shape: { kind: 'cylinder', radius: 0.02, height: 0.02, axis: 'x' }, offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, color: '#aaaaaa', role: 'structure', collide: true },
      { shape: { kind: 'box', size: [0.02, 0.02, 0.02] }, offset: { position: [0, bladeY, 0], rotation: [0, 0, 0, 1] }, color: '#aaaaaa', role: 'blade', collide: true },
    ],
    connectors: [{ id: 'shaft', position: [-0.01, 0, 0], axis: [-1, 0, 0], kind: 'revolute' }],
  });
  const floating = await rt.call('design_part', rotor(0.1)) as { part: { id: string }; geometryWarnings: string[] };
  assert.match(floating.geometryWarnings.join(' '), /Floating pieces.*\[1\] \| \[2\]/);
  const mount = (part: string) => ({ op: 'mount', id: 'rotor', part, onto: 'motor', connector: 'shaft', via: 'shaft', joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } });
  const supportHeight = 0.3 - 0.0185;
  const support = await rt.call('create_part', { kind: 'beam', params: { length: supportHeight } }) as { error?: string; part: { id: string } };
  assert.ok(!support.error, support.error);
  const built = await rt.call('assemble', { rationale: 'Seat the motor on a grounded support and mount the rotor', ops: [
    { op: 'place', id: 'stand', part: support.part.id, position: [0, supportHeight / 2, 0], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'motor', part: 'gearmotor-37', position: [0, 0.3, 0] },
    { op: 'connect', a: 'stand', a_connector: 'end_b', b: 'motor', b_connector: 'flange', joint: 'fixed' },
    mount(floating.part.id),
  ] }) as { error?: string };
  assert.ok(!built.error, built.error);
  await rt.call('set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.1, profile: { kind: 'constant', value: 2.5 } }] });
  await rt.call('define_test', { test: { kind: 'motion', id: 'rotation', duration_s: 1, measure: { joints: ['spin'] }, criteria: { minRevolutions: 0.1, torqueWithinRating: true } } });

  const failed = await rt.call('run_test', { test_id: 'rotation' }) as TestResult;
  assert.ok(failed.metrics['spin.revolutions'] > 0.1, 'rotation alone meets the target');
  assert.equal(failed.passed, false);
  assert.equal(failed.metrics.disconnectedGeometryParts, 1);
  assert.match(failed.failureReasons.join(' '), /Floating pieces in rotor/);
  assert.ok(recorded[0].trace.frames.length > 1, 'the failed build retains its actual replay');
  const finalize = await rt.call('finalize_design', { status: 'passed', summary: 'The rotor turns.' }) as { error: string };
  assert.match(finalize.error, /latest test failed/);

  const sweep = await rt.call('sweep_drive', { test_id: 'rotation', controlId: 'spin', field: 'value', values: [2, 2.5], duration_s: 1 }) as { results: { passed: number }[] };
  assert.deepEqual(sweep.results.map((result) => result.passed), [0, 0], 'speed tuning cannot bypass the geometry check');

  const connected = await rt.call('design_part', rotor(0.025)) as { part: { id: string }; geometryWarnings?: string[] };
  assert.equal(connected.geometryWarnings, undefined);
  await rt.call('assemble', { rationale: 'Seat the blade inside its hub', ops: [mount(connected.part.id)] });
  const passed = await rt.call('run_test', { test_id: 'rotation' }) as TestResult;
  assert.equal(passed.passed, true, JSON.stringify(passed.failureReasons));
  assert.equal(passed.metrics.disconnectedGeometryParts, 0);
  assert.ok(passed.metrics['spin.revolutions'] > 0.1);
  assert.deepEqual(await rt.call('finalize_design', { status: 'passed', summary: 'The connected rotor passes its rotation and geometry checks.' }), { ok: true });
});

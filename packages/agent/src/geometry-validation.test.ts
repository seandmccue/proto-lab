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
  await rt.call('assemble', { rationale: 'Turn the rotor from a rated motor', ops: [
    { op: 'place', id: 'motor', part: 'gearmotor-37', position: [0, 0.3, 0], anchored: true }, mount(floating.part.id),
  ] });
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

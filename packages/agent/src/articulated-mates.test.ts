import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestSpec, type TestResult } from '@protolab/schema';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

test('moving a mounted wheel sideways blocks all simulation gates, preserves the draft, and permits repair within one native run', async () => {
  let starts = 0;
  const recorded: TestResult[] = [];
  const rt = new ToolRuntime(baseSpec('A motor-driven wheel on a grounded stand'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTestStart() { starts++; },
    onTest(result) { recorded.push(result); },
  }, { maxTests: 1, maxToolCalls: 20 });
  const definition = TestSpec.parse({
    id: 'wheel_spin', kind: 'motion', duration_s: 2,
    measure: { joints: ['spin'], noGroundContact: ['wheel'] },
    criteria: { minRevolutions: .5, torqueWithinRating: true },
  });
  for (const [name, args] of [
    ['assemble', { rationale: 'Mount an actual wheel on a motor supported by a grounded stand.', ops: [
      { op: 'place', id: 'stand', part: 'tower-300', position: [0, 0, 0], anchored: true },
      { op: 'mount', id: 'motor', part: 'gearmotor-37', onto: 'stand', connector: 'top', via: 'flange', joint: 'fixed' },
      { op: 'mount', id: 'wheel', part: 'spoked-wheel-200', onto: 'motor', connector: 'shaft', via: 'hub', joint: 'revolute', motor: { controlId: 'spin', stiffness: .3, damping: .1 } },
    ] }],
    ['set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: .2, profile: { kind: 'constant', value: 6 } }] }],
    ['define_test', { test: definition }],
    ['assemble', { rationale: 'Move the wheel aside, leaving the old mate attached.', ops: [
      { op: 'move', id: 'wheel', translate: [0, .025, 0], withAttached: false },
    ] }],
  ] as const) {
    const response = await rt.call(name, structuredClone(args)) as { error?: string };
    assert.equal(response.error, undefined, response.error);
  }
  const rejectedDraft = structuredClone(rt.assembly);
  for (const [name, args] of [
    ['run_test', { test_id: definition.id }],
    ['sweep_drive', { test_id: definition.id, controlId: 'spin', field: 'value', values: [5, 6] }],
    ['finalize_design', { status: 'passed', summary: 'The wheel works.' }],
  ] as const) {
    const response = await rt.call(name, args) as { error: string; assemblyChecks: {
      passed: boolean; issues: { kind: string; radialGap_m: number; axisError_deg: number; instanceIds: string[]; suggestion: string }[];
    } };
    assert.match(response.error, /No simulation budget was spent/);
    assert.equal(response.assemblyChecks.passed, false);
    const issue = response.assemblyChecks.issues.find(issue => issue.kind === 'articulated_joint_misalignment');
    assert.ok(issue);
    assert.deepEqual(issue.instanceIds, ['motor', 'wheel']);
    assert.ok(Math.abs(issue.radialGap_m - .025) < 1e-8);
    assert.ok(issue.axisError_deg < 1e-6);
    assert.match(issue.suggestion, /motor\.shaft and wheel\.hub/);
  }
  assert.equal(rt.testCount, 0);
  assert.equal(rt.sweeps, 0);
  assert.equal(starts, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(rt.tests, []);
  assert.equal(rt.finalized, null);
  assert.deepEqual(rt.assembly, rejectedDraft, 'failed validation must preserve the exact editable draft');
  assert.deepEqual(rt.testSpecs.get(definition.id), definition);

  const repair = await rt.call('assemble', { rationale: 'Restore the real coaxial mate without changing the test.', ops: [
    { op: 'move', id: 'wheel', translate: [0, -.025, 0], withAttached: false },
  ] }) as { error?: string };
  assert.equal(repair.error, undefined, repair.error);
  const result = await rt.call('run_test', { test_id: definition.id }) as { passed: boolean; failureReasons: string[]; error?: string };
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.passed, true, result.failureReasons?.join(', '));
  assert.equal(rt.testCount, 1);
  assert.equal(starts, 1);
  assert.equal(recorded.length, 1);
  assert.deepEqual(rt.testSpecs.get(definition.id), definition);
  const weakened = await rt.call('define_test', { test: { ...definition, duration_s: 1 } }) as { error: string };
  assert.match(weakened.error, /fixed when comparing revisions/);
});

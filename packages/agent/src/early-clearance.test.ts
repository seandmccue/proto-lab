import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestResult } from '@protolab/schema';
import type { SampledClearance } from '@protolab/simulator';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

const spin = {
  kind: 'motion', id: 'spin', duration_s: 1,
  measure: { joints: ['spin'] }, criteria: { minJointRate_rad_s: 0.2, torqueWithinRating: true },
};
type Reply = Omit<TestResult, 'trace' | 'engine'> & { assemblyClearance: SampledClearance & { diagnosticOnly: true } };

async function callOk(rt: ToolRuntime, name: string, args: unknown) {
  const response = await rt.call(name, args) as { error?: string };
  assert.equal(response.error, undefined, response.error);
  return response;
}

async function fixture() {
  const emitted: TestResult[] = [];
  const rt = new ToolRuntime(baseSpec('Spin a wheel with a grounded support and brace.'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTest(result) { emitted.push(structuredClone(result)); },
  }, { maxTests: 3, maxToolCalls: 20 });
  await callOk(rt, 'assemble', { rationale: 'Fit a wheel and brace to a grounded tower.', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub',
      joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    { op: 'mount', id: 'brace', part: 'beam-100', onto: 'tower', connector: 'axle', via: 'end_a', joint: 'fixed' },
  ] });
  await callOk(rt, 'set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.2,
    profile: { kind: 'constant', value: 2 } }] });
  await callOk(rt, 'define_test', { test: spin });
  return { rt, emitted };
}

test('run_test reports omitted overlap early, preserves native evidence, and reuses only matching assembly/replay diagnostics', async () => {
  const { rt, emitted } = await fixture();
  const response = await callOk(rt, 'run_test', { test_id: spin.id }) as unknown as Reply;
  assert.equal(response.passed, true);
  assert.deepEqual(response.failureReasons, []);
  assert.equal(response.assemblyClearance.diagnosticOnly, true);
  assert.equal(response.assemblyClearance.complete, true);
  assert.ok(response.assemblyClearance.issues.some(({ firstId, secondId, penetration_m }) =>
    [firstId, secondId].sort().join('|') === 'brace|wheel' && penetration_m > 0.001));
  assert.deepEqual(rt.tests, emitted, 'the diagnostic must not alter native metrics, verdict, reasons, or saved trace');
  assert.ok(!('assemblyClearance' in rt.tests[0]), 'diagnostics remain separate from the native result schema');
  assert.deepEqual(rt.pendingChecks(), [], 'observations alone must not veto intended contacts or invent native failures');

  const assembly = rt.assembly;
  const trace = rt.tests[0].trace;
  const cached = rt.clearanceObservation(assembly, trace);
  assert.strictEqual(rt.clearanceObservation(assembly, structuredClone(trace)), cached,
    'byte-identical replays from different test objects must share one audit promise');
  assert.strictEqual((await cached).issues, response.assemblyClearance.issues,
    'run_test must return the cached report that final review can reuse');
  const shortened = rt.clearanceObservation(assembly, { ...trace, frames: trace.frames.slice(0, 2) });
  assert.notStrictEqual(shortened, cached);
  assert.equal((await shortened).samplesChecked, 2, 'a different replay needs its own observations');

  await callOk(rt, 'assemble', { rationale: 'Move the same brace to the tower top, clear of the wheel.', ops: [
    { op: 'remove', id: 'brace' },
    { op: 'mount', id: 'brace', part: 'beam-100', onto: 'tower', connector: 'top', via: 'end_a', joint: 'fixed' },
  ] });
  assert.notStrictEqual(rt.assembly, assembly);
  assert.notStrictEqual(rt.clearanceObservation(rt.assembly, trace), cached,
    'an assembly revision must not reuse a prior assembly report even for an identical supplied trace');
  assert.ok(rt.pendingChecks().some((check) => check.includes('assembly geometry changed')));
  const repaired = await callOk(rt, 'run_test', { test_id: spin.id }) as unknown as Reply;
  assert.equal(repaired.passed, true);
  assert.equal(repaired.assemblyClearance.complete, true);
  assert.deepEqual(repaired.assemblyClearance.issues, []);
  assert.deepEqual(rt.tests, emitted);
  assert.equal(rt.tests[0].testId, 'spin#1');
  assert.equal(rt.tests[1].testId, 'spin#2');
  assert.deepEqual(rt.pendingChecks(), []);
  assert.ok((await cached).issues.length > 0, 'the earlier recorded collision report remains intact');
});

test('an incomplete clearance diagnostic cannot disguise a native failure or fabricate a trace', async () => {
  const { rt, emitted } = await fixture();
  await callOk(rt, 'define_test', { test: { ...spin, id: 'missing_joint', measure: { joints: ['absent_joint'] } } });
  const response = await callOk(rt, 'run_test', { test_id: 'missing_joint' }) as unknown as Reply;
  assert.equal(response.passed, false);
  assert.ok(response.failureReasons.length > 0);
  assert.equal(response.assemblyClearance.diagnosticOnly, true);
  assert.equal(response.assemblyClearance.complete, false);
  assert.match(response.assemblyClearance.failureReason!, /recorded simulation poses/);
  assert.equal(rt.tests[0].trace.frames.length, 0);
  assert.deepEqual(rt.tests, emitted);
  assert.deepEqual(response.failureReasons, emitted[0].failureReasons);
});

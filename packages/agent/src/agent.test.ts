import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, type AgentEvent } from './index.ts';
import { ToolRuntime, baseSpec } from './index.ts';

test('deterministic planner builds a walker from generic ops, tests and revises honestly', async () => {
  const events: AgentEvent[] = []; let n = 0;
  const out = await runAgent({ prompt: 'Design a small walking robot inspired by my Muse character, test its walking, then make it dance.', inventionId: 'inv_test', model: null, newVersionId: () => `v${++n}` }, (e) => events.push(e));
  assert.equal(out.status, 'passed', out.summary);
  assert.ok(out.versions.length >= 1);
  assert.ok(out.spec.plan, 'plan written');
  const allTests = out.versions.flatMap((v) => v.tests);
  assert.ok(allTests.some((t) => t.kind === 'walk' && t.passed));
  assert.ok(allTests.some((t) => t.kind === 'motion'), 'dance follow-up tested');
  for (const v of out.versions.slice(1)) assert.ok(v.decisions[0].basedOn, `iteration ${v.iteration} cites a measurement`);
  console.log(out.versions.map((v) => `${v.id} it${v.iteration} ${v.status} ${v.tests.map((t) => `${t.testId}:${t.passed ? 'P' : 'F'}`).join(' ')} | ${v.decisions[0].summary.slice(0, 80)}`).join('\n'));
});

test('tool runtime: a Ferris wheel from generic ops passes a motion test with clearance', async () => {
  const logs: string[] = [];
  const rt = new ToolRuntime(baseSpec('Miniature Ferris wheel'), { onLog: (e) => logs.push(`${e.ok ? 'ok' : 'ERR'} ${e.tool}: ${e.summary}`), onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const r1 = await rt.call('assemble', { rationale: 'tower + wheel + gondolas', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    { op: 'mount', id: 'cab', part: 'gondola-40', onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'revolute' },
    { op: 'pattern', instances: ['cab'], kind: 'polar', axis: 'z', center: [0, 0.3, 0], count: 8 },
  ] }) as { error?: string; assembly?: { instances: unknown[] } };
  assert.ok(!r1.error, r1.error);
  await rt.call('set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 1, profile: { kind: 'constant', value: 1.5 } }] });
  await rt.call('define_test', { test: { kind: 'motion', id: 'spin', duration_s: 6, measure: { joints: ['spin'], base: 'tower', clearancePairs: [['cab', 'tower'], ['cab_1', 'tower'], ['cab_4', 'tower']], noGroundContact: ['cab', 'cab_1', 'cab_2', 'cab_3', 'cab_4', 'cab_5', 'cab_6', 'cab_7'] }, criteria: { minRevolutions: 1, torqueWithinRating: true } } });
  const r = await rt.call('run_test', { test_id: 'spin' }) as { passed: boolean; metrics: Record<string, number>; failureReasons: string[] };
  console.log('ferris', r.passed, JSON.stringify(r.metrics).slice(0, 200), r.failureReasons);
  assert.ok(r.metrics['spin.revolutions'] >= 1, 'wheel turned');
  assert.equal(r.metrics.groundContactViolation, 0);
});

test('tool runtime: design_part + wings with sine drives report stroke amplitude', async () => {
  const rt = new ToolRuntime(baseSpec('Mechanical butterfly'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const body = await rt.call('design_part', { name: 'Butterfly thorax', category: 'frames', material: 'PLA', pieces: [{ shape: { kind: 'capsule', radius: 0.012, height: 0.06, axis: 'x' }, offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, color: '#333333', role: 'structure', collide: true }], connectors: [{ id: 'wing_l', position: [0, 0.01, 0.012], axis: [0, 0, 1], kind: 'revolute' }, { id: 'wing_r', position: [0, 0.01, -0.012], axis: [0, 0, -1], kind: 'revolute' }, { id: 'base', position: [0, -0.012, 0], axis: [0, -1, 0], kind: 'fixed' }] }) as { error?: string; part?: { id: string } };
  assert.ok(!body.error, body.error);
  const r1 = await rt.call('assemble', { rationale: 'stand + thorax + wings', ops: [
    { op: 'place', id: 'stand', part: 'plate-80x50', position: [0, 0.002, 0], anchored: true },
    { op: 'mount', id: 'post', part: 'beam-50', onto: 'stand', connector: 'top', via: 'end_a', joint: 'fixed' },
    { op: 'mount', id: 'thorax', part: body.part!.id, onto: 'post', connector: 'end_b', via: 'base', joint: 'fixed' },
    { op: 'mount', id: 'wing_l', part: 'wing-butterfly-120', onto: 'thorax', connector: 'wing_l', via: 'root', joint: 'revolute', spin_deg: 0, motor: { controlId: 'flap_l', stiffness: 0.05, damping: 0.002 } },
    { op: 'mount', id: 'wing_r', part: 'wing-butterfly-120', onto: 'thorax', connector: 'wing_r', via: 'root', joint: 'revolute', spin_deg: 0, motor: { controlId: 'flap_r', stiffness: 0.05, damping: 0.002 } },
  ] }) as { error?: string };
  assert.ok(!r1.error, r1.error);
  await rt.call('set_drives', { drives: [{ controlId: 'flap_l', mode: 'position', rampIn_s: 0.3, profile: { kind: 'sine', amplitude: 0.6, offset: 0, frequency_hz: 2, phase: 0 } }, { controlId: 'flap_r', mode: 'position', rampIn_s: 0.3, profile: { kind: 'sine', amplitude: 0.6, offset: 0, frequency_hz: 2, phase: 0 } }] });
  await rt.call('define_test', { test: { kind: 'motion', id: 'flap', duration_s: 3, measure: { joints: ['flap_l', 'flap_r'], base: 'stand', clearancePairs: [['wing_l', 'wing_r']], noGroundContact: ['wing_l', 'wing_r'] }, criteria: { minJointAmplitude_rad: 0.8, torqueWithinRating: false } } });
  const r = await rt.call('run_test', { test_id: 'flap' }) as { passed: boolean; metrics: Record<string, number>; failureReasons: string[] };
  console.log('butterfly', r.passed, JSON.stringify(r.metrics).slice(0, 220), r.failureReasons);
  assert.ok(r.metrics['flap_l.amplitude_rad'] >= 0.8, `amplitude ${r.metrics['flap_l.amplitude_rad']}`);
});

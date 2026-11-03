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
  assert.deepEqual(rt.pendingChecks(), []);
  await rt.call('define_test', { test: { kind: 'motion', id: 'unstable', duration_s: 1, measure: { joints: ['missing-motor'], clearancePairs: [['cab', 'missing-base']] }, criteria: { minRevolutions: 1 } } });
  const invalid = await rt.call('run_test', { test_id: 'unstable' }) as { passed: boolean; failureReasons: string[] };
  assert.equal(invalid.passed, false);
  assert.match(invalid.failureReasons.join(' '), /missing-motor.*missing-base/);
  assert.match((await rt.call('finalize_design', { summary: 'Everything passed', status: 'passed' }) as { error: string }).error, /unstable: latest test failed/);
});

test('tool runtime: design_part + wings with sine drives report stroke amplitude', async () => {
  const rt = new ToolRuntime(baseSpec('Mechanical butterfly'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const body = await rt.call('design_part', { name: 'Butterfly thorax', category: 'frames', material: 'PLA', pieces: [{ shape: { kind: 'capsule', radius: 0.012, height: 0.06, axis: 'x' }, offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, color: '#333333', role: 'structure', collide: true }], connectors: [{ id: 'wing_l', position: [0, 0.01, 0.012], axis: [-1, 0, 0], kind: 'revolute' }, { id: 'wing_r', position: [0, 0.01, -0.012], axis: [1, 0, 0], kind: 'revolute' }, { id: 'base', position: [0, -0.012, 0], axis: [0, -1, 0], kind: 'fixed' }] }) as { error?: string; part?: { id: string } };
  assert.ok(!body.error, body.error);
  const r1 = await rt.call('assemble', { rationale: 'stand + thorax + wings', ops: [
    { op: 'place', id: 'stand', part: 'plate-80x50', position: [0, 0.002, 0], anchored: true },
    { op: 'mount', id: 'post', part: 'beam-50', onto: 'stand', connector: 'top', via: 'end_a', joint: 'fixed' },
    { op: 'mount', id: 'thorax', part: body.part!.id, onto: 'post', connector: 'end_b', via: 'base', joint: 'fixed' },
    { op: 'mount', id: 'wing_l', part: 'wing-butterfly-120-left', onto: 'thorax', connector: 'wing_l', via: 'hinge', joint: 'revolute', spin_deg: 0, motor: { controlId: 'flap_l', stiffness: 0.05, damping: 0.002 } },
    { op: 'mount', id: 'wing_r', part: 'wing-butterfly-120', onto: 'thorax', connector: 'wing_r', via: 'hinge', joint: 'revolute', spin_deg: 0, motor: { controlId: 'flap_r', stiffness: 0.05, damping: 0.002 } },
  ] }) as { error?: string };
  assert.ok(!r1.error, r1.error);
  await rt.call('set_drives', { drives: [{ controlId: 'flap_l', mode: 'position', rampIn_s: 0.3, profile: { kind: 'sine', amplitude: 0.6, offset: 0, frequency_hz: 2, phase: 0 } }, { controlId: 'flap_r', mode: 'position', rampIn_s: 0.3, profile: { kind: 'sine', amplitude: 0.6, offset: 0, frequency_hz: 2, phase: 0 } }] });
  await rt.call('define_test', { test: { kind: 'motion', id: 'flap', duration_s: 3, measure: { joints: ['flap_l', 'flap_r'], base: 'stand', clearancePairs: [['wing_l', 'wing_r']], noGroundContact: ['wing_l', 'wing_r'] }, criteria: { minJointAmplitude_rad: 0.8, torqueWithinRating: false } } });
  const r = await rt.call('run_test', { test_id: 'flap' }) as { passed: boolean; metrics: Record<string, number>; failureReasons: string[] };
  console.log('butterfly', r.passed, JSON.stringify(r.metrics).slice(0, 220), r.failureReasons);
  assert.ok(r.metrics['flap_l.amplitude_rad'] >= 0.8, `amplitude ${r.metrics['flap_l.amplitude_rad']}`);
});

test('set_drives infers a missing profile kind from the fields present', async () => {
  const rt = new ToolRuntime(baseSpec('Ferris wheel'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'wheel', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] });
  const r = await rt.call('set_drives', { drives: [{ controlId: 'spin', mode: 'position', profile: { amplitude: 0.5, frequency_hz: 1, phase: 0, role: 'swing', swingDuty: 0.3 } }] }) as { error?: string };
  assert.ok(!r.error, r.error);
  assert.equal(rt.assembly.controller.drives[0].profile.kind, 'gait');
  const r2 = await rt.call('set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', value: 2 }] }) as { error?: string };
  assert.ok(!r2.error, r2.error);
  assert.equal(rt.assembly.controller.drives[0].profile.kind, 'constant');
});

test('assemble infers a missing "op" from the fields present', async () => {
  const rt = new ToolRuntime(baseSpec('Windmill'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const r = await rt.call('assemble', { rationale: 'tower + rotor', ops: [
    { id: 'tower', part: 'tower-500', position: [0, 0, 0], anchored: true },
    { id: 'rotor', part: 'windmill-4x600', onto: 'tower', connector: 'axle', via: 'shaft', joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] }) as { error?: string };
  assert.ok(!r.error, r.error);
  assert.equal(rt.assembly.instances.length, 2);
  assert.equal(rt.assembly.joints[0].type, 'revolute');
});

test('define_test rejects a walk tilt limit tighter than the measured recipes', async () => {
  const rt = new ToolRuntime(baseSpec('Mechanical crab'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const tight = await rt.call('define_test', { test: { kind: 'walk', id: 'scuttle', duration_s: 6, base: 'body', minDistance_m: 0.3, maxTilt_deg: 6, direction: 'z' } }) as { error?: string };
  assert.match(tight.error ?? '', /maxTilt_deg 6/);
  const ok = await rt.call('define_test', { test: { kind: 'walk', id: 'scuttle', duration_s: 6, base: 'body', minDistance_m: 0.3, maxTilt_deg: 10, direction: 'z' } }) as { error?: string };
  assert.ok(!ok.error, ok.error);
});

test('define_test rejects dance criteria tighter than a legged machine measures', async () => {
  const rt = new ToolRuntime(baseSpec('Pet robot'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'body + one leg', ops: [
    { op: 'place', id: 'body', part: 'chassis-quad-160', position: [0, 0.1, 0] },
    ...['hip_L0', 'hip_L1', 'hip_R0', 'hip_R1'].flatMap((h) => [
      { op: 'mount', id: `servo_${h}`, part: 'servo-ds3218', onto: 'body', connector: h, via: 'bottom', joint: 'fixed' },
      { op: 'mount', id: `leg_${h}`, part: 'leg-bar-60', onto: `servo_${h}`, connector: 'horn', via: 'pivot', joint: 'revolute', motor: { controlId: h, stiffness: 8, damping: 0.2 } },
    ]),
  ] }) as { error?: string };
  const tight = await rt.call('define_test', { test: { kind: 'motion', id: 'dance', duration_s: 4, measure: { joints: ['hip_L0'], base: 'body' }, criteria: { minJointAmplitude_rad: 0.08, maxBaseTilt_deg: 5, maxBaseDrift_m: 0.05, torqueWithinRating: true } } }) as { error?: string };
  assert.match(tight.error ?? '', /maxBaseTilt_deg 5/);
  const ok = await rt.call('define_test', { test: { kind: 'motion', id: 'dance', duration_s: 4, measure: { joints: ['hip_L0'], base: 'body' }, criteria: { minJointAmplitude_rad: 0.08, maxBaseTilt_deg: 12, maxBaseDrift_m: 0.15, torqueWithinRating: true } } }) as { error?: string };
  assert.ok(!ok.error, ok.error);
});

test('a batched reply stops at the first failed tool call; later calls are reported as skipped', async () => {
  const { createServer } = await import('node:http');
  const bodies: Array<{ messages: Array<{ role: string; content: string; tool_call_id?: string }> }> = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw); bodies.push(body);
      const reply = bodies.length === 1
        ? [{ id: 'a1', type: 'function', function: { name: 'assemble', arguments: JSON.stringify({ rationale: 'bad part id', ops: [{ op: 'place', id: 'body', part: 'no-such-part', position: [0, 0.1, 0] }] }) } },
           { id: 'd1', type: 'function', function: { name: 'set_drives', arguments: JSON.stringify({ drives: [{ controlId: 'spin', mode: 'velocity', profile: { kind: 'constant', value: 1 } }] }) } }]
        : [{ id: 'f1', type: 'function', function: { name: 'finalize_design', arguments: JSON.stringify({ summary: 'stopping', status: 'failed' }) } }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: reply }, finish_reason: 'tool_calls' }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const model = { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 256, timeoutMs: 5000 };
    await runAgent({ prompt: 'test', inventionId: 'inv_t', model, specialist: null, maxIterations: 1, newVersionId: () => 'ver_t' }, () => {});
    const second = bodies[1]; assert.ok(second, 'the model was asked again after the batch');
    const toolMsgs = second.messages.filter((m) => m.role === 'tool');
    const assembleMsg = toolMsgs.find((m) => m.tool_call_id === 'a1'); const drivesMsg = toolMsgs.find((m) => m.tool_call_id === 'd1');
    assert.match(assembleMsg?.content ?? '', /error/, 'the bad assemble reports its error');
    assert.match(drivesMsg?.content ?? '', /"skipped":true/, 'the call after the failure is skipped, not run');
    assert.match(drivesMsg?.content ?? '', /assemble failed earlier in this reply/);
  } finally { server.close(); }
});

test('define_test rejects minRevolutions on a swinging joint, and the dance floor ignores a single leg-bar pendulum', async () => {
  const rt = new ToolRuntime(baseSpec('Garden gadget'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'pole with a pendulum arm', ops: [
    { op: 'place', id: 'pole', part: 'tower-500', position: [0, 0.25, 0], anchored: true },
    { op: 'mount', id: 'arm', part: 'leg-bar-100', onto: 'pole', connector: 'axle', via: 'pivot', joint: 'revolute', motor: { controlId: 'swing', stiffness: 2, damping: 0.1 } },
  ] });
  await rt.call('set_drives', { drives: [{ controlId: 'swing', mode: 'position', profile: { kind: 'sine', amplitude: 0.5, frequency_hz: 1 } }] });
  const bad = await rt.call('define_test', { test: { kind: 'motion', id: 't1', duration_s: 4, measure: { joints: ['swing'], base: 'pole' }, criteria: { minRevolutions: 2, torqueWithinRating: true } } }) as { error?: string };
  assert.match(bad.error ?? '', /minRevolutions cannot be met by swing/);
  const ok = await rt.call('define_test', { test: { kind: 'motion', id: 't2', duration_s: 4, measure: { joints: ['swing'], base: 'pole' }, criteria: { minJointAmplitude_rad: 0.3, maxBaseTilt_deg: 5, torqueWithinRating: true } } }) as { error?: string };
  assert.ok(!ok.error, `one leg-bar pendulum is not a legged machine: ${ok.error}`);
});

test('define_test accepts its test object sent as a JSON string', async () => {
  const rt = new ToolRuntime(baseSpec('Windmill'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'tower + rotor', ops: [
    { op: 'place', id: 'tower', part: 'tower-500', position: [0, 0.25, 0], anchored: true },
    { op: 'mount', id: 'rotor', part: 'windmill-4x600', onto: 'tower', connector: 'axle', via: 'shaft', joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] });
  assert.equal(rt.assembly.instances.length, 2, 'tower and rotor assembled');
  const r = await rt.call('define_test', { test: JSON.stringify({ kind: 'motion', id: 'spin_test', duration_s: 6, measure: { joints: ['spin'], base: 'tower' }, criteria: { minRevolutions: 1, torqueWithinRating: true } }) }) as { error?: string };
  assert.ok(!r.error, r.error);
});

test('assemble treats an op that names only an instance, or says delete, as remove', async () => {
  const rt = new ToolRuntime(baseSpec('Windmill'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'tower + rotor', ops: [
    { op: 'place', id: 'tower', part: 'tower-500', position: [0, 0.25, 0], anchored: true },
    { op: 'mount', id: 'rotor', part: 'windmill-4x600', onto: 'tower', connector: 'axle', via: 'shaft', joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] });
  const r1 = await rt.call('assemble', { rationale: 'take the rotor off', ops: [{ id: 'rotor' }] }) as { error?: string };
  assert.ok(!r1.error, r1.error); assert.ok(!rt.assembly.instances.some((i) => i.id === 'rotor'), 'rotor removed');
  const r2 = await rt.call('assemble', { rationale: 'and the tower', ops: [{ op: 'delete', id: 'tower' }] }) as { error?: string };
  assert.ok(!r2.error, r2.error); assert.equal(rt.assembly.instances.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenevaIndexer, genevaIndexerTest } from '@protolab/simulator/geneva-indexer';
import { createServer } from 'node:http';
import { applyOps, emptyAssembly, generatePart, getPart, setDrives } from '@protolab/parts';
import { VersionRecord, type GeometryPiece, type ToolLogEntry } from '@protolab/schema';
import { runAgent, type AgentEvent } from './index.ts';
import { ToolRuntime, baseSpec } from './index.ts';

test('part events distinguish planned catalog candidates from what the build actually adds', async () => {
  const logs: ToolLogEntry[] = [];
  const rt = new ToolRuntime(baseSpec('Ferris wheel'), { onLog: (event) => logs.push(event), onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('write_plan', { purpose: 'Build a Ferris wheel', features: ['wheel'], motions: ['turn'], subassemblies: ['base'], successCriteria: ['rotate'], unverified: [], candidate_part_ids: ['tower-300', 'tower-300', 'unknown-part'] });
  assert.deepEqual(logs[0].parts?.map((part) => part.id), ['tower-300']);
  await rt.call('assemble', { rationale: 'Use a taller support', ops: [{ op: 'place', id: 'tower', part: 'tower-500', position: [0, 0, 0], anchored: true }] });
  assert.deepEqual(logs[1].parts?.map((part) => part.id), ['tower-500']);
  await rt.call('assemble', { rationale: 'Move the support', ops: [{ op: 'move', id: 'tower', translate: [0, 0.01, 0] }] });
  assert.equal(logs[2].ok, true);
  assert.equal(logs[2].parts, undefined);
});

test('inspect_assembly reports selected connectors in the assembled world pose', async () => {
  const rt = new ToolRuntime(baseSpec('Radial linkage'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  await rt.call('assemble', { rationale: 'Place two links', ops: [
    { op: 'place', id: 'link', part: 'beam-50', position: [0.1, 0.2, 0.3], rotation_deg: [0, 0, 90] },
    { op: 'place', id: 'base', part: 'beam-50', position: [0, 0.1, 0] },
  ] });

  const basic = await rt.call('inspect_assembly', {}) as object;
  assert.ok(!('connectorPoses' in basic));
  const selected = await rt.call('inspect_assembly', { instance_ids: ['link', 'link'] }) as {
    connectorPoses: { instance: string; connectors: { id: string; position_m: number[]; axis_world: number[] }[] }[];
  };
  assert.deepEqual(selected.connectorPoses.map(({ instance }) => instance), ['link']);
  const end = selected.connectorPoses[0].connectors.find(({ id }) => id === 'end_b');
  assert.deepEqual(end?.position_m, [0.1, 0.225, 0.3]);
  assert.deepEqual(end?.axis_world.map((axis) => axis || 0), [0, 1, 0]);
  const missing = await rt.call('inspect_assembly', { instance_ids: ['missing'] }) as { error: string };
  assert.match(missing.error, /Unknown instance id "missing"/);
});

test('assemble returns selected world connector poses after the edit in one atomic call', async () => {
  let assemblyEvents = 0;
  const rt = new ToolRuntime(baseSpec('Chute alignment'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => { assemblyEvents++; }, onTest: () => {},
  });
  const placed = await rt.call('assemble', {
    ops: [{ op: 'place', id: 'chute', part: 'gravity-chute-160x54', position: [0.1, 0.2, 0.3], rotation_deg: [0, 0, 90] }],
    rationale: 'Align the outlet to the next chute',
    inspect_instance_ids: ['chute', 'chute'],
  }) as { connectorPoses: { instance: string; connectors: { id: string; position_m: number[]; axis_world: number[] }[] }[] };
  assert.deepEqual(placed.connectorPoses.map(({ instance }) => instance), ['chute']);
  const exit = placed.connectorPoses[0].connectors.find(({ id }) => id === 'exit');
  assert.deepEqual(exit?.position_m, [0.098, 0.28, 0.3]);
  assert.deepEqual(exit?.axis_world, [0, 1, 0]);

  const before = rt.assembly;
  const rejected = await rt.call('assemble', {
    ops: [{ op: 'move', id: 'chute', translate: [0, 0.05, 0] }],
    rationale: 'Raise the chute',
    inspect_instance_ids: ['missing'],
  }) as { error: string };
  assert.equal(rejected.error, 'Unknown instance id "missing"');
  assert.equal(rt.assembly, before);
  assert.equal(assemblyEvents, 1);
});

test('get_part reports exact saved and custom collider geometry and names missing IDs', async () => {
  const savedBeam = generatePart('beam', { length: 0.071 }, 'beam-50');
  const custom = generatePart('beam', { length: 0.083 }, 'custom-beam-7');
  const piece: GeometryPiece = {
    shape: { kind: 'extrude', profile: [[0, 0], [0.01, 0], [0, 0.01]], depth: 0.005, axis: 'z' },
    offset: { position: [0.02, 0.01, 0], rotation: [0, 0.6, 0, 0.8] },
    role: 'decor', collide: false, friction: 0.4, color: '#112233', material: 'rubber',
  };
  custom.geometry.push(piece);
  const savedAssembly = { ...emptyAssembly(), parts: [savedBeam, custom] };
  const rt = new ToolRuntime(baseSpec('Inspect saved chute'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {},
  }, undefined, savedAssembly);

  type InspectedPart = { id: string; geometry: {
    shape: string; shapeSpec: GeometryPiece['shape']; offset: number[]; rotation: number[];
    collide: boolean; friction?: number; color?: string; material?: string; pieceIndex?: number;
  }[] };
  const single = await rt.call('get_part', { part_id: custom.id }) as { part: InspectedPart };
  const returned = single.part.geometry[1];
  assert.equal(returned.shape, 'extrude');
  assert.deepEqual(returned.shapeSpec, piece.shape);
  assert.deepEqual(returned.offset, piece.offset.position);
  assert.deepEqual(returned.rotation, piece.offset.rotation);
  assert.equal(returned.collide, false);
  assert.equal(returned.friction, 0.4);
  assert.equal(returned.color, '#112233');
  assert.equal(returned.material, 'rubber');

  const selection = await rt.call('get_part', { part_id: custom.id, piece_indices: [1] }) as { part: InspectedPart };
  assert.deepEqual(selection.part.geometry, [{ ...returned, pieceIndex: 1 }]);
  const badSelection = await rt.call('get_part', { part_id: custom.id, piece_indices: [2] }) as { error: string };
  assert.match(badSelection.error, /Unknown geometry piece 2/);

  const batch = await rt.call('get_part', { part_ids: [savedBeam.id, 'missing', custom.id, savedBeam.id] }) as {
    parts: InspectedPart[]; missing_part_ids: string[];
  };
  assert.deepEqual(batch.parts.map(({ id }) => id), [savedBeam.id, custom.id]);
  assert.deepEqual(batch.parts[0].geometry[0].shapeSpec, savedBeam.geometry[0].shape);
  assert.notDeepEqual(batch.parts[0].geometry[0].shapeSpec, getPart(savedBeam.id)?.geometry[0].shape);
  assert.deepEqual(batch.parts[1], single.part);
  assert.deepEqual(batch.missing_part_ids, ['missing']);
  const missing = await rt.call('get_part', { part_id: 'missing' }) as { error: string };
  assert.equal(missing.error, 'Unknown part id "missing"');
});

test('a live follow-up edits the saved assembly, reuses authored parts and records fresh evidence', async () => {
  const custom = generatePart('wheel', { radius: 0.04 }, 'custom-wheel-7');
  const base = applyOps(emptyAssembly(), [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'rotor', part: custom.id, onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ], (id) => id === custom.id ? custom : getPart(id)).assembly;
  const assembly = setDrives(base, [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0, profile: { kind: 'constant', value: 1 } }]);
  const parent = VersionRecord.parse({ id: 'saved-v4', inventionId: 'old-invention', parentVersionId: 'saved-v3', iteration: 4, prompt: 'Small rotor', spec: baseSpec('Small rotor'), assembly, tests: [], decisions: [], toolLog: [], modelId: 'muse-spark-1.3', status: 'passed', createdAt: '2026-01-01T00:00:00Z' });
  const priorAssembly = structuredClone(parent.assembly);
  const calls: [string, object][] = [
    ['inspect_assembly', { instance_ids: ['rotor'] }],
    ['get_part', { part_id: 'custom-wheel-7' }],
    ['define_test', { test: { kind: 'motion', id: 'spin_check', duration_s: 1, measure: { joints: ['spin'] }, criteria: { minJointRate_rad_s: 0.5, torqueWithinRating: false } } }],
    ['run_test', { test_id: 'spin_check' }],
    ['create_part', { kind: 'wheel', params: { radius: 0.03 } }],
    ['assemble', { ops: [{ op: 'move', id: 'tower', translate: [0, 0.01, 0] }], rationale: 'Raise the saved support by 10 mm' }],
    ['run_test', { test_id: 'spin_check' }],
    ['finalize_design', { status: 'passed', summary: 'The saved rotor still spins after raising the support.' }],
  ];
  let system = '';
  let geometryReply = '';
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString());
    system = messages[0].content;
    const geometry = messages.find((message: { tool_call_id?: string }) => message.tool_call_id === 'inspect-geometry');
    const round: [string, object][] = geometry ? calls : [
      ['get_part', { part_ids: [custom.id, 'catch-cup-80x35', 'gravity-chute-160x54', 'geneva-wheel-4x60'] }],
    ];
    if (geometry) geometryReply = geometry.content;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: round.map(([name, args], index) => ({ id: geometry ? `call-${index}` : 'inspect-geometry', type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    let n = 0;
    const events: AgentEvent[] = [];
    const result = await runAgent({
      prompt: parent.prompt, inventionId: 'new-invention', parent, changeRequest: 'Raise the support by 10 mm',
      startIteration: 4, newVersionId: () => `new-v${++n}`,
      model: { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 64, timeoutMs: 5000 },
      specialist: null,
    }, (event) => events.push(event));
    assert.match(system, /exact copy of saved assembly v4/);
    assert.deepEqual(events.filter((event) => event.type === 'tool' && !event.entry.ok), []);
    assert.equal(result.status, 'passed');
    assert.ok(geometryReply.length > 5000, 'batch geometry reaches the model past the generic reply limit');
    const details = JSON.parse(geometryReply);
    assert.deepEqual(details.parts.map(({ id }: { id: string }) => id), [
      custom.id, 'catch-cup-80x35', 'gravity-chute-160x54', 'geneva-wheel-4x60',
    ]);
    const wheel = getPart('geneva-wheel-4x60')!;
    assert.deepEqual(details.parts[3].geometry.at(-1).shapeSpec, wheel.geometry.at(-1)!.shape);
    assert.equal(result.versions.length, 2);
    const [retest, edited] = result.versions;
    assert.equal(retest.parentVersionId, parent.id);
    assert.equal(edited.parentVersionId, retest.id);
    assert.deepEqual([retest.iteration, edited.iteration], [5, 6]);
    assert.deepEqual(retest.assembly, priorAssembly);
    assert.deepEqual(edited.assembly.controller, priorAssembly.controller);
    assert.deepEqual(edited.assembly.parts, priorAssembly.parts);
    assert.deepEqual(edited.assembly.instances[0].transform.position, [0, 0.01, 0]);
    assert.deepEqual(parent.assembly, priorAssembly);
    assert.equal(edited.toolLog.find((entry) => entry.tool === 'create_part')?.parts?.[0].id, 'custom-wheel-8');
  } finally {
    server.close();
  }
});

test('a failed setup call skips dependent calls in its reply and a corrected batch still runs', async () => {
  type Call = [name: string, args: object];
  const drive = (value: number): Call => ['set_drives', {
    drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0, profile: { kind: 'constant', value } }],
  }];
  const define: Call = ['define_test', { test: {
    kind: 'motion', id: 'spin_check', duration_s: 1, measure: { joints: ['spin'] },
    criteria: { minJointRate_rad_s: 0.2, torqueWithinRating: false },
  } }];
  const run: Call = ['run_test', { test_id: 'spin_check' }];
  const finalize: Call = ['finalize_design', { status: 'passed', summary: 'The wheel spun.' }];
  const rounds: Call[][] = [
    [['assemble', { rationale: 'Place the original wheel', ops: [
      { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
      { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub',
        joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    ] }], drive(1), define],
    [['assemble', { rationale: 'Raise a missing support', ops: [
      { op: 'move', id: 'missing', translate: [0, 0.01, 0] },
    ] }], ['inspect_assembly', {}], drive(3), define, run, finalize],
    [['assemble', { rationale: 'Raise the correct support', ops: [
      { op: 'move', id: 'tower', translate: [0, 0.01, 0] },
    ] }], drive(2), define, run, finalize],
  ];
  let hits = 0;
  let failedReplies: { tool_call_id: string; content: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString());
    const round = hits++;
    if (round === 2) {
      failedReplies = messages.filter((message: { tool_call_id?: string }) => message.tool_call_id?.startsWith('1-'));
    }
    if (!rounds[round]) {
      res.writeHead(400);
      res.end('Unexpected extra model round');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: rounds[round].map(([name, args], index) => ({
        id: `${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
      })),
    } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const events: AgentEvent[] = [];
    let count = 0;
    const result = await runAgent({
      prompt: 'Raise a spinning wheel', inventionId: 'batch-guard',
      newVersionId: () => `batch-version-${++count}`,
      model: { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 64, timeoutMs: 5000 },
      specialist: null,
    }, (event) => events.push(event));

    assert.equal(hits, 3);
    assert.deepEqual(failedReplies.map(({ tool_call_id }) => tool_call_id), ['1-0', '1-1', '1-2', '1-3', '1-4', '1-5']);
    const [failed, inspection, ...skips] = failedReplies.map(({ content }) => JSON.parse(content));
    assert.match(failed.error, /missing/);
    assert.deepEqual(inspection.instances[0].position_m, [0, 0, 0]);
    assert.deepEqual(inspection.drives[0].profile, { kind: 'constant', value: 1 });
    for (const [index, name] of ['set_drives', 'define_test', 'run_test', 'finalize_design'].entries()) {
      assert.match(skips[index].error, new RegExp(`Skipped ${name} because assemble failed`));
    }
    assert.equal(events.filter(({ type }) => type === 'test_start').length, 1);
    assert.equal(result.status, 'passed');
    assert.equal(result.versions.length, 1);
    assert.equal(result.versions[0].tests.length, 1);
    assert.deepEqual(result.versions[0].assembly.instances[0].transform.position, [0, 0.01, 0]);
    assert.deepEqual(result.versions[0].assembly.controller.drives[0].profile, { kind: 'constant', value: 2 });
  } finally {
    server.close();
  }
});

test('deterministic planner builds a walker from generic ops, tests and revises honestly', async () => {
  const events: AgentEvent[] = []; let n = 0;
  const out = await runAgent({ prompt: 'Design a small walking robot inspired by my Muse character, test its walking, then make it dance.', inventionId: 'inv_test', model: null, newVersionId: () => `v${++n}` }, (e) => events.push(e));
  assert.equal(out.status, 'passed', out.summary);
  assert.ok(out.versions.length >= 1);
  assert.ok(out.spec.plan, 'plan written');
  const allTests = out.versions.flatMap((v) => v.tests);
  assert.ok(allTests.some((t) => t.kind === 'walk' && t.passed));
  assert.ok(allTests.some((t) => t.kind === 'motion'), 'dance follow-up tested');
  const starts = events.flatMap((event) => event.type === 'test_start' ? [event] : []);
  const results = events.flatMap((event) => event.type === 'test' ? [event] : []);
  assert.deepEqual(starts.map((event) => [event.iteration, event.testId, event.kind]), results.map((event) => [event.iteration, event.result.testId, event.result.kind]));
  for (const [i, start] of starts.entries()) assert.ok(events.indexOf(start) < events.indexOf(results[i]), 'test starts before the result');
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

test('drive updates respect the current plan mass limit and reject invalid changes atomically', async () => {
  const rt = new ToolRuntime(baseSpec('Large flywheel machine'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const plan = { purpose: 'Turn a large machine', features: ['frame', 'flywheel'], motions: ['rotation'], subassemblies: ['drivetrain'], successCriteria: ['turns'], unverified: [] };
  await rt.call('write_plan', { ...plan, maxMass_kg: 8 });
  const designed = await rt.call('design_part', {
    name: 'Heavy foundation', category: 'frames', mass_kg: 5.1,
    pieces: [{ shape: { kind: 'box', size: [.1, .1, .1] }, offset: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, color: '#444444', role: 'structure', collide: true }],
  }) as { part: { id: string } };
  const built = await rt.call('assemble', { rationale: 'Build within the larger plan limit', ops: [
    { op: 'place', id: 'foundation', part: designed.part.id, position: [.3, .05, 0], anchored: true },
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', motor: { controlId: 'spin', stiffness: .5, damping: .2 } },
  ] }) as { error?: string };
  assert.ok(!built.error, built.error);
  const drives = [{ controlId: 'spin', mode: 'velocity' as const, rampIn_s: 1, profile: { kind: 'constant' as const, value: 1.5 } }];
  assert.throws(() => setDrives(rt.assembly, drives), /exceeds 5 kg/);
  const updated = await rt.call('set_drives', { drives }) as { error?: string };
  assert.ok(!updated.error, updated.error);
  assert.deepEqual(rt.assembly.controller.drives, drives);

  await rt.call('write_plan', { ...plan, maxMass_kg: 5 });
  const before = structuredClone(rt.assembly);
  const rejected = await rt.call('set_drives', { drives: [{ ...drives[0], profile: { kind: 'constant', value: 2 } }] }) as { error?: string };
  assert.match(rejected.error ?? '', /exceeds 5 kg/);
  assert.deepEqual(rt.assembly, before);
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

test('a cardinal-vector polar pattern retains twelve independent petal drives', async () => {
  const rt = new ToolRuntime(baseSpec('Twelve-petal pavilion'), { onLog() {}, onPlan() {}, onAssembly() {}, onTest() {} });
  const setup = await rt.call('assemble', { rationale: 'One supported petal hinge', ops: [
    { op: 'place', id: 'servo', part: 'servo-mg996r', position: [.14, .25, 0], anchored: true },
    { op: 'mount', id: 'spar', part: 'leg-bar-100', onto: 'servo', connector: 'horn', via: 'pivot', joint: 'revolute', motor: { controlId: 'petal', stiffness: 5, damping: .2 } },
  ] }) as { error?: string };
  assert.ok(!setup.error, setup.error);
  await rt.call('set_drives', { drives: [{ controlId: 'petal', mode: 'position', profile: { kind: 'sine', amplitude: .48, frequency_hz: .2 } }] });
  const result = await rt.call('assemble', { rationale: 'Repeat around the upright axis', ops: [
    { op: 'pattern', kind: 'polar', axis: [0, 1, 0], center: [0, .25, 0], count: 12, instances: ['servo', 'spar'] },
  ] }) as { error?: string };
  assert.ok(!result.error, result.error);
  assert.equal(rt.assembly.instances.length, 24);
  assert.equal(rt.assembly.joints.length, 12);
  assert.equal(new Set(rt.assembly.controller.drives.map((drive) => drive.controlId)).size, 12);
  const opposite = rt.assembly.instances.find((instance) => instance.id === 'servo_6')!;
  assert.ok(Math.abs(opposite.transform.position[0] + .14) < 1e-9);
  assert.ok(Math.abs(opposite.transform.position[1] - .25) < 1e-9);
  const before = structuredClone(rt.assembly);
  for (const axis of [[0, -1, 0], [1, 1, 0]]) {
    const rejected = await rt.call('assemble', { rationale: 'Unsupported axis must not be guessed', ops: [
      { op: 'pattern', kind: 'polar', axis, count: 3, instances: ['servo', 'spar'] },
    ] }) as { error?: string };
    assert.match(rejected.error ?? '', /axis/);
    assert.deepEqual(rt.assembly, before);
  }
});

test('define_test rejects a walk tilt limit tighter than the measured recipes', async () => {
  const rt = new ToolRuntime(baseSpec('Mechanical crab'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const tight = await rt.call('define_test', { test: { kind: 'walk', id: 'scuttle', duration_s: 6, base: 'body', minDistance_m: 0.3, maxTilt_deg: 6, direction: 'z' } }) as { error?: string };
  assert.match(tight.error ?? '', /maxTilt_deg 6/);
  const ok = await rt.call('define_test', { test: { kind: 'walk', id: 'scuttle', duration_s: 6, base: 'body', minDistance_m: 0.3, maxTilt_deg: 10, direction: 'z' } }) as { error?: string };
  assert.ok(!ok.error, ok.error);
});

test('a recorded cam test keeps its follower timing targets across revisions', async () => {
  const rt = new ToolRuntime(baseSpec('Two-follower camshaft'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const built = await rt.call('assemble', {
    rationale: 'One motor turns two opposite cams under passive guided followers',
    ops: [
      { op: 'place', id: 'motor', part: 'gearmotor-37', position: [0, 0.085, -0.057], rotation_deg: [0, -90, 0], anchored: true },
      { op: 'mount', id: 'cam_a', part: 'eccentric-cam-74', onto: 'motor', connector: 'shaft', via: 'drive', joint: 'revolute', motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
      { op: 'mount', id: 'cam_b', part: 'eccentric-cam-74', onto: 'cam_a', connector: 'shaft_front', via: 'shaft', joint: 'fixed', spin_deg: 180, offset_m: 0.03 },
      ...([['a', 0], ['b', 0.044]] as const).flatMap(([side, z]) => [
        { op: 'place', id: `guide_${side}`, part: 'follower-guide-9', position: [0, 0.1605, z], anchored: true },
        { op: 'place', id: `follower_${side}`, part: 'cam-follower-98', position: [0, 0.127, z], free: true },
        { op: 'connect', a: `guide_${side}`, a_connector: 'guide', b: `follower_${side}`, b_connector: 'slide', joint: 'prismatic' },
      ]),
    ],
  }) as { error?: string };
  assert.ok(!built.error, built.error);
  const driven = await rt.call('set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.5, profile: { kind: 'constant', value: 3 } }] }) as { error?: string };
  assert.ok(!driven.error, driven.error);

  const followerTiming = { shaft: 'spin', followers: ['follower_a', 'follower_b'], axis: 'y', minCycles: 3, minStroke_m: 0.014, minLowDwell_s: 0.2, minPhaseGap_deg: 140 };
  const test = { kind: 'motion', id: 'cam_timing', duration_s: 10, measure: { joints: ['spin'], followerTiming }, criteria: { torqueWithinRating: true } };
  const defined = await rt.call('define_test', { test }) as { error?: string };
  assert.ok(!defined.error, defined.error);
  const result = await rt.call('run_test', { test_id: test.id }) as { passed: boolean; failureReasons: string[] };
  assert.equal(result.passed, true, result.failureReasons?.join('; '));
  const redefined = await rt.call('define_test', { test: { ...test, measure: { ...test.measure, followerTiming: { ...followerTiming, minPhaseGap_deg: 100 } } } }) as { error?: string };
  assert.match(redefined.error ?? '', /Keep the measured criteria for "cam_timing" fixed/);
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

test('a drive sweep runs the full indexed motion test and reports step counts without saving a result', async () => {
  const rt = new ToolRuntime(baseSpec('Four-stop carousel'), {
    onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {},
  }, undefined, buildGenevaIndexer());
  await rt.call('define_test', { test: genevaIndexerTest });
  const result = await rt.call('sweep_drive', {
    test_id: genevaIndexerTest.id, controlId: 'spin', field: 'value', values: [0, 1.6], duration_s: 4,
  }) as { results: { value: number; passed: number; indexedConsecutiveSteps: number }[] };
  assert.deepEqual(result.results.map(({ value, passed, indexedConsecutiveSteps }) => [value, passed, indexedConsecutiveSteps]),
    [[0, 0, 0], [1.6, 1, 2]]);
  assert.equal(rt.tests.length, 0);
  assert.equal(rt.testCount, 0);
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

test('define_test lifts walk/launch thresholds nested under criteria; place without a position stands a tower on the ground, anchored', async () => {
  const rt = new ToolRuntime(baseSpec('Catapult'), { onLog: () => {}, onPlan: () => {}, onAssembly: () => {}, onTest: () => {} });
  const r = await rt.call('assemble', { rationale: 'tower with no position', ops: [{ op: 'place', id: 'tower', part: 'tower-500' }] }) as { error?: string };
  assert.ok(!r.error, r.error);
  const tower = rt.assembly.instances.find((i) => i.id === 'tower')!;
  assert.ok(tower.anchored, 'tower anchored'); assert.ok(Math.abs(tower.transform.position[1] - 0.25) < 1e-6, `tower stands on the ground (${tower.transform.position[1]})`);
  await rt.call('assemble', { rationale: 'projectile', ops: [{ op: 'place', id: 'pizza', part: 'foam-pizza-80', position: [0.1, 0.6, 0], free: true }] });
  const t = await rt.call('define_test', { test: { kind: 'launch', id: 'throw', duration_s: 5, projectile: 'pizza', direction: 'x', criteria: { targetDistance_m: 0.5, tolerance_m: 0.2 } } }) as { error?: string };
  assert.ok(!t.error, t.error);
});

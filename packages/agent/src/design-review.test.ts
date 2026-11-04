import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Assembly, TestSpec, type TestResult } from '@protolab/schema';
import { getPart } from '@protolab/parts';
import { baseSpec } from './spec.ts';
import { reviewDesign, type DesignReviewInput } from './design-review.ts';
import type { ChatMessage, ModelConfig } from './llm.ts';
import { motionDiagnostics } from './motion-diagnostics.ts';

const approved = { passed: true, summary: 'Both rimmed wheels meet the requested rotation target.', issues: [] };
const usage = { prompt_tokens: 4321, completion_tokens: 180, completion_tokens_details: { reasoning_tokens: 90 } };
type Request = { messages: ChatMessage[]; tools: unknown[]; model: string; input?: unknown[]; previous_response_id?: string };

async function withModel(
  reply: { content?: string | null; status?: number; finishReason?: string; toolCalls?: unknown[]; responses?: boolean },
  run: (model: ModelConfig, requests: Request[]) => Promise<void>,
) {
  const requests: Request[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw) as Request);
    response.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.responses ? {
      id: 'local-review', status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply.content }] }],
      usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, output_tokens_details: usage.completion_tokens_details },
    } : {
      choices: [{ message: { content: reply.content, tool_calls: reply.toolCalls }, finish_reason: reply.finishReason ?? 'stop' }], usage,
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, model: 'muse-wonder-1.0', apiKey: 'local-test-only', maxTokens: 4096, timeoutMs: 2000,
      ...(reply.responses ? { transport: 'responses-encrypted' } : {}) }, requests);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function design(rim = true): DesignReviewInput {
  const wheel = structuredClone(getPart('spoked-wheel-400')!);
  wheel.id = 'custom-twin-rimmed-wheel'; wheel.kind = 'designed'; wheel.name = 'Complete rimmed Ferris wheel';
  if (!rim) wheel.geometry = wheel.geometry.filter(({ shape }) => shape.kind !== 'revolve');
  const tower = getPart('tower-300')!;
  const assembly = Assembly.parse({
    parts: [wheel, tower, getPart('gear-60t-m1')!],
    instances: ['left', 'right'].flatMap((side, index) => [
      { id: `${side}-tower`, partId: tower.id, label: 'Tower', transform: { position: [index * 0.5, 0, 0], rotation: [0, 0, 0, 1] }, anchored: true },
      { id: `${side}-wheel`, partId: wheel.id, label: wheel.name, transform: { position: [index * 0.5, 0.3, 0.03], rotation: [0, 0, 0, 1] } },
    ]),
    joints: ['left', 'right'].map((side, index) => ({ id: `${side}-axle`, type: 'revolute',
      a: { instanceId: `${side}-tower`, connectorId: 'axle' }, b: { instanceId: `${side}-wheel`, connectorId: 'hub' },
      axis: [0, 0, 1], anchor: [index * 0.5, 0.3, 0.03], motor: { controlId: `${side}-spin`, stiffness: 5, damping: 0.2 },
    })),
    controller: { drives: ['left', 'right'].map((side) => ({ controlId: `${side}-spin`, mode: 'velocity', profile: { kind: 'constant', value: 1 } })) },
  });
  const brief = 'Build two 400 mm spoked wheels with continuous outer rims on towers; each must turn at least 0.5 revolutions.';
  const spec = baseSpec(brief);
  spec.plan = { purpose: 'Twin wheels', features: ['Two continuous outer rims'], motions: ['Rotate each wheel'], subassemblies: ['Two tower-mounted wheels'], successCriteria: ['Both turn at least half a revolution'], unverified: ['Full-scale passenger safety'] };
  const testDefinition = TestSpec.parse({ kind: 'motion', id: 'wheel-turns', duration_s: 6,
    measure: { joints: ['left-spin', 'right-spin'] }, criteria: { minRevolutions: 0.5 } });
  const result: TestResult = { testId: `${testDefinition.id}#1`, kind: 'motion', passed: true,
    metrics: { 'left-spin.revolutions': 0.9, 'right-spin.revolutions': 0.88 }, failureReasons: [],
    notes: ['Rigid-body rotation only; no passenger certification.'], engine: 'rapier',
    trace: { dt: 0.02, frames: [{ t: 0, bodies: { trace_must_not_be_sent: { position: [1, 2, 3], rotation: [0, 0, 0, 1] } }, joints: {} }] },
  };
  return { brief, assembly, spec, testDefinitions: [testDefinition], tests: [result] };
}

test('review diagnostics fit remaining context space without replacing native evidence or relabelling old drive programs', async () => {
  const input = design();
  const capturedAssembly = structuredClone(input.assembly);
  capturedAssembly.controller.drives = capturedAssembly.controller.drives.map((drive) => ({ ...drive, mode: 'position', profile: { kind: 'constant', value: 0.2 } }));
  const report = motionDiagnostics(capturedAssembly, input.testDefinitions[0], input.tests[0])!;
  const reports = Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(report), testId: `position_${i}#1`,
    positionJoints: Array.from({ length: 8 }, () => structuredClone(report.positionJoints[0])) }));
  const observations = { diagnosticOnly: true as const, requestedTestCount: 14, notApplicableTestCount: 0, unavailableTestCount: 0,
    omittedTestCount: 0, omittedTestIds: [], omittedTestIdCount: 0, reports };
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    assert.equal((await reviewDesign(input, model)).passed, true);
    const original = JSON.parse(requests[0].messages[1].content!);
    input.motionObservations = observations;
    assert.equal((await reviewDesign(input, model)).passed, true);
    const expanded = JSON.parse(requests[1].messages[1].content!);
    assert.equal(expanded.motionObservations.reports[0].positionJoints[0].drive.mode, 'position');
    assert.equal(expanded.drives[0].mode, 'velocity', 'saved targets stay paired with their original test controller');
    assert.ok(Buffer.byteLength(JSON.stringify(expanded.motionObservations)) <= 24_000);
    input.brief += ' '.repeat(240_000 - Buffer.byteLength(requests[0].messages[1].content!) - 600);
    assert.equal((await reviewDesign(input, model)).passed, true, 'advisory data cannot overflow otherwise valid complete native context');
    const compact = JSON.parse(requests[2].messages[1].content!);
    assert.ok(Buffer.byteLength(requests[2].messages[1].content!) <= 240_000);
    assert.equal(compact.motionObservations.reports.length, 0);
    assert.equal(compact.motionObservations.omittedTestCount, 14);
    assert.deepEqual(compact.parts, original.parts);
    assert.deepEqual(compact.tests, original.tests);
    assert.deepEqual(compact.testDefinitions, original.testDefinitions);
    assert.equal(reports.length, 14);
    assert.ok(!requests[2].messages[1].content!.includes('trace_must_not_be_sent'));
  });
});

test('independent review retains a rimless custom twin-wheel failure and sends actual complete placed geometry', async () => {
  const input = design(false);
  const rejected = { passed: false, summary: 'Both wheels lack the requested continuous rims.', issues: [{
    message: 'custom-twin-rimmed-wheel has a cylinder hub and radial box spokes, but no outer ring. wheel-turns proves rotation only.',
    instanceIds: ['left-wheel', 'right-wheel'], suggestion: 'Add a connected continuous outer rim to the wheel geometry, then rerun wheel-turns.',
  }] };
  await withModel({ content: JSON.stringify(rejected) }, async (model, requests) => {
    const result = await reviewDesign(input, model);
    assert.deepEqual(result, { ...rejected, modelId: model.model, retryable: false, usage });
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.deepEqual(request.tools, [], 'the independent reviewer cannot mutate the design');
    assert.equal(request.messages.length, 2, 'builder conversation and self-approval are not inherited');
    const system = request.messages[0].content!;
    assert.match(system, /ONLY one JSON object/);
    assert.match(system, /world-space travel can be just boom motion/);
    assert.match(system, /Do not demand CFD/);
    const raw = request.messages[1].content!;
    const context = JSON.parse(raw);
    assert.equal(context.originalBrief, input.brief);
    assert.deepEqual(context.plan, input.spec.plan);
    assert.equal(context.parts.length, 2, 'unused inventory cannot prove a missing rim');
    assert.ok(!context.parts.some((part: { id: string }) => part.id === 'gear-60t-m1'));
    assert.deepEqual(context.parts[0].geometry, input.assembly.parts[0].geometry);
    assert.deepEqual(context.parts[0].connectors, JSON.parse(JSON.stringify(input.assembly.parts[0].connectors)));
    assert.deepEqual(context.instances, input.assembly.instances);
    assert.deepEqual(context.joints, input.assembly.joints);
    assert.deepEqual(context.drives, input.assembly.controller.drives);
    assert.deepEqual(context.testDefinitions, input.testDefinitions);
    assert.deepEqual(context.tests[0].metrics, input.tests[0].metrics);
    assert.deepEqual(context.tests[0].notes, input.tests[0].notes);
    assert.equal(context.derived.placedInstanceCount, 4);
    assert.equal(context.derived.placedUniquePartCount, 2);
    assert.equal(context.derived.placedGeometryPieceCount, 2 * (input.assembly.parts[0].geometry.length + input.assembly.parts[1].geometry.length));
    assert.equal(context.derived.totalMass_kg, 2 * (input.assembly.parts[0].mass_kg + input.assembly.parts[1].mass_kg));
    assert.ok(!raw.includes('trace_must_not_be_sent'));
    assert.ok(!('trace' in context.tests[0]));
  });
});

test('a bounded valid pass preserves usage and reviews latest native evidence, not superseded failures', async () => {
  const input = design();
  input.tests[0].testId = 'wheel-turns#2';
  input.tests.unshift({ ...input.tests[0], testId: 'wheel-turns#1', passed: false, failureReasons: ['Old speed was too low'] });
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    assert.deepEqual(await reviewDesign(input, model), { ...approved, modelId: model.model, retryable: false, usage });
    const context = JSON.parse(requests[0].messages[1].content!);
    assert.equal(context.tests.length, 1);
    assert.equal(context.tests[0].testId, 'wheel-turns#2', 'reviewer sees the actual recorded run ID');
    assert.equal(context.tests[0].passed, true);
  });
});

test('run suffix normalization preserves genuine definition IDs including a trailing hash-number', async () => {
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    for (const testId of ['wheel-turns#7', 'wheel-turns#7#2']) {
      const input = design();
      input.testDefinitions[0].id = 'wheel-turns#7';
      input.tests[0].testId = testId;
      assert.equal((await reviewDesign(input, model)).passed, true);
    }
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].messages[1].content!).tests[0].testId, 'wheel-turns#7#2');
  });
});

test('relative piston travel targets and metrics reach the reviewer without losing their moving reference', async () => {
  const input = design();
  const target = TestSpec.parse({ kind: 'motion', id: 'relative-stroke', duration_s: 3,
    measure: { linearTravel: [{ instance: 'left-wheel', axis: 'x', relativeTo: 'left-tower', minTravel_m: 0.05 }] } });
  input.testDefinitions.push(target);
  input.tests.push({ ...input.tests[0], testId: `${target.id}#1`, metrics: { 'left-wheel.relativeTo.left-tower.travel_x_m': 0.06 } });
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    assert.equal((await reviewDesign(input, model)).passed, true);
    const context = JSON.parse(requests[0].messages[1].content!);
    assert.deepEqual(context.testDefinitions[1], target);
    assert.deepEqual(context.tests[1].metrics, input.tests[1].metrics);
  });
});

test('malformed, non-JSON, contradictory, oversized, incomplete and mutating replies fail closed', async (t) => {
  const invalid = [
    { name: 'non-JSON', content: 'Looks great, approved!' },
    { name: 'markdown fence', content: `\`\`\`json\n${JSON.stringify(approved)}\n\`\`\`` },
    { name: 'truncated JSON', content: '{"passed":true' },
    { name: 'pass with issues', content: JSON.stringify({ ...approved, issues: [{ message: 'Missing rim' }] }) },
    { name: 'failure without issues', content: JSON.stringify({ ...approved, passed: false }) },
    { name: 'coerced boolean', content: JSON.stringify({ ...approved, passed: 'true' }) },
    { name: 'extra fields', content: JSON.stringify({ ...approved, approved: true }) },
    { name: 'unknown instance', content: JSON.stringify({ passed: false, summary: 'Missing rim', issues: [{ message: 'Missing rim', instanceIds: ['invented-part'] }] }) },
    { name: 'too many issues', content: JSON.stringify({ passed: false, summary: 'Missing rims', issues: Array.from({ length: 9 }, () => ({ message: 'Missing rim' })) }) },
    { name: 'too long field', content: JSON.stringify({ ...approved, summary: 'x'.repeat(1001) }) },
    { name: 'too large reply', content: JSON.stringify(approved) + ' '.repeat(32_769) },
    { name: 'missing content', content: null },
    { name: 'incomplete generation', content: JSON.stringify(approved), finishReason: 'length' },
    { name: 'tool attempt', content: JSON.stringify(approved), toolCalls: [{ id: 'edit', type: 'function', function: { name: 'assemble', arguments: '{}' } }] },
  ];
  for (const reply of invalid) await t.test(reply.name, () => withModel(reply, async (model) => {
    const result = await reviewDesign(design(), model);
    assert.equal(result.passed, false);
    assert.equal(result.retryable, true);
    assert.match(result.summary, /invalid verdict/);
    assert.ok(result.issues.length);
    assert.deepEqual(result.usage, usage, 'invalid output still reports the consumed tokens');
  }));
});

test('unavailable review model blocks approval without exposing provider errors', async () => {
  await withModel({ status: 404, content: 'private upstream detail' }, async (model, requests) => {
    const result = await reviewDesign(design(), model);
    assert.equal(result.passed, false);
    assert.equal(result.retryable, true);
    assert.match(result.summary, /unavailable/);
    assert.ok(!JSON.stringify(result).includes('private upstream detail'));
    assert.equal(requests.length, 1);
  });
});

test('an independent pass cannot override failed, absent or untested native checks', async () => {
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    const failed = design(); failed.tests[0].passed = false;
    const latestFailed = design(); latestFailed.tests.push({ ...latestFailed.tests[0], testId: 'wheel-turns#2', passed: false });
    const absent = design(); absent.tests = [];
    const undefinedTests = design(); undefinedTests.testDefinitions = [];
    const untested = design(); untested.testDefinitions.push({ ...untested.testDefinitions[0], id: 'untested' });
    for (const input of [failed, latestFailed, absent, undefinedTests, untested]) {
      const result = await reviewDesign(input, model);
      assert.equal(result.passed, false);
      assert.equal(result.retryable, true);
      assert.match(result.summary, /Native test evidence/);
    }
    assert.equal(requests.length, 0, 'do not spend a model call to bypass native failure');
  });
});

test('incomplete or oversized design context cannot silently pass after evidence truncation', async () => {
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    const missing = design(); missing.assembly.parts = [];
    const ambiguous = design(); ambiguous.assembly.instances.push(ambiguous.assembly.instances[0]);
    const nonfinite = design(); nonfinite.tests[0].metrics.invalid = Number.NaN;
    const oversized = design(); oversized.brief = 'x'.repeat(240_001);
    for (const input of [missing, ambiguous, nonfinite, oversized]) {
      const result = await reviewDesign(input, model);
      assert.equal(result.passed, false);
      assert.equal(result.retryable, true);
      assert.match(result.summary, /complete design/);
    }
    assert.equal(requests.length, 0);
  });
});

test('Responses transport supports a fresh tool-free review and usage passthrough', async () => {
  await withModel({ content: JSON.stringify(approved), responses: true }, async (model, requests) => {
    assert.deepEqual(await reviewDesign(design(), model), { ...approved, modelId: model.model, retryable: false, usage });
    assert.equal(requests[0].tools, undefined);
    assert.equal(requests[0].previous_response_id, undefined);
    assert.equal(requests[0].input?.length, 2);
  });
});

test('independent overlap observations reach the reviewer even when authored native tests passed', async () => {
  const input = design();
  input.clearanceObservations = [{ testIds: ['wheel-turns#1'], pairsChecked: 4, samplesChecked: 181, complete: true,
    issues: [{ firstId: 'left-wheel', secondId: 'right-tower', time_s: 0.3, penetration_m: 0.009 }] }];
  const rejected = { passed: false, summary: 'The rim clips the opposite support.', issues: [{
    message: 'The independent observation measures 9 mm penetration into the support despite the authored rotation pass.',
    instanceIds: ['left-wheel', 'right-tower'], suggestion: 'Repair the support clearance and add a test for this pair.',
  }] };
  await withModel({ content: JSON.stringify(rejected) }, async (model, requests) => {
    const before = structuredClone(input.tests);
    const result = await reviewDesign(input, model);
    assert.equal(result.passed, false);
    assert.deepEqual(JSON.parse(requests[0].messages[1].content!).clearanceObservations, input.clearanceObservations);
    assert.match(requests[0].messages[0].content!, /An authored clearance pass does not overrule an observed overlap/);
    assert.match(requests[0].messages[0].content!, /Intended contact/);
    assert.deepEqual(input.tests, before, 'review observations never rewrite native evidence');
  });
});

test('an incomplete full-assembly observation cannot be approved by a model', async () => {
  const input = design();
  input.clearanceObservations = [{ testIds: ['wheel-turns#1'], pairsChecked: 4, samplesChecked: 10,
    complete: false, failureReason: 'Geometry query budget reached', issues: [] }];
  await withModel({ content: JSON.stringify(approved) }, async (model, requests) => {
    const result = await reviewDesign(input, model);
    assert.equal(result.passed, false);
    assert.match(result.summary, /clearance evidence is incomplete/);
    assert.equal(requests.length, 0);
  });
});

test('review passes retry notifications through and propagates caller cancellation', async () => {
  await withModel({ status: 503 }, async (model, requests) => {
    const controller = new AbortController();
    let retries = 0;
    await assert.rejects(() => reviewDesign(design(), model, { signal: controller.signal, onRetry: (info) => {
      retries++; assert.equal(info.attempt, 1); controller.abort();
    } }), { name: 'AbortError' });
    assert.equal(retries, 1);
    assert.equal(requests.length, 1);
  });
});

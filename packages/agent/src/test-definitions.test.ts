import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart } from '@protolab/parts';
import { TestSpec, VersionRecord } from '@protolab/schema';
import { baseSpec, runAgent, type AgentEvent, type AgentInput } from './index.ts';

type Call = [tool: string, args: object];
const strictTest = TestSpec.parse({
  kind: 'motion', id: 'sort_both', duration_s: 1.2,
  measure: {
    noGroundContact: ['marble_red', 'marble_blue'],
    endIn: [
      { instance: 'marble_red', receiver: 'cup_L', centerOffset_m: [0, 0.0195, 0], halfExtents_m: [0.019, 0.006, 0.019], minHold_s: 1 },
      { instance: 'marble_blue', receiver: 'cup_R', centerOffset_m: [0, 0.0195, 0], halfExtents_m: [0.019, 0.006, 0.019], minHold_s: 1 },
    ],
  },
  criteria: { torqueWithinRating: true },
});

async function mockBuild(rounds: Call[][], input: Partial<AgentInput> = {}) {
  const prompts: string[] = [];
  const events: AgentEvent[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    prompts.push(JSON.parse(raw).messages[0].content);
    const round = prompts.length - 1;
    const calls = rounds[round];
    if (!calls) {
      res.writeHead(400);
      res.end('Unexpected extra model round');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: calls.map(([name, args], i) => ({
          id: `mock-${round}-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
        })),
      },
    }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  let nextVersion = input.startIteration ?? 0;
  try {
    const result = await runAgent({
      prompt: 'Verify both balls finish in their cups.', inventionId: 'sorter',
      newVersionId: () => `sorter-v${++nextVersion}`,
      model: { baseUrl: `http://127.0.0.1:${port}`, model: 'muse-spark-1.3', apiKey: 'test', maxTokens: 512, timeoutMs: 3000 },
      specialist: null, ...input,
    }, (event) => events.push(event));
    return { result, prompts, events };
  } finally {
    server.close();
  }
}

test('a tested version and a later untested checkpoint keep exact definitions for a fresh follow-up', async () => {
  const initial = await mockBuild([
    [
      ['assemble', { rationale: 'Build a catch-cup test fixture', ops: [
        { op: 'place', id: 'cup_L', part: 'catch-cup-80x35', position: [0, 0.05, 0.06], anchored: true },
        { op: 'place', id: 'cup_R', part: 'catch-cup-80x35', position: [0, 0.05, -0.06], anchored: true },
        { op: 'place', id: 'marble_red', part: 'wood-marble-24', position: [0, 0.066, 0.06], free: true },
        { op: 'place', id: 'marble_blue', part: 'wood-marble-24', position: [0, 0.066, -0.06], free: true },
        { op: 'place', id: 'support', part: 'beam-50', position: [0.12, 0.02, 0], anchored: true },
      ] }],
      ['define_test', { test: strictTest }],
      ['run_test', { test_id: strictTest.id }],
    ],
    [
      ['assemble', { rationale: 'Raise the separate support', ops: [{ op: 'move', id: 'support', translate: [0, 0.01, 0] }] }],
      ['finalize_design', { status: 'failed', summary: 'Stopped before retesting the edit.' }],
    ],
  ]);
  assert.equal(initial.result.status, 'failed');
  const [tested, checkpoint] = initial.result.versions;
  assert.equal(tested.tests[0]?.passed, true, tested.tests[0]?.failureReasons.join('; '));
  assert.deepEqual(tested.testDefinitions, [strictTest]);
  assert.deepEqual(checkpoint.testDefinitions, [strictTest]);
  assert.equal(checkpoint.parentVersionId, tested.id);
  assert.deepEqual(checkpoint.tests, []);
  assert.equal(checkpoint.status, 'failed');
  assert.ok(checkpoint.toolLog.every(({ tool }) => tool !== 'define_test'));

  // A follow-up can checkpoint again without defining any tests yet.
  const restored = VersionRecord.parse(JSON.parse(JSON.stringify(checkpoint)));
  const interrupted = await mockBuild([[
    ['assemble', { rationale: 'Move the same support', ops: [{ op: 'move', id: 'support', translate: [0, 0.01, 0] }] }],
    ['finalize_design', { status: 'failed', summary: 'Stopped before defining a test.' }],
  ]], { parent: restored, startIteration: checkpoint.iteration, changeRequest: 'Adjust the support.' });
  assert.ok(interrupted.prompts[0].includes(JSON.stringify([strictTest])));
  assert.match(interrupted.prompts[0], /reference targets, not evidence of a pass/);
  assert.match(interrupted.prompts[0], /saved definition unchanged/);
  const nextCheckpoint = interrupted.result.versions[0];
  assert.deepEqual(nextCheckpoint.testDefinitions, [strictTest]);
  assert.deepEqual(nextCheckpoint.tests, []);

  // Old definitions inform the model but do not become pending checks for a new behavior.
  const newTest = TestSpec.parse({
    kind: 'motion', id: 'support_stays_upright', duration_s: 0.4,
    measure: { base: 'support' }, criteria: { maxBaseTilt_deg: 1 },
  });
  const resumed = await mockBuild([[
    ['define_test', { test: newTest }],
    ['run_test', { test_id: newTest.id }],
    ['finalize_design', { status: 'passed', summary: 'Verified the support stayed upright.' }],
  ]], { parent: nextCheckpoint, startIteration: nextCheckpoint.iteration, changeRequest: 'Test only the support tilt.' });
  assert.ok(resumed.prompts[0].includes(JSON.stringify([strictTest])));
  assert.equal(resumed.result.status, 'passed', resumed.result.summary);
  assert.deepEqual(resumed.result.versions[0].testDefinitions, [strictTest, newTest]);
  assert.deepEqual(resumed.result.versions[0].tests.map(({ testId, passed }) => [testId, passed]), [[`${newTest.id}#1`, true]]);
});

test('a legacy version can recover definitions from successful local tool entries only', async () => {
  const legacy = VersionRecord.parse({
    id: 'legacy-v1', inventionId: 'sorter', parentVersionId: 'no-storage-lookup', iteration: 1, prompt: 'Legacy fixture',
    spec: baseSpec('Legacy fixture'),
    assembly: applyOps(emptyAssembly(), [
      { op: 'place', id: 'support', part: 'beam-50', position: [0, 0.03, 0], anchored: true },
    ], getPart).assembly,
    tests: [], decisions: [], modelId: 'muse-spark-1.3', status: 'failed', createdAt: '2026-01-01T00:00:00Z',
    toolLog: [
      { t: '0', tool: 'define_test', args: { test: { ...strictTest, id: 'failed_definition' } }, ok: false, summary: '' },
      { t: '1', tool: 'define_test', args: { test: { ...strictTest, id: 'invalid_definition', duration_s: 0 } }, ok: true, summary: '' },
      { t: '2', tool: 'define_test', args: { test: strictTest }, ok: true, summary: '' },
    ],
  });
  assert.equal(legacy.testDefinitions, undefined);
  const run = await mockBuild([[['finalize_design', { status: 'failed', summary: 'Stopped.' }]]], { parent: legacy });
  assert.ok(run.prompts[0].includes(JSON.stringify([strictTest])));
  assert.doesNotMatch(run.prompts[0], /failed_definition|invalid_definition/);

  const explicitlyEmpty = { ...legacy, testDefinitions: [] };
  const emptyRun = await mockBuild([[['finalize_design', { status: 'failed', summary: 'Stopped.' }]]], { parent: explicitlyEmpty });
  assert.doesNotMatch(emptyRun.prompts[0], /Saved test definitions/);
});

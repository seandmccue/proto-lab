import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VersionRecord } from '@protolab/schema';
import { openDb } from '../src/db.ts';
import { JobRunner } from '../src/jobs.ts';
import { buildApp } from '../src/routes.ts';
import { ObjectStore } from '../src/store.ts';

type Call = [name: string, args: object];
const stop: Call = ['finalize_design', { summary: 'Review incomplete.', status: 'failed' }];
const place: Call = ['assemble', { rationale: 'Place the platform', ops: [
  { op: 'place', id: 'plate', part: 'plate-120x80', position: [0, 0.12, 0], anchored: true },
] }];
const check: Call = ['define_test', { test: {
  kind: 'motion', id: 'platform_clearance', duration_s: 0.5, measure: { noGroundContact: ['plate'] },
} }];
const raise: Call = ['assemble', { rationale: 'Raise the platform', ops: [
  { op: 'move', id: 'plate', position: [0, 0.15, 0] },
] }];

test('API preserves untested work, resumes it, and keeps prior test evidence', async () => {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body) as { messages: { role: string; content: string | null }[] };
    const request = messages[1]?.content ?? '';
    const priorTools = messages.some(({ role }) => role === 'tool');
    let calls: Call[];
    if (request.includes('Test then raise')) {
      // The model never completes its review after the edit, so the round budget ends the build.
      calls = priorTools ? [] : [check, ['run_test', { test_id: 'platform_clearance' }], raise];
    } else if (request.includes('Inspect without changing')) {
      calls = [['inspect_assembly', {}], stop];
    } else if (request.includes('Move to the existing pose')) {
      calls = [raise, stop];
    } else if (!priorTools) {
      calls = [place];
    } else {
      res.writeHead(400);
      res.end('Mock model failed before testing');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: {
      content: calls.length ? null : 'Review in progress',
      tool_calls: calls.map(([name, args], index) => ({
        id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
      })),
    } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const settings = {
    MODEL_API_KEY: 'test',
    MODEL_API_BASE: `http://127.0.0.1:${port}`,
    MODEL_ID: 'muse-spark-1.3',
    MODEL_SPECIALIST_ID: '',
  };
  const priorEnv = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const dir = mkdtempSync(join(tmpdir(), 'protolab-checkpoint-'));
  const db = openDb(dir);
  const store = new ObjectStore(join(dir, 'store'));
  const runner = new JobRunner(db, store);
  const app = buildApp({ db, store, runner, modelStatus: { modelId: settings.MODEL_ID, live: true, detail: 'test' } });
  const headers = { 'x-session-id': 'checkpoint-tester', 'content-type': 'application/json' };
  const post = async (path: string, body: object) => {
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 201, await response.clone().text());
    return await response.json() as { inventionId: string; jobId: string };
  };
  const get = async (path: string) => {
    const response = await app.request(path, { headers });
    assert.equal(response.status, 200);
    return response.json();
  };
  const terminal = async (id: string) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const job = await get(`/api/jobs/${id}`);
      if (job.status === 'done' || job.status === 'error') return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Job ${id} did not reach a terminal state`);
  };
  try {
    const { inventionId, jobId } = await post('/api/inventions', { prompt: 'Build a test platform' });
    const path = `/api/inventions/${inventionId}`;
    const version = async (id: string) => VersionRecord.parse((await get(`${path}/versions/${id}?trace=0`)).version);
    const initial = await terminal(jobId);
    assert.equal(initial.status, 'error');
    assert.equal(initial.step, 'Untested assembly saved');
    const first = await version(initial.versionId);
    assert.equal(first.status, 'error');
    assert.deepEqual(first.tests, []);
    assert.equal(first.assembly.instances[0].id, 'plate');
    assert.match(first.decisions[0].summary, /saved without a completed simulation/);

    const followUp = await post(`${path}/follow-up`, { changeRequest: 'Test then raise' });
    const ended = await terminal(followUp.jobId);
    assert.equal(ended.status, 'done');
    assert.equal(ended.step, 'Untested assembly saved');
    assert.ok(ended.events.some((event: { type: string; summary?: string }) =>
      event.type === 'done' && /Round budget reached/.test(event.summary ?? '')));
    const detail = await get(path);
    assert.equal(detail.latestJob.baselineVersionId, first.id);
    assert.equal(detail.invention.currentVersionId, ended.versionId);
    assert.deepEqual(detail.invention.tests, []);
    assert.deepEqual(detail.versions.map(({ iteration, status }: { iteration: number; status: string }) =>
      [iteration, status]), [[1, 'error'], [2, 'passed'], [3, 'failed']]);

    const tested = await version(detail.versions[1].id);
    assert.equal(tested.parentVersionId, first.id);
    assert.equal(tested.tests[0].passed, true);
    assert.equal(tested.assembly.instances[0].transform.position[1], 0.12);
    const latest = await version(ended.versionId);
    assert.equal(latest.parentVersionId, tested.id);
    assert.equal(latest.assembly.instances[0].transform.position[1], 0.15);
    assert.deepEqual(latest.tests, []);

    for (const changeRequest of ['Inspect without changing', 'Move to the existing pose']) {
      const attempt = await post(`${path}/follow-up`, { changeRequest });
      assert.equal((await terminal(attempt.jobId)).versionId, null);
      const retained = await get(path);
      assert.equal(retained.latestJob.baselineVersionId, latest.id);
      assert.equal(retained.invention.currentVersionId, latest.id);
      assert.equal(retained.versions.length, 3);
    }
    assert.deepEqual(await version(tested.id), tested);
  } finally {
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

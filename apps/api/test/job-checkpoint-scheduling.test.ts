import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { VersionRecord } from '@protolab/schema';
import { openDb, type JobRow } from '../src/db.ts';
import { JobRunner, type PublicEvent } from '../src/jobs.ts';
import { CloudCheckpoint } from '../src/persistence.ts';
import { buildApp } from '../src/routes.ts';
import { ObjectStore } from '../src/store.ts';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
  });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer!); }
}

type Call = [string, object];
type Upload = { bytes: Buffer; checkpointId: string; sha256: string; replied: boolean; reply: (status?: number) => void };
const spin = { kind: 'motion', id: 'spin', duration_s: 0.5, measure: { joints: ['spin'] }, criteria: { minJointRate_rad_s: 0.2 } };
const clear = { kind: 'motion', id: 'ground', duration_s: 0.5, measure: { noGroundContact: ['wheel'] } };
const run = (id: string): Call => ['run_test', { test_id: id }];
const setup: Call[] = [
  ['assemble', { rationale: 'Mount the wheel on a grounded stand.', ops: [
    { op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub',
      joint: 'revolute', offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
  ] }],
  ['set_drives', { drives: [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.1, profile: { kind: 'constant', value: 2 } }] }],
  ['define_test', { test: spin }], ['define_test', { test: clear }], run('spin'),
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'protolab-job-checkpoints-'));
  const data = join(root, 'data');
  const db = openDb(data);
  const store = new ObjectStore(join(data, 'store'));
  const allowFinal = deferred();
  const localUpdates = deferred();
  const finalRequested = deferred();
  const uploads: Upload[] = [];
  const uploadWaiters = new Map<number, ReturnType<typeof deferred<Upload>>>();
  let published: Upload | undefined;
  let activeUploads = 0, maxUploads = 0, closing = false, builderCalls = 0, persistCalls = 0;
  const errors: unknown[] = [];
  const cloud = createServer(async (request, response) => {
    try {
      if (request.method === 'PUT') {
        activeUploads++; maxUploads = Math.max(maxUploads, activeUploads);
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const upload: Upload = {
          bytes: Buffer.concat(chunks), checkpointId: String(request.headers['x-checkpoint-id']), sha256: String(request.headers['x-checkpoint-sha256']), replied: false,
          reply(status = 204) {
            if (upload.replied) return;
            upload.replied = true; activeUploads--;
            if (status === 204) published = upload;
            response.writeHead(status).end();
          },
        };
        const index = uploads.length;
        uploads.push(upload);
        uploadWaiters.get(index)?.resolve(upload);
        if (closing) upload.reply(400);
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        if (!published) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'content-length': published.bytes.length, 'x-checkpoint-id': published.checkpointId, 'x-checkpoint-sha256': published.sha256 });
        response.end(request.method === 'HEAD' ? undefined : published.bytes);
      } else response.writeHead(405).end();
    } catch (error) { errors.push(error); response.writeHead(500).end(); }
  });
  const model = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as { tools?: unknown[] };
    response.setHeader('content-type', 'application/json');
    if (!body.tools?.length) {
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ passed: true, summary: 'Wheel checks and grounded display foot verified.', issues: [] }) } }] }));
      return;
    }
    const round = ++builderCalls;
    let calls: Call[];
    if (round === 1) calls = setup;
    else if (round === 2) calls = [run('ground'), ['assemble', { rationale: 'Add the separate display foot.', ops: [
      { op: 'place', id: 'display_foot', part: 'beam-100', position: [0.35, 0.005, 0], anchored: true },
    ] }], run('spin'), run('ground')];
    else if (round === 3) {
      await allowFinal.promise;
      calls = [['finalize_design', { status: 'passed', summary: 'All original checks passed after the display foot was added.' }]];
    } else { response.writeHead(400).end('Unexpected model request'); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: null,
      tool_calls: calls.map(([name, args], index) => ({ id: `round-${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
    } }] }));
  });
  await Promise.all([cloud, model].map((server) => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))));
  const cloudUrl = `http://127.0.0.1:${(cloud.address() as { port: number }).port}`;
  const checkpoint = new CloudCheckpoint(cloudUrl, 'test-token', data);
  const settings = { MODEL_API_KEY: 'test', MODEL_API_BASE: `http://127.0.0.1:${(model.address() as { port: number }).port}`, MODEL_ID: 'muse-spark-1.3', MODEL_SPECIALIST_ID: '' };
  const priorEnv = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const runner = new JobRunner(db, store, { persist: () => {
    persistCalls++;
    const rows = db.prepare('SELECT manifest_key FROM versions ORDER BY iteration').all();
    if (rows.length === 2 && rows.every(({ manifest_key }) => store.getJson<VersionRecord>(String(manifest_key))?.tests.length === 2)) localUpdates.resolve();
    if (db.prepare("SELECT id FROM jobs WHERE status='done'").get()) finalRequested.resolve();
    return checkpoint.save(db);
  } });
  const app = buildApp({ db, store, runner, modelStatus: { modelId: settings.MODEL_ID, live: true, detail: 'local mock' } });
  const headers = { 'x-session-id': 'durability-owner', 'content-type': 'application/json' };
  let jobId: string | undefined;
  return {
    root, db, store, app, runner, headers, uploads, localUpdates, finalRequested, allowFinal,
    get persistCalls() { return persistCalls; },
    get maxUploads() { return maxUploads; },
    async start() {
      const response = await app.request('/api/inventions', { method: 'POST', headers, body: JSON.stringify({ prompt: 'Build a spinning wheel on a grounded stand and add a separate display foot.' }) });
      assert.equal(response.status, 201);
      const created = await response.json() as { inventionId: string; jobId: string };
      jobId = created.jobId;
      return created;
    },
    waitForUpload(index: number) {
      if (uploads[index]) return Promise.resolve(uploads[index]);
      const waiter = deferred<Upload>(); uploadWaiters.set(index, waiter);
      return bounded(waiter.promise, `upload ${index + 1}`);
    },
    async assertRestored(expectedStatus: string) {
      const restoredDir = join(root, 'restored');
      await new CloudCheckpoint(cloudUrl, 'test-token', restoredDir).restore();
      const restored = openDb(restoredDir);
      try {
        const restoredStore = new ObjectStore(join(restoredDir, 'store'));
        const versions = db.prepare('SELECT * FROM versions ORDER BY iteration').all();
        assert.equal(versions.length, 2);
        assert.deepEqual(restored.prepare('SELECT * FROM versions ORDER BY iteration').all(), versions);
        for (const row of versions) {
          const key = String(row.manifest_key);
          const local = store.getJson<VersionRecord>(key)!;
          assert.equal(local.tests.length, 2, 'same-version test additions must not be lost');
          assert.deepEqual(restoredStore.getJson(key), local);
        }
        const last = store.getJson<VersionRecord>(String(versions[1].manifest_key))!;
        assert.ok(last.toolLog.some(({ tool, ok }) => tool === 'review_design' && ok), 'same-version final review metadata must survive');
        const saved = restored.prepare('SELECT * FROM jobs WHERE id=?').get(jobId!) as unknown as JobRow;
        assert.equal(saved.status, expectedStatus);
        const progress = JSON.parse(saved.progress_json) as PublicEvent[];
        assert.equal(progress.some((event) => event.type === 'done'), expectedStatus === 'done');
        if (expectedStatus === 'done') assert.ok(progress.some((event) => event.type === 'done' && event.summary.includes('All original checks passed')));
        else assert.equal(saved.error_code, 'storage_error');
      } finally { restored.close(); }
    },
    async close() {
      closing = true;
      allowFinal.resolve();
      for (const upload of uploads) upload.reply(400);
      const gate = jobId && runner.waitForCheckpoint(jobId);
      if (gate) await bounded(gate.catch(() => {}), 'job shutdown');
      await new Promise<void>((resolve) => setImmediate(resolve));
      for (const [key, value] of Object.entries(priorEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await Promise.all([cloud, model].map((server) => {
        server.closeAllConnections();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      }));
      db.close();
      await rm(root, { recursive: true, force: true });
      assert.deepEqual(errors, []);
    },
  };
}

test('live events drain during an upload, full captures coalesce, and terminal GET waits for all saved history', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const { inventionId, jobId } = await f.start();
    const first = await f.waitForUpload(0);
    const gate = f.runner.waitForCheckpoint(jobId);
    assert.ok(gate);
    await bounded(f.localUpdates.promise, 'later local versions while first upload is held');
    const progress = await bounded(f.app.request(`/api/jobs/${jobId}`, { headers: f.headers }), 'responsive running job');
    assert.equal(progress.status, 200);
    const running = await progress.json();
    assert.equal(running.status, 'running');
    assert.equal(running.events.filter((event: PublicEvent) => event.type === 'test').length, 4);
    assert.ok(!running.events.some((event: PublicEvent) => event.type === 'done'));
    assert.equal(f.uploads.length, 1);

    f.allowFinal.resolve();
    await bounded(f.finalRequested.promise, 'final local state staged for capture');
    let acknowledged = false;
    const terminal = f.app.request(`/api/jobs/${jobId}`, { headers: f.headers }).then((response) => { acknowledged = true; return response; });
    const blockedFollowUp = await f.app.request(`/api/inventions/${inventionId}/follow-up`, { method: 'POST', headers: f.headers, body: JSON.stringify({ changeRequest: 'Add another display foot.' }) });
    assert.equal(blockedFollowUp.status, 409, 'staged terminal status must not allow a competing same-invention job');
    assert.equal(acknowledged, false);
    assert.ok(!f.runner.events(jobId)!.some(({ type }) => type === 'done'));
    first.reply();
    const final = await f.waitForUpload(1);
    assert.strictEqual(f.runner.waitForCheckpoint(jobId), gate, 'an earlier save must not delete the newer terminal wait');
    assert.equal(acknowledged, false);
    final.reply();
    const response = await bounded(terminal, 'durable final GET');
    assert.equal(response.status, 200);
    const done = await response.json();
    assert.equal(done.status, 'done');
    assert.equal(done.events.filter((event: PublicEvent) => event.type === 'done').length, 1);
    await gate;
    assert.equal(f.runner.waitForCheckpoint(jobId), undefined);
    assert.equal(f.uploads.length, 2, 'several version events plus completion need one coalesced later capture');
    assert.ok(f.persistCalls >= 6);
    assert.equal(f.maxUploads, 1);
    await f.assertRestored('done');
  } finally { await f.close(); }
});

for (const failedCapture of ['earlier', 'final'] as const) test(`${failedCapture} storage failure rejects terminal success despite a later successful error checkpoint`, { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const { jobId } = await f.start();
    const first = await f.waitForUpload(0);
    await bounded(f.localUpdates.promise, 'complete local history');
    f.allowFinal.resolve();
    await bounded(f.finalRequested.promise, 'terminal capture request');
    let settled = false;
    const terminal = f.app.request(`/api/jobs/${jobId}`, { headers: f.headers }).then((response) => { settled = true; return response; });
    first.reply(failedCapture === 'earlier' ? 400 : 204);
    const final = await f.waitForUpload(1);
    assert.equal(settled, false);
    final.reply(failedCapture === 'final' ? 400 : 204);
    const errorCheckpoint = await f.waitForUpload(2);
    assert.equal(settled, false, 'the failure state must also finish its persistence attempt before releasing the gate');
    assert.ok(!f.runner.events(jobId)!.some(({ type }) => type === 'done'));
    errorCheckpoint.reply();
    assert.equal((await bounded(terminal, 'failed storage response')).status, 503);
    await assert.rejects(f.runner.waitForCheckpoint(jobId)!, /HTTP 400/);
    assert.equal(f.runner.isAwaitingCheckpoint(jobId), false);
    assert.equal((f.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId) as { status: string }).status, 'error');
    assert.equal((await f.app.request(`/api/jobs/${jobId}`, { headers: f.headers })).status, 503);
    assert.equal(f.maxUploads, 1);
    await f.assertRestored('error');
  } finally { await f.close(); }
});

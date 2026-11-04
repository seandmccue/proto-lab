import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { openDb } from '../src/db.ts';
import { JobRunner } from '../src/jobs.ts';
import { buildApp } from '../src/routes.ts';
import { ObjectStore } from '../src/store.ts';

test('owner can locate a new build before its durable POST completes, and retries reuse it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'protolab-create-receipt-'));
  const db = openDb(dir);
  try {
    const store = new ObjectStore(join(dir, 'store'));
    const runner = new JobRunner(db, store);
    let enqueues = 0;
    runner.enqueue = () => { enqueues++; };
    let release!: () => void;
    const checkpoint = new Promise<void>((resolve) => { release = resolve; });
    let inserted!: () => void;
    const accepted = new Promise<void>((resolve) => { inserted = resolve; });
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      await next();
      if (c.req.method === 'POST' && c.res.status < 400) {
        inserted();
        await checkpoint;
      }
    });
    app.route('/', buildApp({ db, store, runner, modelStatus: { modelId: 'fixture', live: false, detail: 'test' } }));
    const key = 'receipt-test-key';
    const owner = 'receipt-owner';
    const jobId = 'job_' + createHash('sha256').update(JSON.stringify([owner, key])).digest('hex').slice(0, 32);
    const headers = { 'x-session-id': owner, 'idempotency-key': key, 'content-type': 'application/json' };
    let acknowledged = false;
    const posting = app.request('/api/inventions', { method: 'POST', headers, body: JSON.stringify({ prompt: 'Build a windmill' }) })
      .then((response) => { acknowledged = true; return response; });
    await accepted;
    assert.equal(acknowledged, false, 'cloud durability still gates the POST acknowledgement');
    const job = await app.request(`/api/jobs/${jobId}`, { headers });
    assert.equal(job.status, 200);
    const receipt = await job.json();
    assert.equal(receipt.id, jobId);
    assert.ok(receipt.inventionId.startsWith('inv_'));
    assert.equal((await app.request(`/api/inventions/${receipt.inventionId}`, { headers })).status, 200);
    assert.equal((await app.request(`/api/jobs/${jobId}`)).status, 404);
    assert.equal((await app.request(`/api/jobs/${jobId}`, { headers: { 'x-session-id': 'other' } })).status, 404);
    release();
    const saved = await posting;
    assert.equal(saved.status, 201);
    const savedReceipt = await saved.json();
    assert.deepEqual(savedReceipt, { inventionId: receipt.inventionId, jobId });
    runner.hasCapacity = () => false;
    const retry = await app.request('/api/inventions', { method: 'POST', headers, body: JSON.stringify({ prompt: 'Build a windmill' }) });
    assert.equal(retry.status, 200, 'an existing receipt bypasses capacity checks');
    assert.deepEqual(await retry.json(), savedReceipt);
    assert.equal(enqueues, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventions').get()?.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

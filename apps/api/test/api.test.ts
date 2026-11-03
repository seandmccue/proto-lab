import { test } from 'node:test';
import { titleFromPrompt } from '../src/routes.ts';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSimulator } from '@protolab/simulator';
import { openDb } from '../src/db.ts';
import { ObjectStore } from '../src/store.ts';
import { JobRunner } from '../src/jobs.ts';
import { buildApp } from '../src/routes.ts';

// End-to-end API test with the deterministic planner (no model key): create → job → versions → publish → gallery → remix.
process.env.MODEL_API_KEY = '';
process.env.LLM_API_KEY = '';

test('API golden path with the deterministic planner', async () => {
  await initSimulator();
  const dir = mkdtempSync(join(tmpdir(), 'protolab-'));
  const db = openDb(dir); const store = new ObjectStore(join(dir, 'store'));
  let completedCheckpoints = 0;
  const runner = new JobRunner(db, store, { persist: async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const finished = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='done'").get();
    completedCheckpoints = Number(finished?.n ?? 0);
  } });
  const app = buildApp({ db, store, runner, modelStatus: { modelId: 'deterministic-planner', live: false, detail: 'test' } });
  const H = { 'x-session-id': 'tester', 'content-type': 'application/json' };
  const j = async (path: string, init?: RequestInit) => { const r = await app.request(path, init); return { status: r.status, body: await r.json() as Record<string, unknown> }; };

  const created = await j('/api/inventions', { method: 'POST', headers: H, body: JSON.stringify({ prompt: 'Design a small walking robot and make it dance.' }) });
  assert.equal(created.status, 201);
  const { inventionId, jobId } = created.body as { inventionId: string; jobId: string };
  assert.equal((await j(`/api/jobs/${jobId}`)).status, 404);
  for (let i = 0; i < 300; i++) { const s = await j(`/api/jobs/${jobId}`, { headers: H }); if (s.body.status === 'done' || s.body.status === 'error') break; await new Promise((r) => setTimeout(r, 100)); }
  const job = await j(`/api/jobs/${jobId}`, { headers: H });
  assert.equal(job.body.status, 'done', JSON.stringify(job.body).slice(0, 300));
  assert.equal(completedCheckpoints, 1, 'job completion is acknowledged after its checkpoint');
  const inv = await j(`/api/inventions/${inventionId}`, { headers: H });
  const versions = inv.body.versions as Array<{ id: string; status: string }>;
  assert.ok(versions.length >= 1);
  assert.equal((inv.body.invention as { status: string }).status, 'passed');
  const v = await j(`/api/inventions/${inventionId}/versions/${versions[versions.length - 1].id}?trace=1`, { headers: H });
  assert.ok((v.body.version as { assembly: { instances: unknown[] } }).assembly.instances.length > 10);
  assert.ok((v.body.version as { tests: Array<{ trace: { frames: unknown[] } }> }).tests[0].trace.frames.length > 50);
  assert.equal((await app.request(`/store/versions/${versions[0].id}.json`)).status, 404);

  // not the owner → cannot publish
  const forbidden = await j(`/api/inventions/${inventionId}/publish`, { method: 'POST', headers: { ...H, 'x-session-id': 'other' }, body: '{}' });
  assert.equal(forbidden.status, 403);
  const pub = await j(`/api/inventions/${inventionId}/publish`, { method: 'POST', headers: H, body: JSON.stringify({ description: 'test walker' }) });
  assert.equal(pub.status, 200);
  const gallery = await j('/api/gallery?sort=recent');
  assert.ok((gallery.body.items as Array<{ id: string }>).some((x) => x.id === inventionId));

  const remix = await j(`/api/inventions/${inventionId}/remix`, { method: 'POST', headers: { ...H, 'x-session-id': 'other' }, body: JSON.stringify({ changeRequest: 'Give it six legs' }) });
  assert.equal(remix.status, 201);
  const rj = (remix.body as { jobId: string }).jobId;
  for (let i = 0; i < 300; i++) { const s = await j(`/api/jobs/${rj}`, { headers: { ...H, 'x-session-id': 'other' } }); if (s.body.status === 'done' || s.body.status === 'error') break; await new Promise((r) => setTimeout(r, 100)); }
  const rinv = await j(`/api/inventions/${(remix.body as { inventionId: string }).inventionId}`, { headers: { ...H, 'x-session-id': 'other' } });
  assert.equal((rinv.body.source as { id: string }).id, inventionId);
  const rv = rinv.body.versions as Array<{ id: string }>;
  assert.ok(rv.length >= 1, 'remix produced a version');
  const rver = await j(`/api/inventions/${(remix.body as { inventionId: string }).inventionId}/versions/${rv[rv.length - 1].id}?trace=0`, { headers: { ...H, 'x-session-id': 'other' } });
  assert.equal((rver.body.version as { assembly: { familyConfig: { legCount: number } } }).assembly.familyConfig.legCount, 6);
});

test('titleFromPrompt drops the verb and stops at the first clause', () => {
  assert.equal(titleFromPrompt('Build a desk toy: a pendulum on a stand that swings and taps a small bell at each end of its swing.'), 'Desk toy: pendulum on a stand');
  assert.equal(titleFromPrompt('Build a mechanical butterfly with large shaped wings that flap on a stand.'), 'Mechanical butterfly with large shaped wings');
  assert.equal(titleFromPrompt('Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.'), 'Small walking robot inspired by my Muse character');
  assert.equal(titleFromPrompt('Build a miniature Ferris wheel with eight hanging gondolas that turns steadily on a tower.'), 'Miniature Ferris wheel with eight hanging gondolas');
});

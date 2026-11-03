import { test } from 'node:test';
import { titleFromPrompt } from '../src/routes.ts';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSimulator } from '@protolab/simulator';
import { openDb } from '../src/db.ts';
import { ObjectStore } from '../src/store.ts';
import { JobRunner, type PublicEvent } from '../src/jobs.ts';
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
  const jobEvents = job.body.events as PublicEvent[];
  const firstTestStart = jobEvents.findIndex((event) => event.type === 'test_start');
  const firstTestResult = jobEvents.findIndex((event) => event.type === 'test');
  assert.ok(firstTestStart >= 0 && firstTestStart < firstTestResult);
  const timing = job.body.timing as { firstAssemblyMs: number; firstTestMs: number; totalMs: number; modelCalls: number };
  assert.ok(Number.isFinite(timing.firstAssemblyMs) && Number.isFinite(timing.firstTestMs));
  assert.ok(timing.firstAssemblyMs <= timing.firstTestMs && timing.firstTestMs <= timing.totalMs);
  assert.equal(timing.modelCalls, 0);
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

  const remixHeaders = { ...H, 'x-session-id': 'other' };
  const missingBaseline = await j(`/api/inventions/${inventionId}/remix`, { method: 'POST', headers: remixHeaders, body: JSON.stringify({ changeRequest: 'Give it six legs', versionId: 'ver_missing' }) });
  assert.equal(missingBaseline.status, 409);
  const remix = await j(`/api/inventions/${inventionId}/remix`, { method: 'POST', headers: remixHeaders, body: JSON.stringify({ changeRequest: 'Give it six legs', versionId: versions[0].id }) });
  assert.equal(remix.status, 201);
  const rj = (remix.body as { jobId: string }).jobId;
  for (let i = 0; i < 300; i++) { const s = await j(`/api/jobs/${rj}`, { headers: { ...H, 'x-session-id': 'other' } }); if (s.body.status === 'done' || s.body.status === 'error') break; await new Promise((r) => setTimeout(r, 100)); }
  const rinv = await j(`/api/inventions/${(remix.body as { inventionId: string }).inventionId}`, { headers: { ...H, 'x-session-id': 'other' } });
  assert.equal((rinv.body.source as { id: string }).id, inventionId);
  assert.equal((rinv.body.source as { versionId: string }).versionId, versions[0].id);
  assert.equal((rinv.body.latestJob as { baselineVersionId: string }).baselineVersionId, versions[0].id);
  assert.equal((rinv.body.latestJob as { changeRequest: string }).changeRequest, 'Give it six legs');
  const rv = rinv.body.versions as Array<{ id: string }>;
  assert.ok(rv.length >= 1, 'remix produced a version');
  const rver = await j(`/api/inventions/${(remix.body as { inventionId: string }).inventionId}/versions/${rv[rv.length - 1].id}?trace=0`, { headers: { ...H, 'x-session-id': 'other' } });
  assert.equal((rver.body.version as { assembly: { familyConfig: { legCount: number } } }).assembly.familyConfig.legCount, 6);
  assert.equal((rinv.body.latestJob as { versionId: string }).versionId, rv[rv.length - 1].id);
  const wrongInvention = await j(`/api/inventions/${inventionId}/follow-up`, { method: 'POST', headers: H, body: JSON.stringify({ changeRequest: 'Walk farther', versionId: rv[0].id }) });
  assert.equal(wrongInvention.status, 409);
  const followUp = await j(`/api/inventions/${inventionId}/follow-up`, { method: 'POST', headers: H, body: JSON.stringify({ changeRequest: 'Give it six legs', versionId: versions[0].id }) });
  assert.equal(followUp.status, 201);
  const followUpId = (followUp.body as { jobId: string }).jobId;
  for (let i = 0; i < 300; i++) { const s = await j(`/api/jobs/${followUpId}`, { headers: H }); if (s.body.status === 'done' || s.body.status === 'error') break; await new Promise((r) => setTimeout(r, 100)); }
  const revised = await j(`/api/inventions/${inventionId}`, { headers: H });
  assert.equal((revised.body.latestJob as { baselineVersionId: string }).baselineVersionId, versions[0].id);
  assert.equal((revised.body.latestJob as { status: string }).status, 'done');
});

test('titleFromPrompt drops the verb and stops at the first clause', () => {
  assert.equal(titleFromPrompt('Build a desk toy: a pendulum on a stand that swings and taps a small bell at each end of its swing.'), 'Desk toy: pendulum on a stand');
  assert.equal(titleFromPrompt('Build a mechanical butterfly with large shaped wings that flap on a stand.'), 'Mechanical butterfly with large shaped wings');
  assert.equal(titleFromPrompt('Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.'), 'Small walking robot inspired by my Muse character');
  assert.equal(titleFromPrompt('Build a miniature Ferris wheel with eight hanging gondolas that turns steadily on a tower.'), 'Miniature Ferris wheel with eight hanging gondolas');
});

test('share-preview tags: absolute image, per-invention title/description/picture for public builds only', async () => {
  const { rewriteOg, originOf } = await import('../src/og.ts');
  const html = '<meta property="og:title" content="ProtoLab" /><meta property="og:description" content="x" /><meta property="og:image" content="/og.png" /><meta name="twitter:title" content="ProtoLab" /><meta name="twitter:image" content="/og.png" />';
  const generic = rewriteOg(html, 'https://example.test', null);
  assert.ok(generic.includes('content="https://example.test/og.png"'), 'absolute og:image');
  assert.ok(generic.includes('og:title" content="ProtoLab"'), 'generic title kept');
  const inv = rewriteOg(html, 'https://example.test', { id: 'inv_1', title: 'Mechanical <crab>', description: 'Scuttles "sideways"', previewUrl: '/store/previews/inv_1.png' });
  assert.ok(inv.includes('og:title" content="Mechanical &lt;crab&gt; — ProtoLab"'), 'escaped title');
  assert.ok(inv.includes('og:description" content="Scuttles &quot;sideways&quot;"'), 'escaped description');
  assert.ok(inv.includes('og:image" content="https://example.test/store/previews/inv_1.png"'), 'preview picture');
  assert.equal(originOf({ get: (n) => ({ 'x-forwarded-proto': 'https', host: 'protolab.example.workers.dev' } as Record<string, string>)[n] ?? null }, 'http://localhost:1'), 'https://protolab.example.workers.dev');
  assert.equal(originOf({ get: (n) => ({ host: 'localhost:8787' } as Record<string, string>)[n] ?? null }, 'http://localhost:1'), 'http://localhost:8787');
});

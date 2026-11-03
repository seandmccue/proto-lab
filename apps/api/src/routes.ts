import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { VersionRecord } from '@protolab/schema';
import { catalog, generatorInfo, getPart } from '@protolab/parts';
import { modelConfigFromEnv, DETERMINISTIC_MODEL_ID, prettyModelName, explainDesign } from '@protolab/agent';
import type { ObjectStore } from './store.ts';
import { JobRunner, newId, now, stripTrace, versionSummary } from './jobs.ts';
import type { InventionRow, JobRow, VersionRow } from './db.ts';
import { EXAMPLES } from './seed.ts';

export interface AppDeps { db: DatabaseSync; store: ObjectStore; runner: JobRunner; modelStatus: { modelId: string; live: boolean; detail: string } }

const CreateBody = z.object({ prompt: z.string().trim().min(3).max(600).optional(), exampleId: z.string().optional(), title: z.string().trim().max(80).optional() });
const RemixBody = z.object({ changeRequest: z.string().trim().min(2).max(400) });
const PublishBody = z.object({ title: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(400).optional() });
const ReportBody = z.object({ inventionId: z.string(), reason: z.string().trim().min(3).max(400) });

const sanitize = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();

export function buildApp({ db, store, runner, modelStatus }: AppDeps) {
  const app = new Hono();
  const session = (h: { header: (n: string) => string | undefined }) => {
    const token = (h.header('x-session-id') ?? '').slice(0, 64);
    return token && token !== 'protolab' ? token : null;
  };
  const rate = new Map<string, number[]>();
  const limited = (key: string, max: number, windowMs: number) => {
    const t = Date.now();
    if (rate.size >= 4096) {
      for (const [k, times] of rate) if (t - times[times.length - 1] >= 10 * 60_000) rate.delete(k);
      if (!rate.has(key) && rate.size >= 4096) return true;
    }
    const arr = (rate.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) return true;
    arr.push(t); rate.set(key, arr); return false;
  };

  const getInvention = (id: string) => db.prepare('SELECT * FROM inventions WHERE id=?').get(id) as InventionRow | undefined;
  const loadVersion = (vid: string): VersionRecord | null => store.getJson<VersionRecord>(`versions/${vid}.json`);
  const listVersions = (inventionId: string) => (db.prepare('SELECT * FROM versions WHERE invention_id=? ORDER BY iteration ASC, created_at ASC').all(inventionId) as unknown as VersionRow[]);
  const canSee = (inv: InventionRow, sid: string | null) => inv.visibility === 'public' || inv.owner_id === sid;
  const canQueue = () => runner.hasCapacity() && !limited('global:create', 36, 60_000);

  const attribution = () => modelStatus.modelId === DETERMINISTIC_MODEL_ID
    ? { modelId: modelStatus.modelId, label: 'Deterministic planner (no model key configured)', live: false }
    : { modelId: modelStatus.modelId, label: /^muse-/i.test(modelStatus.modelId) ? `Powered by Meta ${prettyModelName(modelStatus.modelId)}` : `Model: ${modelStatus.modelId}`, live: modelStatus.live };

  app.get('/api/model', (c) => c.json({ ...attribution(), detail: modelStatus.detail }));
  app.get('/api/load', (c) => c.json(runner.load()));
  app.get('/api/parts/:id', (c) => { const part = getPart(c.req.param('id')); return part ? c.json({ part }) : c.json({ error: 'Not found' }, 404); });
  app.get('/api/examples', (c) => c.json({ examples: EXAMPLES }));

  app.post('/api/inventions', async (c) => {
    const sid = session(c.req);
    if (!sid) return c.json({ error: 'A browser session is required' }, 400);
    const body = CreateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid body' }, 400);
    const ex = body.data.exampleId ? EXAMPLES.find((e) => e.id === body.data.exampleId) : undefined;
    const prompt = sanitize(ex?.prompt ?? body.data.prompt ?? '');
    if (!prompt) return c.json({ error: 'prompt or exampleId required' }, 400);
    const idem = c.req.header('idempotency-key')?.slice(0, 128);
    const jobId = idem ? `job_${createHash('sha256').update(JSON.stringify([sid, idem])).digest('hex').slice(0, 32)}` : newId('job');
    if (idem) {
      const existing = db.prepare('SELECT jobs.id, invention_id FROM jobs JOIN inventions ON inventions.id=jobs.invention_id WHERE jobs.id IN (?,?) AND owner_id=?').get(jobId, `job_${idem}`, sid) as { id: string; invention_id: string } | undefined;
      if (existing) return c.json({ inventionId: existing.invention_id, jobId: existing.id });
    }
    if (limited(`create:${sid}`, 10, 10 * 60_000)) return c.json({ error: 'Rate limited: 10 builds per 10 minutes' }, 429);
    if (!canQueue()) return c.json({ error: 'Build capacity is full. Try again in a minute.' }, 429, { 'Retry-After': '60' });
    const inv: InventionRow = { id: newId('inv'), owner_id: sid, title: sanitize(body.data.title ?? ex?.title ?? titleFromPrompt(prompt)), description: '', visibility: 'private', current_version_id: null, status: 'queued', parent_version_id: null, source_invention_id: null, prompt, featured: 0, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, parent_version_id, source_invention_id, prompt, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(inv.id, inv.owner_id, inv.title, inv.description, inv.visibility, null, inv.status, null, null, inv.prompt, 0, inv.created_at, inv.updated_at);
    const job: JobRow = { id: jobId, invention_id: inv.id, version_id: null, status: 'queued', step: 'Queued', progress_json: '[]', error_code: null, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO jobs (id, invention_id, version_id, status, step, progress_json, error_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, job.invention_id, null, job.status, job.step, '[]', null, job.created_at, job.updated_at);
    runner.enqueue(job, inv, { parent: null });
    return c.json({ inventionId: inv.id, jobId: job.id }, 201);
  });

  app.get('/api/jobs/:id', async (c) => {
    const id = c.req.param('id');
    const select = db.prepare('SELECT * FROM jobs WHERE id=?');
    let job = select.get(id) as JobRow | undefined;
    if (!job) return c.json({ error: 'Not found' }, 404);
    const inv = getInvention(job.invention_id);
    if (!inv || !canSee(inv, session(c.req))) return c.json({ error: 'Not found' }, 404);
    const checkpoint = runner.waitForCheckpoint(id);
    if (checkpoint) {
      try { await checkpoint; } catch { return c.json({ error: 'Build storage is temporarily unavailable' }, 503); }
      job = select.get(id) as JobRow;
    }
    c.header('Cache-Control', 'private, no-store');
    const since = Number(c.req.query('since') ?? 0);
    const events = runner.events(job.id) ?? (JSON.parse(job.progress_json) as unknown[]);
    return c.json({ id: job.id, inventionId: job.invention_id, status: job.status, step: job.step, versionId: job.version_id, errorCode: job.error_code, events: events.slice(since), eventCount: events.length, updatedAt: job.updated_at });
  });

  /** Latest in-progress assembly of a running job (before its first recorded version), so the workbench can show the build taking shape. */
  app.get('/api/jobs/:id/assembly', (c) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(c.req.param('id')) as JobRow | undefined;
    if (!job) return c.json({ error: 'Not found' }, 404);
    const inv = getInvention(job.invention_id);
    if (!inv || !canSee(inv, session(c.req))) return c.json({ error: 'Not found' }, 404);
    const snap = runner.assemblySnapshot(job.id);
    if (!snap) return c.json({ error: 'No live assembly for this job' }, 404);
    return c.json(snap);
  });

  app.get('/api/inventions/:id', (c) => {
    const inv = getInvention(c.req.param('id'));
    if (!inv || !canSee(inv, session(c.req))) return c.json({ error: 'Not found' }, 404);
    const versions = listVersions(inv.id).map((v) => ({ id: v.id, iteration: v.iteration, status: v.status, modelId: v.model_id, parentVersionId: v.parent_version_id, createdAt: v.created_at, tests: JSON.parse(v.metrics_json), spec: JSON.parse(v.spec_json) }));
    const latestJob = db.prepare('SELECT id, status, step FROM jobs WHERE invention_id=? ORDER BY created_at DESC LIMIT 1').get(inv.id) as { id: string; status: string; step: string } | undefined;
    const source = inv.source_invention_id ? getInvention(inv.source_invention_id) : undefined;
    return c.json({ invention: publicInvention(inv, session(c.req)), versions, latestJob, source: source && canSee(source, session(c.req)) ? { id: source.id, title: source.title, ownerLabel: ownerLabel(source) } : null });
  });

  app.get('/api/inventions/:id/versions/:vid', (c) => {
    const inv = getInvention(c.req.param('id'));
    if (!inv || !canSee(inv, session(c.req))) return c.json({ error: 'Not found' }, 404);
    const v = loadVersion(c.req.param('vid'));
    if (!v || v.inventionId !== inv.id) return c.json({ error: 'Not found' }, 404);
    const withTrace = c.req.query('trace') !== '0';
    c.header('cache-control', 'private, no-store');
    return c.json({ version: withTrace ? v : stripTrace(v), summary: versionSummary(v) });
  });

  const startDerived = (sid: string, inv: InventionRow, changeRequest: string, mode: 'remix' | 'follow-up') => {
    const parent = inv.current_version_id ? loadVersion(inv.current_version_id) : null;
    if (!parent) return { error: 'This invention has no finished version to build on yet' } as const;
    let target = inv;
    if (mode === 'remix') {
      // Name the remix after the change so lineage reads in the gallery: "Mechanical butterfly → four wings like a dragonfly".
      const change = changeRequest.trim().replace(/[.!]+$/, ''); const base = inv.title.replace(/\s*\((remix[^)]*)\)$/i, '').replace(/\s*→.*$/, '');
      const title = `${base} → ${change.charAt(0).toLowerCase() + change.slice(1)}`.slice(0, 80);
      target = { id: newId('inv'), owner_id: sid, title, description: '', visibility: 'private', current_version_id: null, status: 'queued', parent_version_id: parent.id, source_invention_id: inv.id, prompt: inv.prompt, featured: 0, created_at: now(), updated_at: now() };
      db.prepare('INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, parent_version_id, source_invention_id, prompt, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(target.id, target.owner_id, target.title, '', 'private', null, 'queued', parent.id, inv.id, inv.prompt, 0, target.created_at, target.updated_at);
      db.prepare('INSERT INTO remixes (id, source_version_id, derived_invention_id, change_request, created_at) VALUES (?,?,?,?,?)').run(newId('rmx'), parent.id, target.id, changeRequest, now());
    }
    const job: JobRow = { id: newId('job'), invention_id: target.id, version_id: null, status: 'queued', step: 'Queued', progress_json: '[]', error_code: null, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO jobs (id, invention_id, version_id, status, step, progress_json, error_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, job.invention_id, null, job.status, job.step, '[]', null, job.created_at, job.updated_at);
    runner.enqueue(job, target, { parent, changeRequest });
    return { inventionId: target.id, jobId: job.id } as const;
  };

  app.post('/api/inventions/:id/remix', async (c) => {
    const sid = session(c.req);
    if (!sid) return c.json({ error: 'A browser session is required' }, 400);
    if (limited(`create:${sid}`, 10, 10 * 60_000)) return c.json({ error: 'Rate limited' }, 429);
    const inv = getInvention(c.req.param('id'));
    if (!inv || !canSee(inv, sid)) return c.json({ error: 'Not found' }, 404);
    const body = RemixBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'changeRequest required' }, 400);
    if (!canQueue()) return c.json({ error: 'Build capacity is full. Try again in a minute.' }, 429, { 'Retry-After': '60' });
    const r = startDerived(sid, inv, sanitize(body.data.changeRequest), 'remix');
    return 'error' in r ? c.json(r, 409) : c.json(r, 201);
  });

  app.post('/api/inventions/:id/follow-up', async (c) => {
    const sid = session(c.req);
    if (!sid) return c.json({ error: 'A browser session is required' }, 400);
    if (limited(`create:${sid}`, 10, 10 * 60_000)) return c.json({ error: 'Rate limited' }, 429);
    const inv = getInvention(c.req.param('id'));
    if (!inv || inv.owner_id !== sid) return c.json({ error: 'Only the owner can change this invention; remix it instead' }, 403);
    const body = RemixBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'changeRequest required' }, 400);
    const active = db.prepare("SELECT 1 FROM jobs WHERE invention_id=? AND status IN ('queued','running') LIMIT 1").get(inv.id);
    if (active) return c.json({ error: 'A build is already in progress for this invention' }, 409);
    if (!canQueue()) return c.json({ error: 'Build capacity is full. Try again in a minute.' }, 429, { 'Retry-After': '60' });
    const r = startDerived(sid, inv, sanitize(body.data.changeRequest), 'follow-up');
    return 'error' in r ? c.json(r, 409) : c.json(r, 201);
  });

  app.post('/api/inventions/:id/publish', async (c) => {
    const sid = session(c.req);
    const inv = getInvention(c.req.param('id'));
    if (!inv) return c.json({ error: 'Not found' }, 404);
    if (inv.owner_id !== sid) return c.json({ error: 'Only the creator can publish' }, 403);
    if (!inv.current_version_id) return c.json({ error: 'Nothing to publish yet' }, 409);
    const body = PublishBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'Invalid body' }, 400);
    db.prepare('UPDATE inventions SET visibility=?, title=COALESCE(?, title), description=COALESCE(?, description), updated_at=? WHERE id=?')
      .run('public', body.data.title ? sanitize(body.data.title) : null, body.data.description ? sanitize(body.data.description) : null, now(), inv.id);
    return c.json({ ok: true, invention: publicInvention(getInvention(inv.id)!, sid) });
  });

  const explainCache = new Map<string, { text: string; modelId: string }>();
  app.post('/api/inventions/:id/versions/:vid/explain', async (c) => {
    const sid = session(c.req);
    if (limited(`explain:${sid}`, 20, 10 * 60_000)) return c.json({ error: 'Rate limited' }, 429);
    const inv = getInvention(c.req.param('id'));
    if (!inv || !canSee(inv, sid)) return c.json({ error: 'Not found' }, 404);
    const v = loadVersion(c.req.param('vid'));
    if (!v || v.inventionId !== inv.id) return c.json({ error: 'Not found' }, 404);
    const cached = explainCache.get(v.id); if (cached) return c.json(cached);
    try { const r = await explainDesign(v); explainCache.set(v.id, r); return c.json(r); }
    catch (e) { return c.json({ error: (e as Error).message }, 502); }
  });

  app.post('/api/inventions/:id/preview', async (c) => {
    const sid = session(c.req);
    const inv = getInvention(c.req.param('id'));
    if (!inv || inv.owner_id !== sid) return c.json({ error: 'Not found' }, 404);
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length > 600_000 || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return c.json({ error: 'PNG up to 600 kB required' }, 400);
    const key = `previews/${inv.id}.png`;
    store.putBytes(key, buf);
    db.prepare('INSERT INTO gallery_assets (id, version_id, kind, key, created_at) VALUES (?,?,?,?,?)').run(newId('ga'), inv.current_version_id ?? '', 'thumbnail', key, now());
    return c.json({ ok: true, url: `/store/${key}` });
  });

  app.get('/api/gallery', (c) => {
    const sort = c.req.query('sort') ?? 'recent';
    const cursor = Number(c.req.query('cursor') ?? 0);
    const limit = Math.min(24, Number(c.req.query('limit') ?? 12));
    const where = sort === 'featured' ? 'visibility=\'public\' AND featured=1' : sort === 'remixes' ? 'visibility=\'public\' AND source_invention_id IS NOT NULL' : 'visibility=\'public\'';
    const rows = db.prepare(`SELECT * FROM inventions WHERE ${where} AND current_version_id IS NOT NULL ORDER BY featured DESC, updated_at DESC LIMIT ? OFFSET ?`).all(limit + 1, cursor) as unknown as InventionRow[];
    const items = rows.slice(0, limit).map((inv) => publicInvention(inv, session(c.req)));
    return c.json({ items, nextCursor: rows.length > limit ? cursor + limit : null });
  });

  app.get('/api/mine', (c) => {
    const sid = session(c.req);
    const rows = sid ? db.prepare('SELECT * FROM inventions WHERE owner_id=? ORDER BY updated_at DESC LIMIT 30').all(sid) as unknown as InventionRow[] : [];
    return c.json({ items: rows.map((inv) => publicInvention(inv, sid)) });
  });

  app.get('/api/parts', (c) => {
    const category = c.req.query('category');
    const parts = catalog().filter((p) => !category || p.category === category).map((p) => ({ id: p.id, kind: p.kind, name: p.name, category: p.category, description: p.description, params: p.params, mass_kg: p.mass_kg, dimensions_m: p.dimensions_m, material: p.material, limits: p.limits, cost_usd: p.cost_usd, source: p.source, geometry: p.geometry }));
    return c.json({ parts, generators: generatorInfo() });
  });

  app.post('/api/reports', async (c) => {
    const body = ReportBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'inventionId and reason required' }, 400);
    if (!getInvention(body.data.inventionId)) return c.json({ error: 'Not found' }, 404);
    db.prepare('INSERT INTO reports (id, invention_id, reason, status, created_at) VALUES (?,?,?,?,?)').run(newId('rep'), body.data.inventionId, sanitize(body.data.reason), 'open', now());
    return c.json({ ok: true }, 201);
  });

  app.get('/store/*', (c) => {
    const key = c.req.path.replace(/^\/store\//, '');
    const preview = /^previews\/([a-zA-Z0-9_-]+)\.png$/.exec(key);
    const inv = preview && getInvention(preview[1]);
    if (!inv || inv.visibility !== 'public') return c.text('Not found', 404);
    const bytes = store.getBytes(key);
    if (!bytes) return c.text('Not found', 404);
    c.header('content-type', 'image/png');
    c.header('cache-control', 'public, max-age=3600');
    return c.body(new Uint8Array(bytes));
  });

  function ownerLabel(inv: InventionRow) { return inv.owner_id === 'protolab' ? 'ProtoLab featured' : `Maker ${createHash('sha256').update(inv.owner_id).digest('hex').slice(0, 6)}`; }
  function publicInvention(inv: InventionRow, sid: string | null) {
    const v = inv.current_version_id ? (db.prepare('SELECT * FROM versions WHERE id=?').get(inv.current_version_id) as VersionRow | undefined) : undefined;
    type T = { testId: string; kind: string; passed: boolean; metrics: Record<string, number>; failureReasons: string[] };
    const tests = v ? (JSON.parse(v.metrics_json) as T[]) : [];
    // Latest walk and dance results across all versions (a dance-only revision does not re-run the walk).
    const rows = db.prepare('SELECT metrics_json FROM versions WHERE invention_id=? ORDER BY iteration DESC, created_at DESC').all(inv.id) as unknown as Array<{ metrics_json: string }>;
    const latest = (kind?: string): T | null => { for (const r of rows) { const t = (JSON.parse(r.metrics_json) as T[]).filter((x) => !kind || x.kind === kind).pop(); if (t) return t; } return null; };
    return {
      latestWalk: latest('walk'), latestDance: latest('motion'), latestTest: latest(),
      id: inv.id, title: inv.title, description: inv.description, prompt: inv.prompt, visibility: inv.visibility, status: inv.status,
      currentVersionId: inv.current_version_id, featured: !!inv.featured, isOwner: inv.owner_id === sid, ownerLabel: ownerLabel(inv),
      sourceInventionId: inv.source_invention_id, parentVersionId: inv.parent_version_id, modelId: v?.model_id ?? null,
      tests, previewUrl: inv.visibility === 'public' && store.has(`previews/${inv.id}.png`) ? `/store/previews/${inv.id}.png` : null, createdAt: inv.created_at, updatedAt: inv.updated_at,
    };
  }
  return app;
}

/** "Build a desk toy: a pendulum on a stand that swings…" → "Desk toy: pendulum on a stand". Drops the verb and
 *  articles, stops at the first clause break, keeps at most seven words. */
export function titleFromPrompt(p: string) {
  let t = p.trim().replace(/^(please\s+)?(build|design|make|create|invent|construct|prototype|engineer|i want|i need|can you (build|make|design))\s+(me\s+)?(a|an|the)?\s*/i, '');
  t = t.replace(/\s+(that|which|whose|so that|where)\b.*$/i, '').replace(/[.!?]+$/, '');
  const [head, tail] = t.split(/:\s*/, 2);
  const clean = (x: string) => x.replace(/[^\w\s-]/g, '').replace(/^(a|an|the)\s+/i, '').split(/\s+/).filter(Boolean);
  let words = clean(head);
  if (tail) { const tw = clean(tail).slice(0, Math.max(2, 7 - words.length - 1)); if (tw.length) words = [...words, ':', ...tw]; }
  const out = words.slice(0, 8).join(' ').replace(/\s+:\s+/, ': ').replace(/\s+(with|and|on|in|for|to|of|at|by)$/i, '');
  const title = out.charAt(0).toUpperCase() + out.slice(1);
  return title.length >= 3 ? title : p.slice(0, 40);
}

export { modelConfigFromEnv };

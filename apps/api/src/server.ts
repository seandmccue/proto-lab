import { config as loadEnv } from 'dotenv';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { resolve, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
// Local .env first, then the repo-root .env (first definition wins).
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import { initSimulator } from '@protolab/simulator';
import { modelConfigFromEnv, smokeTest, DETERMINISTIC_MODEL_ID, prettyModelName } from '@protolab/agent';
import { openDb } from './db.ts';
import { ObjectStore } from './store.ts';
import { JobRunner } from './jobs.ts';
import { CloudCheckpoint } from './persistence.ts';
import { originOf, rewriteOg } from './og.ts';
import { buildApp } from './routes.ts';
import { seedFeatured, requeueInterruptedSeeds } from './seed.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');

const checkpoint = CloudCheckpoint.fromEnv(DATA_DIR);
await checkpoint?.restore();
await initSimulator();
const db = openDb(DATA_DIR);
const store = new ObjectStore(resolve(DATA_DIR, 'store'));
const persist = checkpoint ? () => checkpoint.save(db) : undefined;
// Curate the existing public Gravity Clock without changing its ownership or saved versions.
const gravityClock = db.prepare(
  "UPDATE inventions SET featured=1 WHERE id=? AND visibility='public' AND status='passed' AND current_version_id IS NOT NULL AND featured=0",
).run('inv_a1f1665e649b41c2');
if (gravityClock.changes) await persist?.();

const runner = new JobRunner(db, store, { persist });
// Requeue anything that was running when the process last stopped.
db.prepare('UPDATE jobs SET status=\'error\', step=\'Interrupted by restart\', error_code=\'interrupted\' WHERE status IN (\'queued\',\'running\')').run();
db.prepare('UPDATE inventions SET status=\'error\' WHERE status IN (\'queued\',\'running\')').run();

const cfg = modelConfigFromEnv();
const modelStatus = { modelId: cfg ? cfg.model : DETERMINISTIC_MODEL_ID, live: false, detail: cfg ? 'checking…' : 'No MODEL_API_KEY set; using the deterministic planner.' };
if (cfg) {
  const r = await smokeTest(cfg);
  modelStatus.live = r.ok;
  modelStatus.detail = r.ok ? `Live tool-call smoke test passed: ${prettyModelName(cfg.model)} (${cfg.model}) at ${cfg.baseUrl}` : `Model smoke test failed: ${r.detail}`;
  console.log(`[model] ${cfg.model} — ${modelStatus.detail}`);
  // No silent substitution: jobs keep using the configured model and surface its errors verbatim.
  if (!r.ok) console.warn('[model] The configured model is still used for jobs; errors will be reported on each job.');
} else console.log('[model] No MODEL_API_KEY; deterministic planner.');

const app = new Hono();
if (persist) {
  app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method !== 'POST' || c.res.status >= 400 || c.req.path.endsWith('/explain')) return;
    try {
      await persist();
    } catch (error) {
      console.error('[storage] checkpoint failed', error);
      return c.json({ error: 'Cloud storage is temporarily unavailable. Please retry.' }, 503);
    }
  });
}
app.route('/', buildApp({ db, store, runner, modelStatus }));
// In production the API also serves the built web app (apps/web/dist) with an SPA fallback, so one process
// and one port serve the whole product (the Docker image relies on this). In development Vite serves the web.
const webDist = resolve(process.env.WEB_DIST ?? resolve(import.meta.dirname, '../../web/dist'));
if (existsSync(resolve(webDist, 'index.html'))) {
  const root = relative(process.cwd(), webDist) || '.';
  const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  const ogRow = db.prepare('SELECT id, title, description, visibility FROM inventions WHERE id = ?');
  const page = (c: Context) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    const origin = originOf({ get: (n) => c.req.header(n) }, `http://localhost:${PORT}`);
    const m = /^\/i\/([a-zA-Z0-9_-]+)$/.exec(c.req.path);
    const row = m ? (ogRow.get(m[1]) as { id: string; title: string; description: string; visibility: string } | undefined) : undefined;
    const inv = row && row.visibility === 'public' ? { id: row.id, title: row.title, description: row.description, previewUrl: store.has(`previews/${row.id}.png`) ? `/store/previews/${row.id}.png` : null } : null; // private builds keep the generic card
    return c.html(rewriteOg(indexHtml, origin, inv));
  };
  app.get('/', page); // before the static middleware, which would otherwise serve index.html verbatim (relative og:image)
  app.use('/assets/*', serveStatic({ root }));
  app.use('/*', serveStatic({ root }));
  app.get('*', page);
  console.log(`[web] serving the built web app from ${webDist}`);
}
seedFeatured(db, runner);
requeueInterruptedSeeds(db, runner);
serve({ fetch: app.fetch, port: PORT }, () => console.log(`[api] ProtoLab API on http://localhost:${PORT} (data: ${DATA_DIR})`));

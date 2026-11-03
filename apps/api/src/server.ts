import { config as loadEnv } from 'dotenv';
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
// Local .env first, then the repo-root .env (first definition wins).
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import { initSimulator } from '@protolab/simulator';
import { modelConfigFromEnv, smokeTest, DETERMINISTIC_MODEL_ID, prettyModelName } from '@protolab/agent';
import { openDb } from './db.ts';
import { ObjectStore } from './store.ts';
import { JobRunner } from './jobs.ts';
import { buildApp } from './routes.ts';
import { seedFeatured } from './seed.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');

await initSimulator();
const db = openDb(DATA_DIR);
const store = new ObjectStore(resolve(DATA_DIR, 'store'));
const runner = new JobRunner(db, store);
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

const app = buildApp({ db, store, runner, modelStatus });
seedFeatured(db, runner);
serve({ fetch: app.fetch, port: PORT }, () => console.log(`[api] ProtoLab API on http://localhost:${PORT} (data: ${DATA_DIR})`));

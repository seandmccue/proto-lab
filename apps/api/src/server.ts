import 'dotenv/config';
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { initSimulator } from '@protolab/simulator';
import { modelConfigFromEnv, smokeTest, DETERMINISTIC_MODEL_ID } from '@protolab/agent';
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
const modelStatus = { modelId: cfg ? cfg.model : DETERMINISTIC_MODEL_ID, live: false, detail: cfg ? 'checking…' : 'No LLM_API_KEY set; using the deterministic planner.' };
if (cfg) {
  const r = await smokeTest(cfg);
  modelStatus.live = r.ok;
  modelStatus.detail = r.ok ? `Live tool-call smoke test passed against ${cfg.baseUrl}` : `Model smoke test failed: ${r.detail}`;
  console.log(`[model] ${cfg.model} — ${modelStatus.detail}`);
  if (!r.ok) console.warn('[model] Falling back to the deterministic planner for new jobs.');
  if (!r.ok) process.env.LLM_API_KEY = '';
} else console.log('[model] No LLM_API_KEY; deterministic planner.');

const app = buildApp({ db, store, runner, modelStatus });
seedFeatured(db, runner);
serve({ fetch: app.fetch, port: PORT }, () => console.log(`[api] ProtoLab API on http://localhost:${PORT} (data: ${DATA_DIR})`));

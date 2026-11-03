// Dev runner: node packages/agent/src/cli.ts "<prompt>" [--planner]
// Uses MODEL_API_KEY / MODEL_ID from the repo-root .env (or the environment); --planner forces the deterministic planner.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgent, modelConfigFromEnv } from './index.ts';

const envPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const args = process.argv.slice(2);
const planner = args.includes('--planner');
const prompt = args.filter((a) => !a.startsWith('--'))[0] ?? 'Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.';
const model = planner ? null : modelConfigFromEnv();
console.log(`[cli] model: ${model ? `${model.model} @ ${model.baseUrl}` : 'deterministic planner'}`);
let n = 0;
const t0 = Date.now();
const out = await runAgent({ prompt, inventionId: 'cli', model, newVersionId: () => `v${++n}` }, (e) => {
  if (e.type === 'status') console.log(`[status] ${e.message}`);
  if (e.type === 'tool') console.log(`[${e.entry.ok ? 'ok' : 'ERR'}] ${e.entry.tool}: ${e.entry.summary}`);
  if (e.type === 'error') console.log(`[error] ${e.message}`);
});
console.log(`[done] ${out.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${out.summary}`);
for (const v of out.versions) console.log(`  ${v.id} it${v.iteration} ${v.status} ${v.tests.map((t) => `${t.testId}:${t.passed ? 'P' : 'F'} d=${t.metrics.distance_m}`).join(' ')} | [${v.decisions[0].source}] ${v.decisions[0].summary}`);

// Reliability benchmark: node packages/agent/src/bench.ts [--repeats 4] [--concurrency 4] [--out <dir>] [--planner]
// Runs several prompts × repeats through the real agent and writes results.jsonl + summary.md.
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgent, modelConfigFromEnv, specialistConfigFromEnv, type AgentEvent } from './index.ts';

const envPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const repeats = Number(arg('repeats', '4'));
const concurrency = Number(arg('concurrency', '4'));
const outDir = resolve(arg('out', resolve(import.meta.dirname, '../../../bench-results')));
const planner = process.argv.includes('--planner');
mkdirSync(outDir, { recursive: true });

export const GENERAL_PROMPTS = [
  { id: 'butterfly', prompt: 'Build a mechanical butterfly with large shaped wings that flap on a stand.' },
  { id: 'ferris', prompt: 'Build a miniature Ferris wheel with eight hanging gondolas that turns steadily on a tower.' },
  { id: 'muse', prompt: 'Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.' },
  { id: 'catapult', prompt: 'Build a tabletop catapult that launches a miniature foam pizza about half a metre toward a target.' },
  { id: 'crab', prompt: 'Build a mechanical crab with six legs that scuttles sideways.' },
  { id: 'claw', prompt: 'Build a robotic grabbing claw that picks up a small wooden block and holds it.' },
  { id: 'windmill', prompt: 'Build a windmill with four sails on a tower whose rotor turns.' },
  { id: 'drawbridge', prompt: 'Build an automated drawbridge whose deck raises and lowers on a hinge with an actuator.' },
  { id: 'crane', prompt: 'Build a miniature crane with a boom that lifts and lowers a small load.' },
  { id: 'novel', prompt: 'Build a bird-scaring garden gadget: a spinning pinwheel on a pole with a pendulum that swings below it.' },
];
const only = arg('only', '').split(',').map((x) => x.trim()).filter(Boolean);   // --only crab,catapult
const ALL_PROMPTS = process.argv.includes('--general') ? GENERAL_PROMPTS : [
  { id: 'muse', prompt: 'Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.' },
  { id: 'hexapod', prompt: 'Build a six-legged walking robot that can cover 50 cm in six seconds without tipping.' },
  { id: 'crawler', prompt: 'Design a calm four-legged crawler that walks 25 cm in six seconds with very little body rocking.' },
  { id: 'sprinter', prompt: 'Build a four-legged robot that walks 40 cm in 6 seconds.' },
  { id: 'pet', prompt: 'Design a small quadruped pet robot with big feet that can walk and then dance.' },
];
export const PROMPTS = only.length ? ALL_PROMPTS.filter((p) => only.includes(p.id)) : ALL_PROMPTS;

interface Row { prompt: string; run: number; status: string; seconds: number; iterations: number; walkTests: number; sweeps: number; customParts: number; revisions: number; meaningfulChanges: number; handoffs: number; failedThenPassed: boolean; bestDistance_m: number; modelId: string; specialistUsed: boolean; summary: string; error?: string }

async function one(p: { id: string; prompt: string }, run: number): Promise<Row> {
  const t0 = Date.now();
  let n = 0; let sweeps = 0, custom = 0, revisions = 0, meaningful = 0, handoffs = 0; let error: string | undefined;
  const model = planner ? null : modelConfigFromEnv();
  const specialist = planner ? null : specialistConfigFromEnv();
  const trail: string[] = [];
  const logPath = resolve(outDir, `${p.id}_${run}.log`); writeFileSync(logPath, '');
  const note = (line: string) => { trail.push(line); appendFileSync(logPath, `${new Date().toISOString().slice(11, 19)} ${line}\n`); }; // streamed so a running pass can be watched
  const out = await runAgent({ prompt: p.prompt, inventionId: `bench_${p.id}_${run}`, model, specialist, newVersionId: () => `${p.id}_${run}_v${++n}` }, (e: AgentEvent) => {
    if (e.type === 'tool') { note(`[${e.entry.ok ? 'ok' : 'ERR'}] ${e.entry.tool}: ${e.entry.summary}${e.entry.ok ? '' : ` | args: ${JSON.stringify(e.entry.args ?? null).slice(0, 600)}`}`); // rejected args show which shorthand the normalisers still miss if (e.entry.ok) { if (e.entry.tool === 'sweep_drive' || e.entry.tool === 'sweep_gait') sweeps++; if (e.entry.tool === 'create_part' || e.entry.tool === 'design_part' || e.entry.tool === 'create_parametric_part') custom++; if (e.entry.tool === 'assemble' || e.entry.tool === 'set_drives' || e.entry.tool === 'revise_walker') revisions++; } }
    if (e.type === 'status') note(`[status] ${e.message}`);
    if (e.type === 'handoff') { handoffs++; note(`[handoff] ${e.message}`); }
    if (e.type === 'error') { error = e.message; note(`[error] ${e.message}`); }
    if (e.type === 'done') note(`[done] ${e.status}: ${e.summary}`);
  });
  void trail;
  for (const v of out.versions.slice(1)) if (Object.keys(v.decisions[0]?.changes ?? {}).length > 0 || v.decisions[0]?.basedOn) meaningful++;
  const walks = out.versions.flatMap((v) => v.tests);
  const firstFailIdx = walks.findIndex((t) => !t.passed);
  const failedThenPassed = firstFailIdx >= 0 && walks.slice(firstFailIdx).some((t) => t.passed);
  return {
    prompt: p.id, run, status: out.status, seconds: +((Date.now() - t0) / 1000).toFixed(1), iterations: out.versions.length, walkTests: walks.length, sweeps, customParts: custom, revisions, meaningfulChanges: meaningful, handoffs,
    failedThenPassed, bestDistance_m: Math.max(0, ...walks.map((t) => t.metrics.distance_m ?? t.metrics.landingDistance_m ?? 0)), modelId: out.modelId, specialistUsed: handoffs > 0, summary: out.summary.slice(0, 300), error,
  };
}

const jobs: Array<{ p: typeof PROMPTS[number]; run: number }> = [];
for (let r = 1; r <= repeats; r++) for (const p of PROMPTS) jobs.push({ p, run: r });
const rows: Row[] = [];
const resultsPath = resolve(outDir, 'results.jsonl');
writeFileSync(resultsPath, '');
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const row = await one(j.p, j.run).catch((e) => ({ prompt: j.p.id, run: j.run, status: 'error', seconds: 0, iterations: 0, walkTests: 0, sweeps: 0, customParts: 0, revisions: 0, meaningfulChanges: 0, handoffs: 0, failedThenPassed: false, bestDistance_m: 0, modelId: '?', specialistUsed: false, summary: '', error: (e as Error).message } as Row));
    rows.push(row);
    appendFileSync(resultsPath, JSON.stringify(row) + '\n');
    console.log(`[${rows.length}/${jobs.length}] ${row.prompt}#${row.run} ${row.status} ${row.seconds}s it=${row.iterations} sweeps=${row.sweeps} custom=${row.customParts} handoffs=${row.handoffs} best=${row.bestDistance_m} m${row.error ? ' ERROR ' + row.error.slice(0, 120) : ''}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

const pct = (k: (r: Row) => boolean) => `${Math.round((rows.filter(k).length / rows.length) * 100)} %`;
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const byPrompt = PROMPTS.map((p) => { const rs = rows.filter((r) => r.prompt === p.id); return `| ${p.id} | ${rs.length} | ${rs.filter((r) => r.status === 'passed').length}/${rs.length} | ${med(rs.map((r) => r.seconds))} s | ${(rs.reduce((s, r) => s + r.iterations, 0) / Math.max(1, rs.length)).toFixed(1)} | ${rs.filter((r) => r.specialistUsed).length} |`; }).join('\n');
const md = `# ProtoLab agent benchmark

Model: ${rows[0]?.modelId ?? '?'}${planner ? ' (planner)' : ''} · specialist: ${process.env.MODEL_SPECIALIST_ID ?? 'muse-wonder-1.0'} after ${process.env.MODEL_SPECIALIST_AFTER ?? 3} failures · ${rows.length} runs · ${new Date().toISOString()}

| Metric | Value |
| --- | --- |
| Success rate (walk + requested follow-ups passed) | ${pct((r) => r.status === 'passed')} |
| Errors (API/model) | ${pct((r) => r.status === 'error')} |
| Median completion time | ${med(rows.map((r) => r.seconds))} s |
| Mean iterations (versions) | ${(rows.reduce((s, r) => s + r.iterations, 0) / rows.length).toFixed(1)} |
| Runs with ≥1 meaningful revision citing a measurement | ${pct((r) => r.meaningfulChanges > 0)} |
| Runs that failed a walk test and later passed one | ${pct((r) => r.failedThenPassed)} |
| Runs using sweep_gait | ${pct((r) => r.sweeps > 0)} |
| Runs creating a custom part | ${pct((r) => r.customParts > 0)} |
| Runs escalated to the specialist | ${pct((r) => r.specialistUsed)} |

| Prompt | Runs | Passed | Median time | Mean iterations | Escalations |
| --- | --- | --- | --- | --- | --- |
${byPrompt}

## Runs
| Prompt | # | Status | s | Iter | Sweeps | Custom | Handoffs | Best walk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.prompt} | ${r.run} | ${r.status} | ${r.seconds} | ${r.iterations} | ${r.sweeps} | ${r.customParts} | ${r.handoffs} | ${r.bestDistance_m} m | ${(r.error ?? r.summary).replace(/\|/g, '/').slice(0, 140)} |`).join('\n')}
`;
writeFileSync(resolve(outDir, 'summary.md'), md);
console.log(md);

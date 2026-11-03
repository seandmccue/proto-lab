/**
 * Demo-day preflight: is everything a judge will see actually live?
 *   node scripts/preflight.ts [--api http://localhost:8787] [--web http://localhost:5173]
 * Exit code 0 = go, 1 = something to fix (each line says what).
 */
const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const API = arg('api', 'http://localhost:8787'), WEB = arg('web', 'http://localhost:5173');
let bad = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => { bad++; console.log(`  ✗ ${msg}`); };
const get = async <T>(url: string): Promise<T> => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<T>; };

console.log(`ProtoLab preflight · api ${API} · web ${WEB}`);
// 1. API + model
try {
  const m = await get<{ modelId: string; label: string; live: boolean; detail: string }>(`${API}/api/model`);
  if (m.live) ok(`${m.label} (live tool-call smoke test passed)`); else fail(`model not live: ${m.detail}`);
  if (!/^muse-/.test(m.modelId)) fail(`model id is ${m.modelId}, expected a Meta Muse model`);
} catch (e) { fail(`API unreachable at ${API}: ${(e as Error).message} — run npm run dev`); }
// 2. featured builds
try {
  const g = await get<{ items?: Array<{ id: string; title: string; status: string; featured?: boolean; modelId?: string }> } | Array<{ id: string; title: string; status: string; featured?: boolean; modelId?: string }>>(`${API}/api/gallery?limit=50`);
  const items = Array.isArray(g) ? g : g.items ?? [];
  const featured = items.filter((i) => i.featured);
  if (featured.length < 4) fail(`${featured.length} featured inventions (want 4: walker, butterfly, Ferris wheel, catapult)`); else ok(`${featured.length} featured inventions`);
  for (const f of featured) { if (f.status === 'passed') ok(`featured "${f.title}" passed (${f.modelId ?? 'model n/a'})`); else fail(`featured "${f.title}" is ${f.status}`); }
  const remixes = items.filter((i) => /remix/i.test(i.title));
  if (remixes.length) ok(`${remixes.length} public remix(es) in the gallery`); else console.log('  · no public remix in the gallery (optional, but a nice lineage demo)');
} catch (e) { fail(`gallery: ${(e as Error).message}`); }
// 3. nothing stuck
try {
  const ex = await get<{ examples: Array<{ id: string }> }>(`${API}/api/examples`);
  ok(`${ex.examples.length} example briefs on the homepage`);
} catch (e) { fail(`examples: ${(e as Error).message}`); }
// 4. web
try {
  const r = await fetch(WEB, { signal: AbortSignal.timeout(10000) }); const html = await r.text();
  if (r.ok && /ProtoLab/.test(html)) ok(`web app serving at ${WEB}`); else fail(`web app at ${WEB} answered ${r.status} without the ProtoLab shell`);
} catch (e) { fail(`web app unreachable at ${WEB}: ${(e as Error).message}`); }
// 5. timing reminder
console.log(bad ? `\n${bad} problem(s) to fix before the demo.` : '\nGo: start a Ferris wheel, windmill or butterfly live (1–4 min) and keep a featured build open in a second tab.');
process.exit(bad ? 1 : 0);

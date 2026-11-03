/**
 * Verify a running ProtoLab stack. Add --judge to verify the curated public
 * judge route, saved simulation evidence, and hosted demo video.
 */
import type { TestResult, VersionRecord } from '@protolab/schema';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const api = arg('--api', 'http://localhost:8787');
const web = arg('--web', 'http://localhost:5173');
const judge = process.argv.includes('--judge');
const request = (url: string, init?: RequestInit) => fetch(url, { signal: AbortSignal.timeout(15000), ...init });
const get = async <T>(path: string) => {
  const response = await request(api + path);
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${path}`);
  return await response.json() as T;
};

interface InventionDetail {
  invention: { title: string; visibility: string; status: string; currentVersionId: string; modelId: string; featured: boolean };
  versions: { id: string; iteration: number }[];
  source: { id: string; versionId: string } | null;
}
async function publicBuild(id: string) {
  const detail = await get<InventionDetail>(`/api/inventions/${id}`);
  if (detail.invention.visibility !== 'public' || detail.invention.status !== 'passed') {
    throw new Error(`${detail.invention.title} must be public and passed`);
  }
  return detail;
}
const version = async (id: string, versionId: string) => (
  await get<{ version: VersionRecord }>(`/api/inventions/${id}/versions/${versionId}?trace=1`)
).version;
const recorded = (record: VersionRecord, check: (test: TestResult) => boolean) => (
  record.tests.some((test) => test.trace.frames.length > 1 && check(test))
);

const checks: [string, () => Promise<string>][] = [
  ['Meta Muse', async () => {
    const model = await get<{ modelId: string; label: string; live: boolean; detail: string }>('/api/model');
    if (!model.live || !model.modelId.startsWith('muse-')) throw new Error(model.detail);
    return model.label;
  }],
  ['Featured gallery', async () => {
    const { items } = await get<{ items: { status: string; title: string }[] }>('/api/gallery?sort=featured&limit=24');
    if (items.length < 4) throw new Error(`Expected at least 4 featured inventions, found ${items.length}`);
    const failures = items.filter((item) => item.status !== 'passed');
    if (failures.length) throw new Error(`Featured builds without a pass: ${failures.map(({ title }) => title).join(', ')}`);
    return `${items.length} passing builds`;
  }],
  ['Examples', async () => {
    const { examples } = await get<{ examples: unknown[] }>('/api/examples');
    if (!examples.length) throw new Error('The homepage has no example briefs');
    return `${examples.length} briefs`;
  }],
  ['Web app', async () => {
    const response = await request(web);
    if (!response.ok || !/ProtoLab/.test(await response.text())) throw new Error(`HTTP ${response.status} or missing app shell`);
    return web;
  }],
];

if (judge) checks.push(
  ['Crab comparison', async () => {
    const id = 'inv_633b4887ad7f4cdc';
    const detail = await publicBuild(id);
    const failed = detail.versions.find(({ iteration }) => iteration === 3);
    const passed = detail.versions.find(({ iteration }) => iteration === 4);
    if (!detail.invention.featured || !failed || !passed) throw new Error('Expected featured crab with v3 and v4');
    const [before, after] = await Promise.all([version(id, failed.id), version(id, passed.id)]);
    if (!recorded(before, (test) => test.kind === 'walk' && !test.passed)
      || !recorded(after, (test) => test.kind === 'walk' && test.passed && test.metrics.distance_m >= 0.25 && test.metrics.maxTilt_deg <= 10)) {
      throw new Error('Expected the recorded failed walk and passing revision');
    }
    return 'v3 failed, v4 passed';
  }],
  ['Muse drawing remix', async () => {
    const id = 'inv_76b7fae5bdf941c9';
    const { invention, source } = await publicBuild(id);
    if (source?.id !== 'inv_drawing_automaton' || source.versionId !== 'ver_drawing_automaton_1' || !invention.modelId.startsWith('muse-')) {
      throw new Error('Expected the saved drawing lineage and Muse model');
    }
    const replay = await version(id, invention.currentVersionId);
    if (!recorded(replay, (test) => test.passed && test.metrics['pen_tip.travel_x_m'] >= 0.075 && test.metrics['pen_tip.travel_y_m'] >= 0.04)) {
      throw new Error('Expected measured pen travel on both axes');
    }
    return 'public replay with original lineage';
  }],
  ['Gravity Clock', async () => {
    const { invention } = await publicBuild('inv_a1f1665e649b41c2');
    if (!invention.featured) throw new Error('Expected the clock to be featured');
    return 'public and featured';
  }],
  ['Judge video', async () => {
    const response = await request(web + '/judge-demo.mp4', { headers: { range: 'bytes=0-31' } });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 206 || !response.headers.get('content-type')?.startsWith('video/mp4') || bytes.subarray(4, 8).toString() !== 'ftyp') {
      throw new Error(`Expected an MP4 byte-range response, received HTTP ${response.status}`);
    }
    return 'public MP4 supports range playback';
  }],
);

console.log(`ProtoLab preflight · api ${api} · web ${web}`);
const results = await Promise.allSettled(checks.map(([, check]) => check()));
results.forEach((result, index) => {
  const [label] = checks[index];
  if (result.status === 'fulfilled') console.log(`  ✓ ${label} · ${result.value}`);
  else console.error(`  ✗ ${label} · ${(result.reason as Error).message}`);
});
process.exitCode = results.some(({ status }) => status === 'rejected') ? 1 : 0;

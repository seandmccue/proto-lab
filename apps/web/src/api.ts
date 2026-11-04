import type { Assembly, PartDefinition, VersionRecord } from '@protolab/schema';

export function sessionId(): string {
  try {
    let id = localStorage.getItem('protolab.session');
    if (!id) { id = 'u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('protolab.session', id); }
    return id;
  } catch { return 'anon'; }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Reads retry briefly on network errors and 5xx (the dev proxy returns 500s for a few seconds while the API restarts);
  // writes are never retried here (callers use idempotency keys instead).
  const retriable = !init.method || init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(path, { ...init, headers: { 'x-session-id': sessionId(), ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    } catch (e) {
      if (retriable && attempt < 3) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
      throw e;
    }
    if (res.status >= 500 && retriable && attempt < 3) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json as T;
  }
}

export interface TestSummary { testId: string; kind: string; passed: boolean; metrics: Record<string, number>; failureReasons: string[]; notes?: string[] }
/** Seeds retired from the product; hidden from lists even when an older API still serves them. */
export const RETIRED_TITLES = new Set(['Bring My Muse to Life']);
export const RETIRED_EXAMPLE_IDS = new Set(['muse']);
export const isRetired = (item: { title: string }) => RETIRED_TITLES.has(item.title);

export interface InventionPublic { latestWalk: TestSummary | null; latestDance: TestSummary | null; latestTest: TestSummary | null; id: string; title: string; description: string; prompt: string; visibility: 'private' | 'public'; status: string; currentVersionId: string | null; featured: boolean; isOwner: boolean; ownerLabel: string; sourceInventionId: string | null; parentVersionId: string | null; modelId: string | null; tests: TestSummary[]; previewUrl: string | null; createdAt: string; updatedAt: string }
export interface VersionMeta { id: string; iteration: number; status: string; modelId: string; parentVersionId: string | null; createdAt: string; tests: TestSummary[]; spec: VersionRecord['spec'] }
export interface InventionDetail { invention: InventionPublic; versions: VersionMeta[]; latestJob?: { id: string; status: string; step: string; versionId?: string | null; baselineVersionId?: string | null; changeRequest?: string | null }; source: { id: string; title: string; ownerLabel: string; versionId?: string | null; changeRequest?: string | null } | null }
export type JobEvent = { t: string; type: string; [k: string]: unknown };
export interface JobStatus { id: string; inventionId: string; status: 'queued' | 'running' | 'done' | 'error'; step: string; versionId: string | null; errorCode: string | null; events: JobEvent[]; eventCount: number }
export interface ModelInfo { modelId: string; label: string; live: boolean; detail: string }
export interface Example { id: string; title: string; prompt: string; blurb: string }
export type CatalogPart = Omit<PartDefinition, 'connectors' | 'decorative' | 'meshUrl'>;

export const api = {
  model: () => req<ModelInfo>('/api/model'),
  load: () => req<{ active: number; queued: number; maxConcurrent: number }>('/api/load'),
  part: (id: string) => req<{ part: PartDefinition }>(`/api/parts/${encodeURIComponent(id)}`),
  parts: () => req<{ parts: CatalogPart[] }>('/api/parts'),
  examples: () => req<{ examples: Example[] }>('/api/examples'),
  create: (body: { prompt?: string; exampleId?: string }) => req<{ inventionId: string; jobId: string }>('/api/inventions', { method: 'POST', body: JSON.stringify(body), headers: { 'idempotency-key': Math.random().toString(36).slice(2, 18) } }),
  job: (id: string, since = 0) => req<JobStatus>(`/api/jobs/${id}?since=${since}`),
  jobAssembly: (id: string) => req<{ assembly: Assembly; iteration: number; rationale: string; at: string }>(`/api/jobs/${id}/assembly`),
  invention: (id: string) => req<InventionDetail>(`/api/inventions/${id}`),
  version: (id: string, vid: string, trace = true) => req<{ version: VersionRecord }>(`/api/inventions/${id}/versions/${vid}?trace=${trace ? 1 : 0}`),
  remix: (id: string, changeRequest: string, versionId?: string) => req<{ inventionId: string; jobId: string }>(`/api/inventions/${id}/remix`, { method: 'POST', body: JSON.stringify({ changeRequest, versionId }) }),
  followUp: (id: string, changeRequest: string, versionId?: string) => req<{ inventionId: string; jobId: string }>(`/api/inventions/${id}/follow-up`, { method: 'POST', body: JSON.stringify({ changeRequest, versionId }) }),
  publish: (id: string, body: { title?: string; description?: string }) => req<{ ok: true; invention: InventionPublic }>(`/api/inventions/${id}/publish`, { method: 'POST', body: JSON.stringify(body) }),
  explain: (id: string, vid: string) => req<{ text: string; modelId: string }>(`/api/inventions/${id}/versions/${vid}/explain`, { method: 'POST', body: '{}' }),
  preview: (id: string, png: Blob) => fetch(`/api/inventions/${id}/preview`, { method: 'POST', body: png, headers: { 'x-session-id': sessionId(), 'content-type': 'image/png' } }),
  gallery: (sort: 'recent' | 'featured' | 'remixes', limit = 12, cursor = 0) => req<{ items: InventionPublic[]; nextCursor: number | null }>(`/api/gallery?sort=${sort}&limit=${limit}&cursor=${cursor}`),
  mine: (cursor = 0) => req<{ items: InventionPublic[]; nextCursor?: number | null }>(`/api/mine?cursor=${cursor}`),
  report: (inventionId: string, reason: string) => req<{ ok: true }>('/api/reports', { method: 'POST', body: JSON.stringify({ inventionId, reason }) }),
};

export const fmt = {
  cm: (v: number) => `${(v * 100).toFixed(1)} cm`,
  m: (v: number) => `${(v * 1000).toFixed(0)} mm`,
  m2: (v: number) => `${v.toFixed(3)} m`,
  deg: (v: number) => `${v.toFixed(1)}°`,
  kg: (v: number) => v < 0.1 ? `${(v * 1000).toFixed(0)} g` : `${v.toFixed(3)} kg`,
  nm: (v: number) => `${v.toFixed(2)} N·m`,
  pct: (v: number) => `${(v * 100).toFixed(0)} %`,
};

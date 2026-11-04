import { sessionId } from './api.ts';

export type BuildBody = { prompt?: string; exampleId?: string };
export interface BuildRequestSnapshot {
  requestId: string;
  body: BuildBody;
  jobId: string | null;
  inventionId: string | null;
  status: 'starting' | 'saving' | 'saved' | 'retryable-error' | 'rejected';
  error: string | null;
}
interface StoredRequest extends BuildRequestSnapshot { owner: string }
interface Entry {
  owner: string;
  snapshot: BuildRequestSnapshot;
  listeners: Set<() => void>;
  run?: { pending: boolean };
}
interface Options {
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  owner: () => string;
  fetch: typeof fetch;
  requestId?: () => string;
  pollIntervalMs?: number;
}

const prefix = 'protolab.build-request.';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(id);
const validInvention = (id: unknown): id is string => typeof id === 'string' && /^inv_[a-zA-Z0-9_-]+$/.test(id);
const statuses = new Set<BuildRequestSnapshot['status']>(['starting', 'saving', 'saved', 'retryable-error', 'rejected']);

/** A live job receipt is distinct from the durable acknowledgement of its create POST. */
export function createBuildRequestManager(options: Options) {
  const entries = new Map<string, Entry>();
  const currentOwner = () => options.owner().slice(0, 64);
  const save = (entry: Entry) => {
    options.storage()?.setItem(prefix + entry.snapshot.requestId, JSON.stringify({ ...entry.snapshot, owner: entry.owner }));
  };
  const change = (entry: Entry, patch: Partial<BuildRequestSnapshot>) => {
    entry.snapshot = { ...entry.snapshot, ...patch };
    // The original request was persisted before sending. If storage later fills,
    // reloading that original request still retries the same idempotency key.
    try { save(entry); } catch { /* Keep the live result and its original recovery record. */ }
    for (const listener of entry.listeners) listener();
  };
  const get = (id: string): Entry | undefined => {
    if (!validId(id)) return;
    let entry = entries.get(id);
    if (!entry) {
      try {
        const stored = options.storage()?.getItem(prefix + id);
        if (!stored) return;
        const value = JSON.parse(stored) as StoredRequest;
        if (value.requestId !== id || value.owner !== currentOwner() || !statuses.has(value.status) ||
          !value.body || typeof value.body !== 'object' ||
          (value.body.prompt !== undefined && typeof value.body.prompt !== 'string') ||
          (value.body.exampleId !== undefined && typeof value.body.exampleId !== 'string') ||
          (value.jobId !== null && (typeof value.jobId !== 'string' || !/^job_[a-f0-9]{32}$/.test(value.jobId))) ||
          (value.inventionId !== null && !validInvention(value.inventionId))) return;
        const { owner, ...snapshot } = value;
        // Refresh is an explicit recovery attempt. The old document may have
        // persisted its aborted fetch as an error during navigation; a new
        // document retries that same key once, while in-memory errors stay put.
        if (snapshot.status === 'retryable-error') {
          snapshot.status = snapshot.inventionId ? 'saving' : 'starting';
          snapshot.error = null;
        }
        entry = { owner, snapshot, listeners: new Set() };
        entries.set(id, entry);
      } catch { return; }
    }
    return entry.owner === currentOwner() ? entry : undefined;
  };

  const prepare = (body: BuildBody): string => {
    const owner = currentOwner();
    const storage = options.storage();
    if (!owner || owner === 'anon' || owner === 'protolab' || !storage) throw new Error('Browser storage is required to safely start your build. Enable it and try again.');
    const requestId = options.requestId?.() ?? crypto.randomUUID();
    if (!validId(requestId)) throw new Error('Could not prepare a build request. Please try again.');
    const snapshot: BuildRequestSnapshot = { requestId, body: { ...body }, jobId: null, inventionId: null, status: 'starting', error: null };
    const entry: Entry = { owner, snapshot, listeners: new Set() };
    // Fail before any POST if we cannot retain the retry key and original brief.
    storage.setItem(prefix + requestId, JSON.stringify({ ...snapshot, owner }));
    entries.set(requestId, entry);
    return requestId;
  };

  const start = (id: string): void => {
    const entry = get(id);
    if (!entry || entry.run?.pending || entry.snapshot.status === 'saved' || entry.snapshot.status === 'rejected' || entry.snapshot.status === 'retryable-error') return;
    const run = { pending: true };
    entry.run = run;
    const headers = { 'x-session-id': entry.owner, 'content-type': 'application/json', 'idempotency-key': id };
    const sameOwner = () => entry.owner === currentOwner();
    const observe = async (jobId: string) => {
      // A 404 before the POST has inserted its rows is expected, not a missing invention.
      do {
        if (entry.run !== run || !sameOwner() || ['saved', 'rejected'].includes(entry.snapshot.status)) return;
        try {
          const response = await options.fetch(`/api/jobs/${jobId}`, {
            headers: { 'x-session-id': entry.owner }, cache: 'no-store', signal: AbortSignal.timeout(12_000),
          });
          if (response.ok) {
            const job = await response.json() as { id?: string; inventionId?: string };
            if (entry.run !== run || !sameOwner() || ['saved', 'rejected'].includes(entry.snapshot.status)) return;
            if (job.id === jobId && validInvention(job.inventionId)) {
              change(entry, { inventionId: job.inventionId, status: entry.snapshot.status === 'starting' ? 'saving' : entry.snapshot.status });
              return;
            }
          }
        } catch { /* The POST may still succeed; its acknowledgement decides save status. */ }
        if (!run.pending) return;
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 650));
      } while (entry.run === run);
    };
    void (async () => {
      try {
        // Match the server's owner-scoped key exactly; never expose the owner in a URL.
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([entry.owner, id])));
        const jobId = 'job_' + Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
        if (!sameOwner()) throw new Error('Your browser session changed. Return to the original session to recover this build.');
        change(entry, { jobId });
        const posting = options.fetch('/api/inventions', { method: 'POST', headers, body: JSON.stringify(entry.snapshot.body), signal: AbortSignal.timeout(300_000) });
        void observe(jobId);
        const response = await posting;
        const body = await response.json().catch(() => ({})) as { inventionId?: string; jobId?: string; error?: string };
        if (!response.ok) {
          const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
          change(entry, { status: rejected ? 'rejected' : 'retryable-error', error: body.error || `Could not confirm the build was saved (HTTP ${response.status}).` });
          return;
        }
        if (!validInvention(body.inventionId) || body.jobId !== jobId) throw new Error('The save confirmation was incomplete. Retry safely with the same build request.');
        change(entry, { inventionId: body.inventionId, jobId, status: 'saved', error: null });
      } catch (error) {
        change(entry, { status: 'retryable-error', error: error instanceof Error ? error.message : 'The connection was interrupted before the save was confirmed.' });
      } finally {
        run.pending = false;
      }
    })();
  };

  return {
    prepare,
    getSnapshot(id: string): BuildRequestSnapshot | null { return get(id)?.snapshot ?? null; },
    subscribe(id: string, listener: () => void): () => void {
      const entry = get(id);
      entry?.listeners.add(listener);
      return () => { entry?.listeners.delete(listener); };
    },
    start,
    retry(id: string) {
      const entry = get(id);
      if (!entry || entry.run?.pending || entry.snapshot.status !== 'retryable-error') return;
      change(entry, { status: entry.snapshot.inventionId ? 'saving' : 'starting', error: null });
      start(id);
    },
  };
}

export const buildRequests = createBuildRequestManager({
  storage: () => { try { return window.sessionStorage; } catch { return null; } },
  owner: sessionId,
  fetch: (...args) => fetch(...args),
});
export const prepareBuild = buildRequests.prepare;

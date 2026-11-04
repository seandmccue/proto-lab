import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createBuildRequestManager } from '../src/buildRequests.ts';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const OWNER = 'private-owner-fixture';
const KEY = 'stable-build-request-fixture';
const JOB = `job_${createHash('sha256').update(JSON.stringify([OWNER, KEY])).digest('hex').slice(0, 32)}`;
const INVENTION = 'inv_new_fixture';
const body = { prompt: 'Build a private kinetic flower' };
const created = () => Response.json({ inventionId: INVENTION, jobId: JOB }, { status: 201 });
const job = () => Response.json({ id: JOB, inventionId: INVENTION, status: 'running', step: 'Building', events: [] });
const missing = () => Response.json({ error: 'Not found' }, { status: 404 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Manager = ReturnType<typeof createBuildRequestManager>;
type Snapshot = NonNullable<ReturnType<Manager['getSnapshot']>>;
function observe(manager: Manager, id: string, predicate: (snapshot: Snapshot) => boolean): Promise<Snapshot> {
  const current = manager.getSnapshot(id);
  if (current && predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Request snapshot did not reach expected state')); }, 3000);
    const check = () => {
      const snapshot = manager.getSnapshot(id);
      if (!snapshot || !predicate(snapshot)) return;
      clearTimeout(timer); unsubscribe(); resolve(snapshot);
    };
    unsubscribe = manager.subscribe(id, check);
    check();
  });
}

function transport() {
  const calls: Request[] = [];
  const listeners: (() => void)[] = [];
  const api = {
    calls,
    postSignals: [] as (AbortSignal | null | undefined)[],
    post: async (): Promise<Response> => created(),
    get: async (): Promise<Response> => missing(),
    waitFor: (predicate: (calls: Request[]) => boolean) => {
      if (predicate(calls)) return Promise.resolve();
      return new Promise<void>(resolve => { listeners.push(() => { if (predicate(calls)) resolve(); }); });
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), 'https://app.test'), init);
      calls.push(request);
      if (request.method === 'POST') api.postSignals.push(init?.signal);
      for (const listener of listeners) listener();
      return request.method === 'POST' ? api.post() : api.get();
    }) as typeof fetch,
  };
  return api;
}
function manager(storage: MemoryStorage, api: ReturnType<typeof transport>, owner = () => OWNER) {
  return createBuildRequestManager({ storage: () => storage, owner, fetch: api.fetch, requestId: () => KEY, pollIntervalMs: 1 });
}
const posts = (api: ReturnType<typeof transport>) => api.calls.filter(request => request.method === 'POST');

test('preparation is synchronous and owner-scoped; private data never enters polling URLs', async () => {
  const storage = new MemoryStorage(), api = transport();
  let owner = OWNER;
  const requests = manager(storage, api, () => owner);
  const id = requests.prepare(body);
  assert.equal(id, KEY);
  assert.deepEqual(requests.getSnapshot(id)?.body, body);
  assert.equal(api.calls.length, 0, 'preparation does not issue a network request');
  assert.ok(storage.length > 0, 'the retry key/body must be written before returning');
  assert.ok([...storage.values.values()].some(value => value.includes(body.prompt) && value.includes(KEY) && value.includes(OWNER)));
  owner = 'another-owner-fixture';
  assert.equal(requests.getSnapshot(id), null);
  const other = manager(storage, api, () => owner);
  assert.equal(other.getSnapshot(id), null);
  assert.equal(api.calls.length, 0, 'a different owner cannot resume the saved request');
  owner = OWNER;
  requests.start(id);
  await observe(requests, id, snapshot => snapshot.status === 'saved');
  assert.equal(posts(api).length, 1);
  assert.equal(posts(api)[0].headers.get('idempotency-key'), KEY);
  assert.equal(posts(api)[0].headers.get('x-session-id'), OWNER);
  for (const request of api.calls) {
    assert.equal(request.url.includes(OWNER), false);
    assert.equal(request.url.includes(body.prompt), false);
  }
});

test('GET discovers the workbench during a held POST, but only durable POST success becomes saved', async (t) => {
  const storage = new MemoryStorage(), api = transport(), save = deferred<Response>();
  t.after(() => save.resolve(created()));
  api.post = () => save.promise;
  let gets = 0;
  api.get = async () => ++gets === 1 ? missing() : job();
  const requests = manager(storage, api), id = requests.prepare(body);
  requests.start(id); requests.start(id);
  const discovered = await observe(requests, id, snapshot => snapshot.inventionId === INVENTION);
  assert.equal(discovered.status, 'saving');
  assert.equal(discovered.jobId, JOB);
  assert.equal(posts(api).length, 1, 'StrictMode-style duplicate starts must share one submission');
  assert.ok(api.postSignals[0] instanceof AbortSignal, 'the create POST must have a bounded timeout signal');
  assert.ok(gets >= 2, '404 while submission is pending must be polled again');
  const get = api.calls.find(request => request.method === 'GET')!;
  assert.equal(new URL(get.url).pathname, `/api/jobs/${JOB}`);
  assert.equal(get.headers.get('x-session-id'), OWNER);
  save.resolve(created());
  const saved = await observe(requests, id, snapshot => snapshot.status === 'saved');
  assert.equal(saved.inventionId, INVENTION);
  assert.equal(saved.error, null);
});

for (const failure of ['503', 'network'] as const) test(`${failure} keeps the request retryable and explicit retry reuses its original key and body`, async (t) => {
  const storage = new MemoryStorage(), api = transport(), first = deferred<Response>(), second = deferred<Response>();
  t.after(() => { first.resolve(created()); second.resolve(created()); });
  api.get = async () => job();
  let attempts = 0;
  api.post = () => ++attempts === 1 ? first.promise : second.promise;
  const requests = manager(storage, api), id = requests.prepare(body);
  requests.start(id);
  await observe(requests, id, snapshot => snapshot.inventionId === INVENTION);
  if (failure === '503') first.resolve(Response.json({ error: 'Cloud storage is temporarily unavailable' }, { status: 503 }));
  else first.reject(new TypeError('Network disconnected'));
  const failed = await observe(requests, id, snapshot => snapshot.status === 'retryable-error');
  assert.equal(failed.inventionId, INVENTION, 'keep the known creation accessible');
  assert.ok(failed.error);
  requests.start(id);
  assert.equal(attempts, 1, 'the same document must not automatically resubmit a failed save');
  requests.retry(id); requests.start(id);
  await api.waitFor(calls => calls.filter(request => request.method === 'POST').length === 2);
  second.resolve(created());
  await observe(requests, id, snapshot => snapshot.status === 'saved');
  assert.equal(attempts, 2);
  for (const request of posts(api)) {
    assert.equal(request.headers.get('idempotency-key'), KEY);
    assert.deepEqual(await request.clone().json(), body);
  }
});

test('a reload resumes a prepared request with the persisted key instead of creating another invention', async () => {
  const storage = new MemoryStorage(), firstApi = transport();
  const first = manager(storage, firstApi), id = first.prepare(body);
  const resumedApi = transport(), resumed = manager(storage, resumedApi);
  resumed.getSnapshot(id);
  resumed.start(id); resumed.start(id);
  await observe(resumed, id, snapshot => snapshot.status === 'saved');
  assert.equal(firstApi.calls.length, 0);
  assert.equal(posts(resumedApi).length, 1);
  assert.equal(posts(resumedApi)[0].headers.get('idempotency-key'), KEY);
  assert.deepEqual(await posts(resumedApi)[0].clone().json(), body);
  const savedReloadApi = transport(), savedReload = manager(storage, savedReloadApi);
  assert.equal(savedReload.getSnapshot(id)?.status, 'saved');
  savedReload.start(id);
  assert.equal(savedReloadApi.calls.length, 0);
});

test('a reload during saving retains the discovered invention and resends only the original create key', async (t) => {
  const storage = new MemoryStorage(), originalApi = transport(), originalSave = deferred<Response>();
  t.after(() => originalSave.resolve(created()));
  originalApi.post = () => originalSave.promise;
  originalApi.get = async () => job();
  const original = manager(storage, originalApi), id = original.prepare(body);
  original.start(id);
  await observe(original, id, snapshot => snapshot.status === 'saving');
  const resumedApi = transport(), resumed = manager(storage, resumedApi);
  assert.equal(resumed.getSnapshot(id)?.inventionId, INVENTION);
  assert.equal(resumed.getSnapshot(id)?.status, 'saving');
  resumed.start(id); resumed.start(id);
  await observe(resumed, id, snapshot => snapshot.status === 'saved');
  assert.equal(posts(resumedApi).length, 1);
  assert.equal(posts(resumedApi)[0].headers.get('idempotency-key'), KEY);
  assert.deepEqual(await posts(resumedApi)[0].clone().json(), body);
  originalSave.resolve(created());
  await observe(original, id, snapshot => snapshot.status === 'saved');
});

test('a resumed pending request discovers a recreated invention before its durable POST finishes', async (t) => {
  const storage = new MemoryStorage(), originalApi = transport(), originalSave = deferred<Response>();
  const resumedApi = transport(), resumedSave = deferred<Response>();
  t.after(() => { originalSave.resolve(created()); resumedSave.resolve(Response.json({ inventionId: 'inv_recreated', jobId: JOB })); });
  originalApi.post = () => originalSave.promise;
  originalApi.get = async () => job();
  const original = manager(storage, originalApi), id = original.prepare(body);
  original.start(id);
  await observe(original, id, snapshot => snapshot.status === 'saving');
  resumedApi.post = () => resumedSave.promise;
  resumedApi.get = async () => Response.json({ id: JOB, inventionId: 'inv_recreated' });
  const resumed = manager(storage, resumedApi);
  assert.equal(resumed.getSnapshot(id)?.inventionId, INVENTION);
  resumed.start(id);
  const recovered = await observe(resumed, id, snapshot => snapshot.inventionId === 'inv_recreated');
  assert.equal(recovered.status, 'saving');
  assert.equal(recovered.jobId, JOB);
  assert.equal(posts(resumedApi)[0].headers.get('idempotency-key'), KEY);
  resumedSave.resolve(Response.json({ inventionId: 'inv_recreated', jobId: JOB }));
  await observe(resumed, id, snapshot => snapshot.status === 'saved');
});

test('reload recovers once with the same key after the old document records its aborted POST', async () => {
  const storage = new MemoryStorage(), originalApi = transport();
  originalApi.post = async () => { throw new TypeError('Failed to fetch'); };
  const original = manager(storage, originalApi), id = original.prepare(body);
  original.start(id);
  await observe(original, id, snapshot => snapshot.status === 'retryable-error');
  original.start(id);
  assert.equal(posts(originalApi).length, 1, 'the current document must not loop after an error');
  const resumedApi = transport(), resumed = manager(storage, resumedApi);
  assert.equal(resumed.getSnapshot(id)?.status, 'starting');
  resumed.start(id); resumed.start(id);
  await observe(resumed, id, snapshot => snapshot.status === 'saved');
  assert.equal(posts(resumedApi).length, 1);
  assert.equal(posts(resumedApi)[0].headers.get('idempotency-key'), KEY);
  assert.deepEqual(await posts(resumedApi)[0].clone().json(), body);
});

test('a delayed observation from an earlier failed attempt cannot overwrite a newer saved receipt', async (t) => {
  const storage = new MemoryStorage(), api = transport(), staleObservation = deferred<Response>();
  t.after(() => staleObservation.resolve(job()));
  let gets = 0, attempts = 0;
  api.get = () => ++gets === 1 ? staleObservation.promise : Promise.resolve(job());
  api.post = async () => ++attempts === 1 ? Response.json({ error: 'Try again' }, { status: 503 }) : created();
  const requests = manager(storage, api), id = requests.prepare(body);
  requests.start(id);
  await observe(requests, id, snapshot => snapshot.status === 'retryable-error');
  requests.retry(id);
  await observe(requests, id, snapshot => snapshot.status === 'saved');
  staleObservation.resolve(Response.json({ id: JOB, inventionId: 'inv_stale_receipt' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.getSnapshot(id)?.inventionId, INVENTION);
  assert.equal(requests.getSnapshot(id)?.status, 'saved');
  assert.equal(posts(api).length, 2);
});

test('a delayed GET from the same attempt cannot replace the durable POST mapping', async (t) => {
  const storage = new MemoryStorage(), api = transport(), observation = deferred<Response>();
  t.after(() => observation.resolve(job()));
  api.get = () => observation.promise;
  const requests = manager(storage, api), id = requests.prepare(body);
  requests.start(id);
  const saved = await observe(requests, id, snapshot => snapshot.status === 'saved');
  assert.equal(saved.inventionId, INVENTION);
  assert.equal(saved.jobId, JOB);
  assert.equal(api.calls.filter(request => request.method === 'GET').length, 1);
  observation.resolve(Response.json({ id: JOB, inventionId: 'inv_old_observation' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.getSnapshot(id)?.inventionId, INVENTION);
  assert.equal(requests.getSnapshot(id)?.jobId, JOB);
  assert.equal(requests.getSnapshot(id)?.status, 'saved');
  assert.equal(posts(api).length, 1);
});

test('unavailable or full browser storage fails preparation before any network request', () => {
  const api = transport();
  const absent = createBuildRequestManager({ storage: () => null, owner: () => OWNER, fetch: api.fetch, requestId: () => KEY });
  assert.throws(() => absent.prepare(body), /storage/i);
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('Storage quota exceeded'); };
  const full = manager(storage, api);
  assert.throws(() => full.prepare(body), /quota/);
  assert.equal(full.getSnapshot(KEY), null);
  assert.equal(api.calls.length, 0);
});

for (const status of [400, 403, 429]) test(`definitive HTTP ${status} rejects the request without automatic retry`, async () => {
  const storage = new MemoryStorage(), api = transport();
  api.post = async () => Response.json({ error: `Rejected ${status}` }, { status });
  const requests = manager(storage, api), id = requests.prepare(body);
  requests.start(id);
  const rejected = await observe(requests, id, snapshot => snapshot.status === 'rejected');
  assert.match(rejected.error!, new RegExp(String(status)));
  requests.start(id);
  const reloaded = manager(storage, api);
  assert.equal(reloaded.getSnapshot(id)?.status, 'rejected');
  reloaded.start(id);
  assert.equal(posts(api).length, 1);
});

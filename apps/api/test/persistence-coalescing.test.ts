import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { CloudCheckpoint } from '../src/persistence.ts';
import { ObjectStore } from '../src/store.ts';

type Outcome = { status: 'fulfilled' } | { status: 'rejected'; error: unknown };
type Upload = { bytes: Buffer; checkpointId: string; sha256: string; replied: boolean; reply: (status?: number) => void };

async function settled<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Save waiters did not settle for the uploaded batch')), 10_000); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer!); }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'protolab-coalescing-test-'));
  const data = join(root, 'data');
  const db = openDb(data);
  const store = new ObjectStore(join(data, 'store'));
  const uploads: Upload[] = [];
  const waiters = new Map<number, { resolve: (upload: Upload) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const outcomes: Promise<Outcome>[] = [];
  let active = 0, maxActive = 0, published = -1, restoreIndex = -1, closing = false;
  const errors: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'PUT') {
        active++; maxActive = Math.max(maxActive, active);
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const index = uploads.length;
        const upload: Upload = {
          bytes: Buffer.concat(chunks), checkpointId: String(request.headers['x-checkpoint-id']), sha256: String(request.headers['x-checkpoint-sha256']), replied: false,
          reply(status = 204) {
            if (upload.replied) return;
            upload.replied = true;
            if (status === 204) published = index;
            active--;
            response.writeHead(status).end();
          },
        };
        uploads.push(upload);
        const waiter = waiters.get(index);
        if (waiter) { clearTimeout(waiter.timer); waiters.delete(index); waiter.resolve(upload); }
        if (closing) upload.reply(503);
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        const upload = uploads[request.method === 'GET' && restoreIndex >= 0 ? restoreIndex : published];
        if (!upload) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'content-length': upload.bytes.length, 'x-checkpoint-id': upload.checkpointId, 'x-checkpoint-sha256': upload.sha256 });
        response.end(request.method === 'HEAD' ? undefined : upload.bytes);
      } else { response.writeHead(405).end(); }
    } catch (error) { errors.push(error); response.writeHead(500).end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = 'local-coalescing-test-token';
  const checkpoint = new CloudCheckpoint(url, token, data);
  const insert = db.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  return {
    root, data, db, uploads, errors,
    get maxActive() { return maxActive; },
    get published() { return published; },
    writeVersion(revision: number) {
      const id = `ver_${revision}`;
      const key = `versions/${id}.json`;
      store.putJson(key, { id, revision });
      insert.run(id, 'inv_coalescing', null, revision, 'fixture', '{}', key, JSON.stringify({ revision }), 'test', 'passed', '2026-01-01');
      store.putBytes(`previews/${id}.png`, Buffer.from(`saved preview ${revision}`));
      store.putBytes('previews/current.png', Buffer.from(`current preview ${revision}`));
    },
    save(handle = db) {
      let state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
      const outcome = checkpoint.save(handle).then<Outcome, Outcome>(
        () => { state = 'fulfilled'; return { status: 'fulfilled' }; },
        (error) => { state = 'rejected'; return { status: 'rejected', error }; },
      );
      outcomes.push(outcome);
      return { outcome, get state() { return state; } };
    },
    waitForUpload(index: number): Promise<Upload> {
      if (uploads[index]) return Promise.resolve(uploads[index]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(index); reject(new Error(`Timed out waiting for checkpoint upload ${index + 1}`)); }, 10_000);
        waiters.set(index, { resolve, reject, timer });
      });
    },
    async assertSnapshot(index: number, expectedRevisions: number[], currentRevision: number, absentRevisions: number[] = []) {
      restoreIndex = index;
      const restoredDir = join(root, `restored-${index}`);
      await new CloudCheckpoint(url, token, restoredDir).restore();
      const restored = openDb(restoredDir);
      try {
        const rows = restored.prepare('SELECT id, iteration, metrics_json FROM versions ORDER BY iteration').all();
        assert.deepEqual(rows.map(({ iteration }) => iteration), expectedRevisions);
        const restoredStore = new ObjectStore(join(restoredDir, 'store'));
        for (const revision of expectedRevisions) {
          const id = `ver_${revision}`;
          assert.deepEqual(restoredStore.getJson(`versions/${id}.json`), { id, revision });
          assert.equal(rows.find((row) => row.id === id)?.metrics_json, JSON.stringify({ revision }));
          assert.equal(restoredStore.getBytes(`previews/${id}.png`)?.toString(), `saved preview ${revision}`);
        }
        assert.equal(restoredStore.getBytes('previews/current.png')?.toString(), `current preview ${currentRevision}`);
        for (const revision of absentRevisions) {
          assert.equal(restoredStore.has(`versions/ver_${revision}.json`), false);
          assert.equal(restoredStore.has(`previews/ver_${revision}.png`), false);
        }
      } finally { restored.close(); restoreIndex = -1; }
    },
    async close(otherHandles: ReturnType<typeof openDb>[] = []) {
      closing = true;
      for (const upload of uploads) upload.reply(503);
      for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Test fixture closed')); }
      waiters.clear();
      await Promise.all(outcomes);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      for (const handle of otherHandles) handle.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('many saves during one upload share one later capture without early acknowledgment or lost history', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    f.writeVersion(1);
    const first = f.save();
    const firstUpload = await f.waitForUpload(0);
    const queued = [];
    for (let revision = 2; revision <= 8; revision++) { f.writeVersion(revision); queued.push(f.save()); }
    assert.equal(first.state, 'pending');
    assert.ok(queued.every(({ state }) => state === 'pending'));
    assert.equal(f.uploads.length, 1, 'no parallel or premature upload while the first snapshot is in flight');

    firstUpload.reply();
    assert.equal((await first.outcome).status, 'fulfilled');
    const secondUpload = await f.waitForUpload(1);
    assert.ok(queued.every(({ state }) => state === 'pending'), 'the earlier upload cannot acknowledge later mutations');
    f.writeVersion(9); // After the queued snapshot was captured; deliberately not requested for saving.
    secondUpload.reply();
    assert.ok((await settled(Promise.all(queued.map(({ outcome }) => outcome)))).every(({ status }) => status === 'fulfilled'));
    assert.equal(f.uploads.length, 2, 'seven queued callers require one subsequent upload, not seven');
    assert.equal(f.maxActive, 1);
    assert.equal(f.published, 1);
    await f.assertSnapshot(0, [1], 1, [2, 8, 9]);
    await f.assertSnapshot(1, [1, 2, 3, 4, 5, 6, 7, 8], 8, [9]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a failed coalesced batch rejects only its waiters and a later queued snapshot still saves all history', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    f.writeVersion(1);
    const first = f.save();
    const initialUpload = await f.waitForUpload(0);
    const doomed = [];
    for (let revision = 2; revision <= 4; revision++) { f.writeVersion(revision); doomed.push(f.save()); }
    initialUpload.reply();
    assert.equal((await first.outcome).status, 'fulfilled');
    const failedUpload = await f.waitForUpload(1);

    f.writeVersion(5); const laterA = f.save();
    f.writeVersion(6); const laterB = f.save();
    failedUpload.reply(400);
    const failures = await settled(Promise.all(doomed.map(({ outcome }) => outcome)));
    for (const failure of failures) {
      assert.equal(failure.status, 'rejected');
      if (failure.status === 'rejected') assert.match(String(failure.error), /HTTP 400/);
    }
    const recoveryUpload = await f.waitForUpload(2);
    assert.equal(f.published, 0, 'failed publication must retain the last successful checkpoint');
    assert.equal(laterA.state, 'pending');
    assert.equal(laterB.state, 'pending');
    recoveryUpload.reply();
    assert.deepEqual(await settled(Promise.all([laterA.outcome, laterB.outcome])), [{ status: 'fulfilled' }, { status: 'fulfilled' }]);
    assert.equal(f.uploads.length, 3);
    assert.equal(f.maxActive, 1);
    assert.equal(f.published, 2);
    await f.assertSnapshot(1, [1, 2, 3, 4], 4, [5, 6]);
    await f.assertSnapshot(2, [1, 2, 3, 4, 5, 6], 6);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('different database handles keep contiguous queued batches distinct and ordered', { timeout: 20_000 }, async () => {
  const f = await fixture();
  const secondHandle = openDb(f.data);
  try {
    f.writeVersion(1); const initial = f.save();
    const firstUpload = await f.waitForUpload(0);
    f.writeVersion(2); const batchA = f.save();
    f.writeVersion(3); const batchB = f.save(secondHandle);
    f.writeVersion(4); const batchC = f.save();
    firstUpload.reply();
    assert.equal((await initial.outcome).status, 'fulfilled');
    for (const [index, batch] of [[1, batchA], [2, batchB], [3, batchC]] as const) {
      const upload = await f.waitForUpload(index);
      assert.equal(batch.state, 'pending');
      if (index < 3) assert.equal(batchC.state, 'pending');
      upload.reply();
      assert.equal((await batch.outcome).status, 'fulfilled');
    }
    assert.equal(f.uploads.length, 4, 'A/B/A must not coalesce across another database handle');
    assert.equal(f.maxActive, 1);
    await f.assertSnapshot(3, [1, 2, 3, 4], 4);
    assert.deepEqual(f.errors, []);
  } finally { await f.close([secondHandle]); }
});

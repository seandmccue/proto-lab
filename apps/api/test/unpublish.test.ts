import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VersionRecord } from '@protolab/schema';
import { openDb } from '../src/db.ts';
import { JobRunner, versionSummary } from '../src/jobs.ts';
import { buildApp } from '../src/routes.ts';
import { ObjectStore } from '../src/store.ts';

test('unpublish is owner-only, removes public access, and preserves every saved record and file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'protolab-unpublish-'));
  const db = openDb(dir);
  try {
    const store = new ObjectStore(join(dir, 'store'));
    const app = buildApp({ db, store, runner: new JobRunner(db, store), modelStatus: { modelId: 'fixture', live: false, detail: 'test' } });
    const date = '2026-11-03T00:00:00Z';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/j1sAAAAASUVORK5CYII=', 'base64');
    for (const id of ['inv_remove', 'inv_keep']) {
      const version = VersionRecord.parse({
        id: `ver_${id}`, inventionId: id, parentVersionId: null, iteration: 1,
        prompt: 'Move a part', spec: { task: 'Move a part' }, modelId: 'fixture', status: 'failed', createdAt: date,
        assembly: { parts: [], joints: [], instances: [{ id: 'part', partId: 'part', label: 'Part', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } }] },
        tests: [{ testId: 'motion#1', kind: 'motion', passed: false, metrics: { travel_m: 0 }, failureReasons: ['Insufficient travel'], engine: 'fixture',
          trace: { dt: .1, frames: [{ t: 0, bodies: {} }, { t: .1, bodies: {} }] } }], decisions: [], toolLog: [],
      });
      db.prepare(`INSERT INTO inventions (id,owner_id,title,visibility,current_version_id,status,source_invention_id,prompt,featured,created_at,updated_at)
        VALUES (?,'creator',?,'public',?,'failed',?,'Move a part',1,?,?)`).run(id, id, version.id, id === 'inv_remove' ? 'inv_keep' : null, date, date);
      db.prepare(`INSERT INTO versions (id,invention_id,iteration,prompt,spec_json,manifest_key,metrics_json,model_id,status,created_at)
        VALUES (?,?,1,'Move a part',?,?,?,'fixture','failed',?)`).run(version.id, id, JSON.stringify(version.spec), `versions/${version.id}.json`, JSON.stringify(versionSummary(version).tests), date);
      db.prepare("INSERT INTO jobs (id,invention_id,version_id,status,created_at,updated_at) VALUES (?,?,?,'done',?,?)")
        .run(`job_${id}`, id, version.id, date, date);
      db.prepare("INSERT INTO gallery_assets (id,version_id,kind,key,created_at) VALUES (?,?,'thumbnail',?,?)")
        .run(`ga_${id}`, version.id, `previews/${id}.png`, date);
      store.putJson(`versions/${version.id}.json`, version);
      store.putBytes(`previews/${id}.png`, png);
    }
    const tables = ['inventions', 'versions', 'jobs', 'gallery_assets', 'remixes', 'users', 'reports'];
    const records = () => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))]));
    const files = (relative = ''): Record<string, Buffer> => Object.fromEntries(readdirSync(join(dir, 'store', relative), { withFileTypes: true })
      .flatMap((entry): [string, Buffer][] => entry.isDirectory() ? Object.entries(files(join(relative, entry.name))) : [[join(relative, entry.name), readFileSync(join(dir, 'store', relative, entry.name))]]));
    const before = records();
    const beforeFiles = files();
    const path = '/api/inventions/inv_remove';
    const headers = { 'x-session-id': 'creator' };
    const post = (session?: string) => app.request(`${path}/unpublish`, { method: 'POST', headers: session ? { 'x-session-id': session } : {} });

    for (const session of [undefined, 'other', 'protolab', 'anon']) {
      assert.equal((await post(session)).status, 403);
      assert.deepEqual(records(), before, 'unauthorized requests cannot modify any record');
    }
    assert.equal((await app.request('/api/inventions/inv_missing/unpublish', { method: 'POST', headers })).status, 404);
    const response = await post('creator');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.invention.visibility, 'private');
    assert.equal(body.invention.featured, false);
    assert.equal(body.invention.status, 'failed');
    assert.equal(body.invention.currentVersionId, 'ver_inv_remove');
    assert.equal(body.invention.previewUrl, `${path}/preview`);

    for (const url of [path, `${path}/versions/ver_inv_remove`, '/api/jobs/job_inv_remove', '/store/previews/inv_remove.png']) {
      assert.equal((await app.request(url)).status, 404, url);
      assert.equal((await app.request(url, { headers: { 'x-session-id': 'other' } })).status, 404, url);
    }
    for (const sort of ['recent', 'featured', 'remixes']) {
      const gallery = await (await app.request(`/api/gallery?sort=${sort}`)).json();
      assert.ok(!gallery.items.some((item: { id: string }) => item.id === 'inv_remove'), sort);
      if (sort !== 'remixes') assert.ok(gallery.items.some((item: { id: string }) => item.id === 'inv_keep'));
    }
    for (const url of [path, `${path}/versions/ver_inv_remove`, '/api/jobs/job_inv_remove', `${path}/preview`]) {
      assert.equal((await app.request(url, { headers })).status, 200, url);
    }
    const mine = await (await app.request('/api/mine', { headers })).json();
    assert.ok(mine.items.some((item: { id: string }) => item.id === 'inv_remove'));
    const after = records();
    assert.notEqual(after.inventions[0].updated_at, before.inventions[0].updated_at);
    assert.deepEqual(after, { ...before, inventions: [{ ...before.inventions[0], visibility: 'private', featured: 0, updated_at: after.inventions[0].updated_at }, before.inventions[1]] });
    assert.deepEqual(files(), beforeFiles, 'all manifests, traces and thumbnails remain byte-exact');
    assert.equal((await post('creator')).status, 200, 'repeated removal is safe');
    assert.deepEqual(records().versions, before.versions);
    assert.deepEqual(files(), beforeFiles);

    db.prepare("INSERT INTO inventions (id,owner_id,title,status,prompt,created_at,updated_at) VALUES ('inv_empty','creator','Draft','error','Draft',?,?)").run(date, date);
    assert.equal((await app.request('/api/inventions/inv_empty/unpublish', { method: 'POST', headers })).status, 200, 'a saved version is not required to make a draft private');
    assert.equal(db.prepare("SELECT current_version_id FROM inventions WHERE id='inv_empty'").get()?.current_version_id, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

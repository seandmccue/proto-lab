import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VersionRecord } from '@protolab/schema';
import type { LargeShowcase } from '../../large-showcases.mts';
import { curateLargeShowcases } from '../src/curate.ts';
import { openDb } from '../src/db.ts';
import { ObjectStore } from '../src/store.ts';

test('large showcase curation requires the exact public passing Muse version and a finished job', () => {
  const dir = mkdtempSync(join(tmpdir(), 'protolab-curate-'));
  const db = openDb(dir);
  try {
    const store = new ObjectStore(join(dir, 'store'));
    const entry: LargeShowcase = {
      inventionId: 'inv_showcase', versionId: 'ver_showcase', testIds: ['verified#1'], componentCount: 1, detail: 'Verified motion.',
    };
    const date = '2026-11-03T00:00:00Z';
    const model = 'muse-spark-1.3';
    const key = `versions/${entry.versionId}.json`;
    const manifest = VersionRecord.parse({
      id: entry.versionId, inventionId: entry.inventionId, parentVersionId: null, iteration: 1,
      prompt: 'Move a part', spec: { task: 'Move a part' }, modelId: model, status: 'passed', createdAt: date,
      assembly: { parts: [], joints: [], instances: [{ id: 'part', partId: 'part', label: 'Part', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } }] },
      tests: [{ testId: 'verified#1', kind: 'motion', passed: true, metrics: {}, failureReasons: [], engine: 'fixture',
        trace: { dt: .1, frames: [{ t: 0, bodies: {} }, { t: .1, bodies: {} }] } }],
      decisions: [], toolLog: [],
    });
    db.prepare(`INSERT INTO inventions (id, owner_id, title, current_version_id, status, prompt, created_at, updated_at)
      VALUES (?, 'owner', 'Showcase', ?, 'passed', 'Move a part', ?, ?)`).run(entry.inventionId, entry.versionId, date, date);
    db.prepare(`INSERT INTO versions (id, invention_id, iteration, prompt, spec_json, manifest_key, metrics_json, model_id, status, created_at)
      VALUES (?, ?, 1, 'Move a part', '{}', ?, '[]', ?, 'passed', ?)`).run(entry.versionId, entry.inventionId, key, model, date);
    store.putJson(key, manifest);
    assert.equal(curateLargeShowcases(db, store, [entry]), 0, 'private invention');

    db.prepare("UPDATE inventions SET visibility='public' WHERE id=?").run(entry.inventionId);
    assert.equal(curateLargeShowcases(db, store, [{ ...entry, versionId: 'ver_old' }]), 0, 'stale entry');
    assert.equal(curateLargeShowcases(db, store, [{ ...entry, testIds: ['missing#1'] }]), 0, 'missing test');
    assert.equal(curateLargeShowcases(db, store, [{ ...entry, componentCount: 2 }]), 0, 'wrong component count');

    store.putJson(key, { ...manifest, tests: [...manifest.tests, { ...manifest.tests[0], testId: 'failed#1', passed: false }] });
    assert.equal(curateLargeShowcases(db, store, [entry]), 0, 'failed current test');
    store.putJson(key, manifest);
    db.prepare("INSERT INTO jobs (id, invention_id, status, created_at, updated_at) VALUES ('job_showcase', ?, 'running', ?, ?)")
      .run(entry.inventionId, date, date);
    assert.equal(curateLargeShowcases(db, store, [entry]), 0, 'active job');

    db.exec("UPDATE jobs SET status='done' WHERE id='job_showcase'");
    const before = db.prepare('SELECT * FROM inventions WHERE id=?').get(entry.inventionId);
    assert.equal(curateLargeShowcases(db, store, [entry]), 1);
    assert.deepEqual({ ...db.prepare('SELECT * FROM inventions WHERE id=?').get(entry.inventionId) }, { ...before, featured: 1 });
    assert.equal(curateLargeShowcases(db, store, [entry]), 0, 'already curated');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import type { DatabaseSync } from 'node:sqlite';
import type { JobRunner } from './jobs.ts';
import { newId, now } from './jobs.ts';
import type { InventionRow, JobRow } from './db.ts';

export const EXAMPLES = [
  { id: 'muse', title: 'Bring My Muse to Life', prompt: 'Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.', blurb: 'A four-legged robot built from servos and leg bars, tested until it walks, then asked to dance.' },
  { id: 'hexapod', title: 'Six-legged explorer', prompt: 'Build a six-legged walking robot that can cover 50 cm in six seconds without tipping.', blurb: 'A hexapod on a tripod gait with a longer walking target.' },
  { id: 'crawler', title: 'Slow steady crawler', prompt: 'Design a calm four-legged crawler that walks 25 cm in six seconds with very little body rocking.', blurb: 'Same part family, gentler targets.' },
];

/** Seed featured gallery items (owned by ProtoLab) if the gallery is empty. They are built by the real agent, not canned. */
export function seedFeatured(db: DatabaseSync, runner: JobRunner) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM inventions WHERE owner_id=\'protolab\'').get() as { n: number }).n;
  if (count > 0) return;
  for (const ex of EXAMPLES) {
    const inv: InventionRow = { id: newId('inv'), owner_id: 'protolab', title: ex.title, description: '', visibility: 'public', current_version_id: null, status: 'queued', parent_version_id: null, source_invention_id: null, prompt: ex.prompt, featured: 1, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, parent_version_id, source_invention_id, prompt, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(inv.id, inv.owner_id, inv.title, '', 'public', null, 'queued', null, null, inv.prompt, 1, inv.created_at, inv.updated_at);
    const job: JobRow = { id: newId('job'), invention_id: inv.id, version_id: null, status: 'queued', step: 'Queued', progress_json: '[]', error_code: null, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO jobs (id, invention_id, version_id, status, step, progress_json, error_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, job.invention_id, null, 'queued', 'Queued', '[]', null, job.created_at, job.updated_at);
    runner.enqueue(job, inv, { parent: null });
  }
}

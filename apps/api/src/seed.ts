import type { DatabaseSync } from 'node:sqlite';
import type { JobRunner } from './jobs.ts';
import { newId, now } from './jobs.ts';
import type { InventionRow, JobRow } from './db.ts';

const SEED_EXAMPLES = [
  { id: 'butterfly', title: 'Mechanical butterfly', prompt: 'Build a mechanical butterfly with large shaped wings that flap on a stand.', blurb: 'Shaped wing panels on servo-driven hinges; the test measures stroke and rate, not flight.' },
  { id: 'ferris', title: 'Miniature Ferris wheel', prompt: 'Build a miniature Ferris wheel with eight hanging gondolas that turns steadily on a tower.', blurb: 'Tower, spoked wheel, gondolas on pivots; tested for rotation and gondola clearance.' },
  { id: 'catapult', title: 'Pizza catapult', prompt: 'Build a tabletop catapult that launches a miniature foam pizza about half a metre toward a target.', blurb: 'Servo-driven arm with a tray; tested on landing distance.' },
];
export const EXAMPLES = [
  { id: 'windmill', title: 'Four-sail windmill', prompt: 'Build a tabletop windmill with four bright sails on a grounded tower, using up to 12 parts. One motor turns the sails. Measure at least two turns in eight seconds and check that the sails clear the tower and floor.', blurb: 'Four colorful sails turn on a single powered axle.' },
  { ...SEED_EXAMPLES[0], prompt: 'Build a mechanical butterfly with two broad, shaped wings on a grounded perch, using up to 12 parts. Flap both wings together. Measure at least 30 degrees of travel per wing and check that the wings clear the body and each other.', blurb: 'Two shaped wings flap together on a tabletop perch.' },
  { id: 'drawbridge', title: 'Castle drawbridge', prompt: 'Build a tabletop castle drawbridge with a plank deck and two small towers, using up to 12 parts. Use one powered hinge to raise and lower the deck. Measure at least 60 degrees of travel and check that the deck clears the towers and floor.', blurb: 'A single powered hinge raises a plank bridge between two towers.' },
  { id: 'flower', title: 'Clockwork Bloom', prompt: 'Build a tabletop flower with four rounded petals on a grounded stem, using up to 16 parts. Open and close the petals together on powered hinges. Measure at least 35 degrees of travel per petal and check clearance between petals.', blurb: 'Four petals open and close in sync.' },
  { ...SEED_EXAMPLES[1], prompt: 'Build a tabletop Ferris wheel with eight colorful hanging cabins on passive pivots, using up to 20 parts. Drive only the wheel. Measure at least one full turn in eight seconds, check that all cabins stay within 20 degrees of upright, and keep them clear of the stand and floor.', blurb: 'One powered wheel turns while eight cabins hang upright.' },
  { ...SEED_EXAMPLES[2], prompt: 'Build a tabletop catapult with a tray and a loose foam pizza, using up to 12 parts. Launch the pizza toward a target half a metre away. Measure its first landing within 15 cm of that distance.', blurb: 'A powered arm tosses a tiny foam pizza toward a target.' },
  { id: 'crane', title: 'Cargo Crane', prompt: 'Build a tabletop cargo crane with a grounded stand, a powered boom, and a secured block, using up to 12 parts. Raise the block at least 6 cm, keep it within 4 cm of the hook, and return it within 2.5 cm of its starting height.', blurb: 'A hinged boom lifts a secured block and returns it to its starting height.' },
  { id: 'orrery', title: 'Sun and Earth orrery', prompt: 'Build a tabletop Sun and Earth orrery with a fixed Sun and one powered arm carrying a blue Earth, using up to 12 parts. Measure at least one full orbit of Earth around the Sun and check that the two globes stay clear of each other.', blurb: 'A blue Earth circles a golden Sun on a single rotating arm.' },
  { id: 'triplex', title: 'Triplex Pump', prompt: 'Build a tabletop triplex pump mechanism. Use one powered shaft, three eccentric discs offset by 120 degrees, connecting rods, and three passive pistons in linear guides. Give the pistons no drives of their own. Run a motion test that measures shaft rotation and at least 30 mm of linear travel on each piston. Simulate the linkage motion.', blurb: 'Three passive pistons driven by one shaft.' },
];

/** Seed featured gallery items (owned by ProtoLab) if the gallery is empty. They are built by the real agent, not canned. */
export function seedFeatured(db: DatabaseSync, runner: JobRunner) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM inventions WHERE owner_id=\'protolab\'').get() as { n: number }).n;
  if (count > 0) return;
  for (const ex of SEED_EXAMPLES) {
    const inv: InventionRow = { id: newId('inv'), owner_id: 'protolab', title: ex.title, description: '', visibility: 'public', current_version_id: null, status: 'queued', parent_version_id: null, source_invention_id: null, prompt: ex.prompt, featured: 1, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, parent_version_id, source_invention_id, prompt, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(inv.id, inv.owner_id, inv.title, '', 'public', null, 'queued', null, null, inv.prompt, 1, inv.created_at, inv.updated_at);
    const job: JobRow = { id: newId('job'), invention_id: inv.id, version_id: null, status: 'queued', step: 'Queued', progress_json: '[]', error_code: null, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO jobs (id, invention_id, version_id, status, step, progress_json, error_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, job.invention_id, null, 'queued', 'Queued', '[]', null, job.created_at, job.updated_at);
    runner.enqueue(job, inv, { parent: null });
  }
}

/** Seeds that were retired from the product: they stay reachable by link but leave the featured gallery. */
const RETIRED_SEED_TITLES = ['Bring My Muse to Life'];
export function retireSeeds(db: DatabaseSync): number {
  let changed = 0;
  for (const title of RETIRED_SEED_TITLES) {
    changed += Number(db.prepare("UPDATE inventions SET featured=0, updated_at=? WHERE owner_id='protolab' AND title=? AND featured=1").run(now(), title).changes);
  }
  return changed;
}

/** Builds interrupted by a restart (featured or user-owned) that have no version yet are re-queued and rebuilt from scratch. */
export function requeueInterruptedSeeds(db: DatabaseSync, runner: JobRunner) {
  const rows = db.prepare("SELECT i.* FROM inventions i WHERE i.status='error' AND i.current_version_id IS NULL AND EXISTS (SELECT 1 FROM jobs j WHERE j.invention_id=i.id AND j.error_code='interrupted') AND i.source_invention_id IS NULL AND i.created_at > datetime('now', '-1 day')").all() as unknown as InventionRow[];
  for (const inv of rows) {
    const job: JobRow = { id: newId('job'), invention_id: inv.id, version_id: null, status: 'queued', step: 'Queued', progress_json: '[]', error_code: null, created_at: now(), updated_at: now() };
    db.prepare('INSERT INTO jobs (id, invention_id, version_id, status, step, progress_json, error_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(job.id, job.invention_id, null, 'queued', 'Queued', '[]', null, job.created_at, job.updated_at);
    db.prepare('UPDATE inventions SET status=? WHERE id=?').run('queued', inv.id);
    runner.enqueue(job, inv, { parent: null });
  }
  if (rows.length) console.log(`[seed] re-queued ${rows.length} interrupted build(s)`);
}

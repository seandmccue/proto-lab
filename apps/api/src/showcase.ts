import type { DatabaseSync } from 'node:sqlite';
import { Spec, VersionRecord } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { buildTriplexPump, measureTriplexPump, triplexPumpTest } from '@protolab/simulator/triplex-pump';
import { DETERMINISTIC_MODEL_ID } from '@protolab/agent';
import { now, versionSummary } from './jobs.ts';
import type { ObjectStore } from './store.ts';

const pumpId = 'inv_triplex_pump';

/** Save the independently simulated reference mechanism as an inspectable gallery build. */
export async function seedTriplexPump(db: DatabaseSync, store: ObjectStore, persist?: () => Promise<void>) {
  if (db.prepare('SELECT 1 FROM inventions WHERE id=?').get(pumpId)) return;

  const title = 'Triplex pump · one motor, three pistons';
  const prompt = 'Build a tabletop mechanism where one rotating shaft moves three passive pistons in sequence.';
  const spec = Spec.parse({ task: prompt, plan: {
    purpose: 'Demonstrate how one rotary drive can produce three timed linear strokes.',
    features: ['One gearmotor and shaft', 'Three eccentric discs', 'Three piston rods'],
    motions: ['The shaft spins all three eccentrics. Connecting rods push and pull the pistons through their guides.'],
    subassemblies: ['Drive shaft', 'Three crank and slider linkages'],
    successCriteria: ['At least three shaft revolutions', 'At least 30 mm of travel on each piston', 'Piston peaks spaced roughly 120° apart'],
    unverified: ['Fluid flow, pressure, and sealing'],
  } });
  const assembly = buildTriplexPump();
  const result = await runTest(assembly, { env: spec.environment, test: triplexPumpTest });
  const { phaseGaps_deg } = measureTriplexPump(result);
  if (!result.passed || assembly.controller.drives.length !== 1 || phaseGaps_deg.some((gap) => Math.abs(gap - 120) > 15)) {
    throw new Error('Triplex pump reference did not meet its motion checks');
  }
  const date = now();
  const version = VersionRecord.parse({
    id: 'ver_triplex_pump_1', inventionId: pumpId, parentVersionId: null,
    iteration: 1, prompt, spec, assembly, tests: [result], modelId: DETERMINISTIC_MODEL_ID,
    status: 'passed', createdAt: date,
    decisions: [{ source: 'planner', summary: 'Offset the three eccentric pins by 120° around the same shaft.' }],
    toolLog: [{ t: date, tool: 'define_test', args: { test: triplexPumpTest }, ok: true, summary: 'Measure the powered shaft and all three passive pistons' }],
  });
  const description = 'A reference mechanism with one powered shaft and three passive pistons. Each eccentric drives a connecting rod. Replay the test to see their strokes roughly 120° apart.';
  const key = `versions/${version.id}.json`;
  store.putJson(key, version);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, prompt, featured, created_at, updated_at)
      VALUES (?, 'protolab', ?, ?, 'public', ?, 'passed', ?, 1, ?, ?)`).run(pumpId, title, description, version.id, prompt, date, date);
    db.prepare(`INSERT INTO versions (id, invention_id, parent_version_id, iteration, prompt, spec_json, manifest_key, metrics_json, model_id, status, created_at)
      VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, 'passed', ?)`).run(
      version.id, pumpId, prompt, JSON.stringify(spec), key, JSON.stringify(versionSummary(version).tests), version.modelId, date,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  await persist?.();
}

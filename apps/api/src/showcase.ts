import type { DatabaseSync } from 'node:sqlite';
import { Spec, VersionRecord, type Assembly, type TestResult, type TestSpec } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { buildTriplexPump, measureTriplexPump, triplexPumpTest } from '@protolab/simulator/triplex-pump';
import { buildTwinDrawbridge, measureTwinDrawbridge, twinDrawbridgeTest } from '@protolab/simulator/twin-drawbridge';
import { DETERMINISTIC_MODEL_ID } from '@protolab/agent';
import { now, versionSummary } from './jobs.ts';
import type { ObjectStore } from './store.ts';

type Reference = {
  id: string;
  versionId: string;
  title: string;
  description: string;
  prompt: string;
  plan: NonNullable<Spec['plan']>;
  build: () => Assembly;
  test: TestSpec;
  verify: (result: TestResult) => boolean;
  decision: string;
  testSummary: string;
};

const pump: Reference = {
  id: 'inv_triplex_pump',
  versionId: 'ver_triplex_pump_1',
  title: 'Triplex pump · one motor, three pistons',
  description: 'A reference mechanism with one powered shaft and three passive pistons. Each eccentric drives a connecting rod. Replay the test to see their strokes roughly 120° apart.',
  prompt: 'Build a tabletop mechanism where one rotating shaft moves three passive pistons in sequence.',
  plan: {
    purpose: 'Demonstrate how one rotary drive can produce three timed linear strokes.',
    features: ['One gearmotor and shaft', 'Three eccentric discs', 'Three piston rods'],
    motions: ['The shaft spins all three eccentrics. Connecting rods push and pull the pistons through their guides.'],
    subassemblies: ['Drive shaft', 'Three crank and slider linkages'],
    successCriteria: ['At least three shaft revolutions', 'At least 30 mm of travel on each piston', 'Piston peaks spaced roughly 120° apart'],
    unverified: ['Fluid flow, pressure, and sealing'],
  },
  build: buildTriplexPump,
  test: triplexPumpTest,
  verify: (result) => measureTriplexPump(result).phaseGaps_deg.every((gap) => Math.abs(gap - 120) <= 15),
  decision: 'Offset the three eccentric pins by 120° around the same shaft.',
  testSummary: 'Measure the powered shaft and all three passive pistons',
};

const drawbridge: Reference = {
  id: 'inv_twin_drawbridge',
  versionId: 'ver_twin_drawbridge_1',
  title: 'Twin drawbridge · one actuator, two decks',
  description: 'A reference mechanism where one linear actuator raises both bridge decks through mirrored bell cranks. The decks return to level after a full cycle.',
  prompt: 'Build a tabletop drawbridge with two decks that open and close together from a single linear actuator.',
  plan: {
    purpose: 'Show how a single linear input can drive two mirrored rotations.',
    features: ['Linear actuator and crosshead', 'Mirrored bell cranks', 'Two hinged bridge decks'],
    motions: ['The actuator moves a crosshead. Two passive connecting rods rotate the bell cranks and raise the decks together.'],
    subassemblies: ['Actuator and crosshead', 'Mirrored deck linkages'],
    successCriteria: ['Each deck center rises at least 45 mm', 'Both decks return within 3° of level', 'The decks clear one another'],
    unverified: ['Vehicle loads and structural strength'],
  },
  build: buildTwinDrawbridge,
  test: twinDrawbridgeTest,
  verify: (result) => measureTwinDrawbridge(result).every(({ peakAngle_deg, endAngle_deg }) => peakAngle_deg >= 40 && Math.abs(endAngle_deg) <= 3),
  decision: 'Use mirrored bell cranks so one actuator opens both bridge decks.',
  testSummary: 'Measure both passive decks and check clearance',
};

/** Save verified reference mechanisms once, with their real simulation traces. */
export async function seedReferenceShowcases(db: DatabaseSync, store: ObjectStore, persist?: () => Promise<void>) {
  for (const reference of [pump, drawbridge]) {
    try {
      await saveReference(reference, db, store, persist);
    } catch (error) {
      console.error('[showcase] Could not save', reference.id, error);
    }
  }
}

async function saveReference(reference: Reference, db: DatabaseSync, store: ObjectStore, persist?: () => Promise<void>) {
  const { id, versionId, title, prompt, description, test } = reference;
  if (db.prepare('SELECT 1 FROM inventions WHERE id=?').get(id)) return;
  const spec = Spec.parse({ task: prompt, plan: reference.plan });
  const assembly = reference.build();
  const result = await runTest(assembly, { env: spec.environment, test });
  if (!result.passed || assembly.controller.drives.length !== 1 || !reference.verify(result)) {
    throw new Error('Reference mechanism did not meet its motion checks');
  }
  const date = now();
  const version = VersionRecord.parse({
    id: versionId, inventionId: id, parentVersionId: null,
    iteration: 1, prompt, spec, assembly, tests: [result], modelId: DETERMINISTIC_MODEL_ID,
    status: 'passed', createdAt: date,
    decisions: [{ source: 'planner', summary: reference.decision }],
    toolLog: [{ t: date, tool: 'define_test', args: { test }, ok: true, summary: reference.testSummary }],
  });
  const key = `versions/${version.id}.json`;
  store.putJson(key, version);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO inventions (id, owner_id, title, description, visibility, current_version_id, status, prompt, featured, created_at, updated_at)
      VALUES (?, 'protolab', ?, ?, 'public', ?, 'passed', ?, 1, ?, ?)`).run(id, title, description, version.id, prompt, date, date);
    db.prepare(`INSERT INTO versions (id, invention_id, parent_version_id, iteration, prompt, spec_json, manifest_key, metrics_json, model_id, status, created_at)
      VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, 'passed', ?)`).run(
      version.id, id, prompt, JSON.stringify(spec), key, JSON.stringify(versionSummary(version).tests), version.modelId, date,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  await persist?.();
}

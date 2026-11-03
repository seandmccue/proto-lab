import type { DatabaseSync } from 'node:sqlite';
import { Spec, VersionRecord, type Assembly, type TestResult, type TestSpec } from '@protolab/schema';
import { runTest } from '@protolab/simulator';
import { buildTriplexPump, measureTriplexPump, triplexPumpTest } from '@protolab/simulator/triplex-pump';
import { buildTwinDrawbridge, measureTwinDrawbridge, twinDrawbridgeTest } from '@protolab/simulator/twin-drawbridge';
import { buildDrawingAutomaton, measureDrawingAutomaton, drawingAutomatonTest } from '@protolab/simulator/drawing-automaton';
import { buildScissorLift, scissorLiftTest } from '@protolab/simulator/scissor-lift';
import { buildCamSemaphore, measureCamSemaphore, camSemaphoreTest } from '@protolab/simulator/cam-semaphore';
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

const drawing: Reference = {
  id: 'inv_drawing_automaton',
  versionId: 'ver_drawing_automaton_1',
  title: 'Drawing automaton · a pen guided by four bars',
  description: 'A reference mechanism where one continuously turning crank guides a passive marker around a closed loop. The path comes from the recorded positions of the tip.',
  prompt: 'Build a drawing automaton where a single motor guides a marker around a repeating loop through a four-bar linkage.',
  plan: {
    purpose: 'Show how a linkage can turn steady rotation into a repeating two-dimensional path.',
    features: ['Powered crank', 'Passive rocker and pen carrier', 'Fixed-mount drawing marker'],
    motions: ['The crank rotates continuously. The linked rocker constrains the pen carrier and shapes the path of the marker.'],
    subassemblies: ['Ground link and motor', 'Four-bar linkage and marker'],
    successCriteria: ['At least three crank revolutions', 'Tip travel along both horizontal and vertical axes', 'Tip returns within 1 mm after one full measured revolution'],
    unverified: ['Ink transfer and contact pressure on paper'],
  },
  build: buildDrawingAutomaton,
  test: drawingAutomatonTest,
  verify: (result) => {
    const { loopClosure_m } = measureDrawingAutomaton(result);
    return loopClosure_m !== null && loopClosure_m <= 0.001;
  },
  decision: 'Place the marker off the line between the two pivots on the coupler to create a wider loop.',
  testSummary: 'Measure the powered crank and passive marker travel on both axes',
};

const scissorLift: Reference = {
  id: 'inv_scissor_lift',
  versionId: 'ver_scissor_lift_1',
  title: 'Scissor lift · horizontal drive, vertical lift',
  description: 'One horizontal actuator drives crossed links to raise a level platform. The replay measures the vertical travel and shows the return to the starting height.',
  prompt: 'Build a scissor lift that raises a level platform using one horizontal actuator.',
  plan: {
    purpose: 'Show how crossed links turn horizontal actuator motion into vertical lift.',
    features: ['Horizontal actuator', 'Crossed scissor arms', 'Platform with a passive slider'],
    motions: ['The actuator draws the lower pivots together. The arms pivot around their center and lift the platform, then lower it as the actuator retracts.'],
    subassemblies: ['Actuator and lower carriage', 'Crossed linkage and platform'],
    successCriteria: ['At least 45 mm of platform travel', 'Platform stays within 2° of level', 'Platform returns within 2 mm of its starting height'],
    unverified: ['Load rating, stability under external loads, and fabrication tolerances'],
  },
  build: buildScissorLift,
  test: scissorLiftTest,
  verify: ({ trace }) => {
    const start = trace.frames[0]?.bodies.platform?.position[1];
    const end = trace.frames.at(-1)?.bodies.platform?.position[1];
    return start !== undefined && end !== undefined && Math.abs(end - start) <= 0.002;
  },
  decision: 'Put a passive slide at one upper pivot so the arms can fold while keeping the platform level.',
  testSummary: 'Measure platform travel, tilt, and clearance',
};

const semaphore: Reference = {
  id: 'inv_cam_semaphore',
  versionId: 'ver_cam_semaphore_1',
  title: 'Cam semaphore · one shaft, alternating flags',
  description: 'Two cams on one shaft physically lift two passive flags in turn. Gravity lowers each flag, leaving a pause between lifts.',
  prompt: 'Build a two-flag semaphore that alternates using one continuously turning shaft and two physical cams.',
  plan: {
    purpose: 'Turn steady rotation into alternating signals with a dwell between lifts.',
    features: ['One motorized shaft', 'Two opposing cam lobes', 'Two passive guided flags'],
    motions: ['Each cam lobe pushes its follower up. As the lobe rotates away, gravity lowers the flag. The opposing cam repeats this on the other flag.'],
    subassemblies: ['Drive shaft and cams', 'Amber flag and slide', 'Teal flag and slide'],
    successCriteria: ['Both flags move at least 16 mm', 'Flags peak within 15° of a half-turn apart', 'Each flag dwells low at least 1 s per turn'],
    unverified: ['Physical wear, noise, and friction outside the simulation'],
  },
  build: buildCamSemaphore,
  test: camSemaphoreTest,
  verify: (result) => {
    const cycles = measureCamSemaphore(result);
    return cycles.length >= 3 && cycles.every(({ flags, phaseGap_deg }) =>
      phaseGap_deg >= 165 && flags.every(({ stroke_m, lowDwell_s }) => stroke_m >= 0.016 && lowDwell_s >= 1));
  },
  decision: 'Put the two cam lobes half a turn apart so their passive followers lift in turn.',
  testSummary: 'Measure both flag strokes and verify their dwell and phase from the recorded trace',
};

/** Save verified reference mechanisms once, with their real simulation traces. */
export async function seedReferenceShowcases(db: DatabaseSync, store: ObjectStore, persist?: () => Promise<void>) {
  for (const reference of [pump, drawbridge, drawing, scissorLift, semaphore]) {
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

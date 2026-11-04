/**
 * Verify a running ProtoLab stack. Add --judge to verify the curated public
 * judge route, saved simulation evidence, and hosted demo video.
 */
import type { TestResult, TestSpec, VersionRecord } from '@protolab/schema';
import { len, sub, transformPoint } from '@protolab/parts';
import { measureFollowerTiming } from '@protolab/simulator/follower-timing';
import { measurePlanarOrbit } from '@protolab/simulator/planar-orbit';
import { measureIndexedMotion } from '@protolab/simulator/indexed-motion';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const api = arg('--api', 'http://localhost:8787');
const web = arg('--web', 'http://localhost:5173');
const judge = process.argv.includes('--judge');
const request = (url: string, init?: RequestInit) => fetch(url, { signal: AbortSignal.timeout(15000), ...init });
const get = async <T>(path: string) => {
  const response = await request(api + path);
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${path}`);
  return await response.json() as T;
};

interface InventionDetail {
  invention: { title: string; visibility: string; status: string; currentVersionId: string; modelId: string; featured: boolean };
  versions: { id: string; iteration: number }[];
  source: { id: string; versionId: string } | null;
}
async function publicBuild(id: string) {
  const detail = await get<InventionDetail>(`/api/inventions/${id}`);
  if (detail.invention.visibility !== 'public' || detail.invention.status !== 'passed') {
    throw new Error(`${detail.invention.title} must be public and passed`);
  }
  return detail;
}
const version = async (id: string, versionId: string, trace = true) => (
  await get<{ version: VersionRecord }>(`/api/inventions/${id}/versions/${versionId}?trace=${trace ? 1 : 0}`)
).version;
const recorded = (record: VersionRecord, check: (test: TestResult) => boolean) => (
  record.tests.some((test) => test.trace.frames.length > 1 && check(test))
);

const checks: [string, () => Promise<string>][] = [
  ['Meta Muse', async () => {
    const model = await get<{ modelId: string; label: string; live: boolean; detail: string }>('/api/model');
    if (!model.live || !model.modelId.startsWith('muse-')) throw new Error(model.detail);
    return model.label;
  }],
  ['Featured gallery', async () => {
    const { items } = await get<{ items: { status: string; title: string }[] }>('/api/gallery?sort=featured&limit=24');
    if (items.length < 4) throw new Error(`Expected at least 4 featured inventions, found ${items.length}`);
    const failures = items.filter((item) => item.status !== 'passed');
    if (failures.length) throw new Error(`Featured builds without a pass: ${failures.map(({ title }) => title).join(', ')}`);
    return `${items.length} passing builds`;
  }],
  ['Examples', async () => {
    const { examples } = await get<{ examples: unknown[] }>('/api/examples');
    if (!examples.length) throw new Error('The homepage has no example briefs');
    return `${examples.length} briefs`;
  }],
  ['Web app', async () => {
    const response = await request(web);
    if (!response.ok || !/ProtoLab/.test(await response.text())) throw new Error(`HTTP ${response.status} or missing app shell`);
    return web;
  }],
];

if (judge) checks.push(
  ['Crab comparison', async () => {
    const id = 'inv_633b4887ad7f4cdc';
    const detail = await publicBuild(id);
    const failed = detail.versions.find(({ iteration }) => iteration === 3);
    const passed = detail.versions.find(({ iteration }) => iteration === 4);
    if (!detail.invention.featured || !failed || !passed) throw new Error('Expected featured crab with v3 and v4');
    const [before, after] = await Promise.all([version(id, failed.id), version(id, passed.id)]);
    if (!recorded(before, (test) => test.kind === 'walk' && !test.passed)
      || !recorded(after, (test) => test.kind === 'walk' && test.passed && test.metrics.distance_m >= 0.25 && test.metrics.maxTilt_deg <= 10)) {
      throw new Error('Expected the recorded failed walk and passing revision');
    }
    return 'v3 failed, v4 passed';
  }],
  ['Muse drawing remix', async () => {
    const id = 'inv_76b7fae5bdf941c9';
    const { invention, source } = await publicBuild(id);
    if (source?.id !== 'inv_drawing_automaton' || source.versionId !== 'ver_drawing_automaton_1' || !invention.modelId.startsWith('muse-')) {
      throw new Error('Expected the saved drawing lineage and Muse model');
    }
    const replay = await version(id, invention.currentVersionId);
    if (!recorded(replay, (test) => test.passed && test.metrics['pen_tip.travel_x_m'] >= 0.075 && test.metrics['pen_tip.travel_y_m'] >= 0.04)) {
      throw new Error('Expected measured pen travel on both axes');
    }
    return 'public replay with original lineage';
  }],
  ['Alternating stamp press', async () => {
    const id = 'inv_5e16a5e4eaba4831';
    const detail = await publicBuild(id);
    const first = detail.versions.find(({ iteration }) => iteration === 1);
    const framed = detail.versions.find(({ iteration }) => iteration === 2);
    if (!first || !framed || detail.invention.currentVersionId !== framed.id) throw new Error('Expected original and framed press versions');
    const [before, after] = await Promise.all([version(id, first.id), version(id, framed.id)]);
    const timingPassed = (test: TestResult) => test.passed && test.metrics.followerCycles >= 3
      && test.metrics.followerPhaseGap_deg >= 155
      && Object.entries(test.metrics).filter(([key, value]) => key.endsWith('.cycleStroke_m') && value >= 0.016).length === 2;
    if (after.parentVersionId !== before.id || !recorded(before, timingPassed) || !recorded(after, timingPassed)) {
      throw new Error('Expected both original timing runs and the revision lineage');
    }
    return 'both timing replays and revision lineage';
  }],
  ['Muse triplex pump', async () => {
    const id = 'inv_c618332e234d447d';
    const { invention, versions } = await publicBuild(id);
    const first = versions.find(({ iteration }) => iteration === 1);
    if (!first) throw new Error('Expected the original pump revision');
    const [before, after] = await Promise.all([version(id, first.id), version(id, invention.currentVersionId)]);
    const turns = (record: VersionRecord) => {
      const test = record.tests.find(({ testId, passed }) => testId === 'pump_motion#1' && passed);
      return test ? measureFollowerTiming(test.trace, { shaft: 'spin', followers: ['pist0', 'pist1', 'pist2'], axis: 'y' }) : [];
    };
    const original = turns(before);
    const revised = turns(after);
    const phaseMet = (gap: number) => gap >= 110 && gap <= 130;
    if (after.parentVersionId !== before.id || after.assembly.controller.drives.length !== 1
      || original.length < 3 || !original.some(({ phaseGaps_deg }) => phaseGaps_deg.some((gap) => !phaseMet(gap)))
      || revised.length < 3 || revised.some(({ phaseGaps_deg, flags }) =>
        !phaseGaps_deg.every(phaseMet) || flags.some(({ stroke_m }) => stroke_m < 0.03))) {
      throw new Error('Expected the original phase miss and revised phase and stroke targets');
    }
    return 'three passive pistons measured across three full turns';
  }],
  ['Muse tabletop orrery', async () => {
    const id = 'inv_adc081059ea44ab9';
    const { invention, versions } = await publicBuild(id);
    const first = versions.find(({ iteration }) => iteration === 1);
    if (!first) throw new Error('Expected the original orrery assembly');
    const [before, after] = await Promise.all([version(id, first.id), version(id, invention.currentVersionId)]);
    const orbits = (record: VersionRecord) => {
      const test = record.tests.find(({ testId, passed }) => testId.startsWith('orrery_spin#') && passed);
      if (!test || test.metrics.clearanceViolation !== 0) return null;
      const earth = measurePlanarOrbit(test.trace, { body: 'earth', center: 'sun', plane: 'xz' });
      const moon = measurePlanarOrbit(test.trace, { body: 'moon', center: 'earth', plane: 'xz', reference: { from: 'sun', to: 'earth' } });
      return earth && moon ? { earth, moon } : null;
    };
    const initial = orbits(before);
    const revised = orbits(after);
    if (!initial || !revised || Math.abs(initial.moon.signedTurns) >= 3 || Math.abs(revised.earth.signedTurns) < 1
      || Math.abs(revised.moon.signedTurns) < 3 || revised.earth.minRadius_m <= revised.moon.maxRadius_m
      || revised.earth.maxRadius_m - revised.earth.minRadius_m >= 0.01
      || revised.moon.maxRadius_m - revised.moon.minRadius_m >= 0.01) {
      throw new Error('Expected the original nested orbit miss and the two verified revised paths');
    }
    return 'Earth and Moon paths measured separately';
  }],
  ['Muse self-leveling tray', async () => {
    const id = 'inv_f72fb06c611342eb';
    const { invention } = await publicBuild(id);
    const replay = await version(id, invention.currentVersionId);
    const drive = replay.assembly.controller.drives[0]?.controlId;
    if (replay.assembly.controller.drives.length !== 1 || !drive
      || !replay.assembly.joints.some(({ id, type, motor }) => id === 'j_inner_bracket' && type === 'revolute' && !motor)) {
      throw new Error('Expected one drive and a separate passive pivot');
    }
    const target = 25 * Math.PI / 180;
    if (!recorded(replay, (test) => {
      const angles = test.trace.frames.map(({ joints }) => joints[drive]).filter(Number.isFinite);
      return test.passed && test.metrics['tray.maxTilt_deg'] <= 8 && test.metrics.groundContactViolation === 0
        && Math.min(...angles) <= -target && Math.max(...angles) >= target;
    })) throw new Error('Expected the recorded swing on both sides and a level tray');
    const assembly = structuredClone(replay.assembly);
    const passivePivot = assembly.joints.find(({ id }) => id === 'j_inner_bracket');
    if (!passivePivot || !replay.spec) throw new Error('Expected a passive pivot and simulation environment');
    passivePivot.type = 'fixed';
    const { runTest } = await import('@protolab/simulator');
    const locked = await runTest(assembly, {
      env: replay.spec.environment,
      test: {
        id: 'locked_pivot_control', kind: 'motion', duration_s: 12,
        measure: { joints: [drive], jointSwing: [{ joint: drive, minEachWay_rad: target }], uprightInstances: ['tray'], clearancePairs: [], noGroundContact: ['tray'] },
        criteria: { maxInstanceTilt_deg: 8, torqueWithinRating: true },
      },
    });
    if (locked.passed || !(locked.metrics['tray.maxTilt_deg'] > 8)
      || !(locked.metrics[`${drive}.minSwing_rad`] <= -target && locked.metrics[`${drive}.maxSwing_rad`] >= target)) {
      throw new Error('Expected the locked pivot to fail tray tilt while keeping the required outer swing');
    }
    return `passive replay passed; locked pivot reached ${locked.metrics['tray.maxTilt_deg']}°`;
  }],
  ['Two-axis gimbal reference', async () => {
    const id = 'inv_two_axis_gimbal';
    const { invention } = await publicBuild(id);
    const replay = await version(id, invention.currentVersionId);
    if (replay.assembly.controller.drives.length !== 2 || invention.modelId !== 'deterministic-planner'
      || !recorded(replay, (test) => test.passed && test.metrics['tray.maxTilt_deg'] <= 1
        && test.metrics.clearanceViolation === 0 && test.metrics.groundContactViolation === 0
        && ['pitch', 'roll'].every((joint) => test.metrics[`${joint}.minSwing_rad`] <= -0.35
          && test.metrics[`${joint}.maxSwing_rad`] >= 0.35))) {
      throw new Error('Expected the reference trace to pass both signed sweeps, leveling, and clearance');
    }
    return 'both powered axes moved while the tray stayed within 1° of level';
  }],
  ['Muse two-axis repair', async () => {
    const id = 'inv_d3f76fcc393b49d6';
    const { invention, versions } = await publicBuild(id);
    const first = versions.find(({ iteration }) => iteration === 1);
    if (!first) throw new Error('Expected the initial two-axis failure');
    const [before, after] = await Promise.all([version(id, first.id), version(id, invention.currentVersionId)]);
    const sweeps = (test: TestResult) => ['pitch', 'roll'].every((joint) =>
      test.metrics[`${joint}.minSwing_rad`] <= -0.35 && test.metrics[`${joint}.maxSwing_rad`] >= 0.35);
    if (before.modelId !== 'muse-spark-1.3' || after.modelId !== 'muse-wonder-1.0'
      || after.assembly.controller.drives.length !== 2
      || !recorded(before, (test) => !test.passed && sweeps(test) && test.metrics['tray.maxTilt_deg'] > 10)
      || !recorded(after, (test) => test.passed && sweeps(test) && test.metrics['tray.maxTilt_deg'] <= 10
        && test.metrics.groundContactViolation === 0)) {
      throw new Error('Expected the initial Spark failure and the Wonder leveling pass with both drives still moving');
    }
    return 'Wonder repaired leveling while preserving both signed sweeps';
  }],
  ['Muse mechanical lotus', async () => {
    const id = 'inv_ba7b3c7716564397';
    const { invention, versions } = await publicBuild(id);
    const first = versions.find(({ iteration }) => iteration === 1);
    if (!first || !invention.featured) throw new Error('Expected the initial failure and a featured lotus');
    const [before, after] = await Promise.all([version(id, first.id), version(id, invention.currentVersionId)]);
    const { assembly } = after;
    const instances = new Map(assembly.instances.map((instance) => [instance.id, instance]));
    const parts = new Map(assembly.parts.map((part) => [part.id, part]));
    const point = ({ instanceId, connectorId }: typeof assembly.joints[number]['a']) => {
      const instance = instances.get(instanceId);
      const connector = instance && parts.get(instance.partId)?.connectors.find(({ id }) => id === connectorId);
      if (!instance || !connector) throw new Error(`Missing lotus connector ${instanceId}.${connectorId}`);
      return transformPoint(instance.transform, connector.position);
    };
    const rods = Array.from({ length: 6 }, (_, index) => `rod${index}`);
    const exactPins = rods.every((id, index) => {
      const joints = assembly.joints.filter(({ a, b }) => a.instanceId === id || b.instanceId === id);
      const neighbors = joints.map(({ a, b }) => a.instanceId === id ? b.instanceId : a.instanceId);
      return joints.length === 2 && neighbors.includes('collar') && neighbors.includes(`petal${index}`)
        && joints.every(({ a, b, type, motor }) => type === 'revolute' && !motor && len(sub(point(a), point(b))) <= 0.0005);
    });
    const powered = assembly.joints.filter(({ motor }) => motor);
    if (!after.modelId.startsWith('muse-') || powered.length !== 1 || powered[0].type !== 'prismatic'
      || assembly.controller.drives.length !== 1 || !exactPins
      || !recorded(before, (test) => test.testId.startsWith('lotus_cycle#') && !test.passed)
      || !recorded(after, (test) => test.testId.startsWith('lotus_cycle#') && test.passed
        && test.metrics.synchronizedMinTravel_m >= 0.04 && test.metrics.synchronizedMaxSpread_m <= 0.005
        && test.metrics['collar.travel_y_m'] >= 0.035 && test.metrics.clearanceViolation === 0
        && test.metrics.groundContactViolation === 0)) {
      throw new Error('Expected one actuator, six fitted rods, and a passing synchronized-motion test');
    }
    return 'six synchronized petals, one actuator, and all twelve rod pins aligned';
  }],
  ['Geneva indexer reference', async () => {
    const id = 'inv_geneva_indexer';
    const { invention } = await publicBuild(id);
    const replay = await version(id, invention.currentVersionId);
    if (!invention.featured || replay.modelId !== 'deterministic-planner'
      || replay.assembly.controller.drives.length !== 1
      || replay.assembly.joints.filter(({ motor }) => motor).length !== 1
      || !recorded(replay, (test) => test.passed && test.metrics.indexedConsecutiveSteps >= 2
        && test.metrics['spin.revolutions'] >= 2 && test.metrics.groundContactViolation === 0)) {
      throw new Error('Expected a featured reference with one drive and a saved indexing pass');
    }
    return 'two consecutive quarter turns with dwell while one motor kept turning';
  }],
  ['Muse Geneva carousel repair', async () => {
    const id = 'inv_b99f505fab294915';
    const { invention, versions } = await publicBuild(id);
    const first = versions.find(({ iteration }) => iteration === 1);
    if (!first || !invention.featured) throw new Error('Expected the initial failure and a featured carousel');
    const [before, after] = await Promise.all([version(id, first.id), version(id, invention.currentVersionId)]);
    const motorized = after.assembly.joints.filter(({ motor }) => motor);
    const passed = after.tests.find((test) => test.passed && test.metrics.indexedConsecutiveSteps >= 2);
    const idPrefix = passed?.testId.replace(/#\d+$/, '');
    let definition: TestSpec | undefined;
    let ancestor = after;
    const visited = new Set<string>();
    while (idPrefix && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      const entry = ancestor.toolLog.slice().reverse().find(({ tool, ok, args }) =>
        tool === 'define_test' && ok && (args as { test?: TestSpec } | null)?.test?.id === idPrefix);
      definition = (entry?.args as { test?: TestSpec } | undefined)?.test;
      if (definition || !ancestor.parentVersionId) break;
      ancestor = await version(id, ancestor.parentVersionId, false);
    }
    const goal = definition?.kind === 'motion' ? definition.measure.indexedMotion : undefined;
    if (!after.modelId.startsWith('muse-') || motorized.length !== 1 || motorized[0].type !== 'revolute'
      || after.assembly.controller.drives.length !== 1 || !goal || goal.input !== motorized[0].motor?.controlId
      || goal.minSteps < 2 || goal.step_deg !== 90 || goal.stepTolerance_deg > 8
      || goal.minDwell_s < 0.6 || goal.maxDwellDrift_deg > 3 || !passed
      || !(passed.metrics[`${goal.input}.revolutions`] >= 2) || passed.metrics.groundContactViolation !== 0
      || !recorded(before, (test) => !test.passed && test.metrics['spin.revolutions'] >= 2
        && Math.abs(test.metrics['jewel_0.orbitSignedTurns']) < 0.01)
      || (measureIndexedMotion(passed.trace, goal)?.consecutiveSteps ?? 0) < 2) {
      throw new Error('Expected a stalled baseline and a genuine Muse repair with one drive and repeated indexed motion');
    }
    return 'the motor kept turning while the passive carousel advanced and held position';
  }],
  ['Gravity Clock', async () => {
    const { invention } = await publicBuild('inv_a1f1665e649b41c2');
    if (!invention.featured) throw new Error('Expected the clock to be featured');
    return 'public and featured';
  }],
  ['Judge video', async () => {
    const response = await request(web + '/judge-demo.mp4', { headers: { range: 'bytes=0-31' } });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 206 || !response.headers.get('content-type')?.startsWith('video/mp4') || bytes.subarray(4, 8).toString() !== 'ftyp') {
      throw new Error(`Expected an MP4 byte-range response, received HTTP ${response.status}`);
    }
    return 'public MP4 supports range playback';
  }],
);

console.log(`ProtoLab preflight · api ${api} · web ${web}`);
const results = await Promise.allSettled(checks.map(([, check]) => check()));
results.forEach((result, index) => {
  const [label] = checks[index];
  if (result.status === 'fulfilled') console.log(`  ✓ ${label} · ${result.value}`);
  else console.error(`  ✗ ${label} · ${(result.reason as Error).message}`);
});
process.exitCode = results.some(({ status }) => status === 'rejected') ? 1 : 0;

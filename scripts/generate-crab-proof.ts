// Run from the repository root:
// node --import tsx scripts/generate-crab-proof.ts > apps/web/src/components/crabProof.json
import { TestSpec, VersionRecord } from '@protolab/schema';
import { runTest } from '@protolab/simulator';

const inventionId = 'inv_633b4887ad7f4cdc';
const beforeId = 'ver_2a2b7412fe6d4fa7';
const afterId = 'ver_0ce0875e991d4d73';
const originalId = 'ver_bc0b7872008d44fc';
const origin = 'https://protolab.sean-abc.workers.dev';

async function version(id: string) {
  const response = await fetch(`${origin}/api/inventions/${inventionId}/versions/${id}?trace=0`);
  if (!response.ok) throw new Error(`Version ${id} returned HTTP ${response.status}`);
  return VersionRecord.parse((await response.json()).version);
}

const [original, before, after] = await Promise.all([version(originalId), version(beforeId), version(afterId)]);
const definition = original.toolLog.find((entry) => entry.tool === 'define_test' && entry.ok);
const test = TestSpec.parse((definition?.args as { test?: unknown } | undefined)?.test);
if (test.kind !== 'walk' || test.id !== 'scuttle' || after.parentVersionId !== before.id) {
  throw new Error('The saved versions must be successive revisions of the scuttle test');
}

const env = before.spec.environment;
// Hold the test and environment fixed. The stance swap includes the joint
// anchors and axes that follow the new assembled leg positions.
const baseline = await runTest(before.assembly, { env, test });
const stance = await runTest(after.assembly, { env, test, controller: before.assembly.controller });
const timing = await runTest(before.assembly, { env, test, controller: after.assembly.controller });

if (baseline.passed || !stance.passed || timing.passed) {
  throw new Error('The expected result of the controlled comparison changed');
}

function result(run: typeof baseline) {
  return {
    passed: run.passed,
    maxTilt_deg: run.metrics.maxTilt_deg,
    distance_m: run.metrics.distance_m,
  };
}

console.log(JSON.stringify({
  inventionId,
  beforeId,
  afterId,
  engine: baseline.engine,
  test,
  baseline: result(baseline),
  stance: result(stance),
  timing: result(timing),
}, null, 2));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart } from '@protolab/parts';
import { TestSpec } from '@protolab/schema';
import { runTest } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
const assembly = applyOps(emptyAssembly(), [
  { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.005, 0], anchored: true },
  { op: 'place', id: 'seamA', part: 'block-40', position: [0.3, 0.2, 0] },
  { op: 'place', id: 'seamB', part: 'block-40', position: [0.4, 0.25, 0] },
], getPart).assembly;

test('automatic ground checks catch omitted contacts without changing authored metrics or replay', async () => {
  const spec = TestSpec.parse({
    kind: 'motion', id: 'stable-base', duration_s: 1,
    measure: { base: 'base', noGroundContact: ['seamA'] },
    criteria: { maxBaseDrift_m: 0.01 },
  });
  const original = await runTest(assembly, { env, test: spec });
  const checked = await runTest(assembly, {
    env, test: spec, additionalNoGroundContact: ['seamA', 'seamB', 'seamB'],
  });
  const { automaticGroundContactChecks, automaticGroundContactViolation, ...authoredMetrics } = checked.metrics;
  assert.equal(automaticGroundContactChecks, 1);
  assert.equal(automaticGroundContactViolation, 1);
  assert.deepEqual(authoredMetrics, original.metrics);
  assert.deepEqual(checked.trace, original.trace);
  assert.deepEqual(original.failureReasons, ['seamA touched the ground']);
  assert.equal(checked.failureReasons.length, 2);
  assert.match(checked.failureReasons[1], /Automatic ground check: seamB touched the ground at 0\.\d+ s/);
});

test('additional ground evidence can stop a passing non-motion test', async () => {
  const spec = TestSpec.parse({ kind: 'walk', id: 'standing', duration_s: 1, base: 'base', minDistance_m: 0 });
  const original = await runTest(assembly, { env, test: spec });
  assert.equal(original.passed, true);
  assert.equal('automaticGroundContactChecks' in original.metrics, false);

  const checked = await runTest(assembly, { env, test: spec, additionalNoGroundContact: ['seamA', 'seamB'] });
  assert.equal(checked.passed, false);
  assert.equal(checked.metrics.automaticGroundContactChecks, 2);
  assert.equal(checked.metrics.automaticGroundContactViolation, 1);
  assert.deepEqual(checked.trace, original.trace);
  assert.equal(checked.failureReasons.length, 2);
  assert.match(checked.failureReasons[0], /seamA touched the ground at 0\.\d+ s/);
  assert.match(checked.failureReasons[1], /seamB touched the ground at 0\.\d+ s/);
});

test('additional ground checks report clean coverage and reject unknown IDs', async () => {
  const spec = TestSpec.parse({ kind: 'walk', id: 'standing', duration_s: 0.1, base: 'base', minDistance_m: 0 });
  const clean = await runTest(assembly, { env, test: spec, additionalNoGroundContact: ['seamA'] });
  assert.equal(clean.passed, true);
  assert.equal(clean.metrics.automaticGroundContactChecks, 1);
  assert.equal(clean.metrics.automaticGroundContactViolation, 0);

  const missing = await runTest(assembly, { env, test: spec, additionalNoGroundContact: ['missing'] });
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.failureReasons, ['Automatic ground check instance "missing" not found']);
});

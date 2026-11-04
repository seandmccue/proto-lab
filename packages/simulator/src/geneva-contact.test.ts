import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGenevaIndexer, genevaIndexerTest } from './geneva-indexer.ts';
import { runTest } from './index.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

test('a single contact pin physically indexes a passive wheel and holds between steps', async () => {
  const result = await runTest(buildGenevaIndexer(true), { env, test: genevaIndexerTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(result.metrics.indexedConsecutiveSteps >= 2);
  assert.ok(result.metrics['spin.revolutions'] >= 2);
});

test('removing pin contact keeps the input turning but prevents passive indexing', async () => {
  const result = await runTest(buildGenevaIndexer(false), { env, test: genevaIndexerTest });
  assert.equal(result.passed, false);
  assert.ok(result.metrics['spin.revolutions'] >= 2);
  assert.ok(Math.abs(result.metrics['wheel_rim.orbitSignedTurns']) < 0.01);
  assert.equal(result.metrics.indexedConsecutiveSteps, 0);
});

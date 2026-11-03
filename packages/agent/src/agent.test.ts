import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, type AgentEvent } from './index.ts';

test('deterministic planner reaches a passing walking robot and records honest versions', async () => {
  const events: AgentEvent[] = [];
  let n = 0;
  const out = await runAgent({ prompt: 'Design a small walking robot inspired by my Muse character. Build it from mechanical components, test its balance and walking, then make it dance.', inventionId: 'inv_test', model: null, newVersionId: () => `v${++n}` }, (e) => events.push(e));
  assert.equal(out.status, 'passed', out.summary);
  assert.ok(out.versions.length >= 1);
  const last = out.versions[out.versions.length - 1];
  assert.ok(last.tests.some((t) => t.kind === 'walk' && t.passed));
  assert.ok(last.tests.some((t) => t.kind === 'dance'), 'dance follow-up should have been tested');
  // every revision after the first cites a measured result
  for (const v of out.versions.slice(1)) assert.ok(v.decisions[0].basedOn, `iteration ${v.iteration} has no basedOn`);
  assert.ok(events.some((e) => e.type === 'tool'));
  console.log(out.versions.map((v) => `${v.id} it${v.iteration} ${v.status} ${v.tests.map((t) => `${t.testId}:${t.passed ? 'P' : 'F'} d=${t.metrics.distance_m}`).join(' ')} | ${v.decisions[0].summary}`).join('\n'));
});

test('remix with six legs builds a hexapod from the parent', async () => {
  let n = 0;
  const base = await runAgent({ prompt: 'Build a small four-legged walking robot.', inventionId: 'inv_a', model: null, newVersionId: () => `a${++n}` }, () => {});
  const parent = base.versions[base.versions.length - 1];
  const remix = await runAgent({ prompt: 'Build a small four-legged walking robot.', changeRequest: 'Give it six legs', inventionId: 'inv_b', parent, model: null, newVersionId: () => `b${++n}` }, () => {});
  const last = remix.versions[remix.versions.length - 1];
  assert.equal(last.assembly.familyParams.legCount, 6);
  assert.equal(last.parentVersionId === parent.id || remix.versions[0].parentVersionId === parent.id, true);
  console.log('remix', remix.status, last.tests.map((t) => `${t.testId}:${t.passed ? 'P' : 'F'} d=${t.metrics.distance_m}`).join(' '));
});

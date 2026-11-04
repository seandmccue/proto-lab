import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseSpec } from './spec.ts';
import { ToolRuntime } from './tools.ts';

test('planning reports the applied cap and mass rejection explains how to apply an explicit allowance', async () => {
  const rt = new ToolRuntime(baseSpec('Build a test stand with a 20 kg total-machine budget'), {
    onLog() {}, onPlan() {}, onAssembly() {}, onTestStart() {}, onTest() {},
  }, { maxTests: 1, maxToolCalls: 12 });
  const plan = { purpose: 'Build a stand within the 20 kg budget', features: ['Three ballast masses'], motions: [], subassemblies: ['Ballast'], successCriteria: ['Keep all ballast'], unverified: [] };
  const proseOnly = await rt.call('write_plan', plan) as { constraints: { maxMass_kg: number } };
  assert.equal(proseOnly.constraints.maxMass_kg, 5);
  const batch = { rationale: 'Place the three two-kilogram ballast masses', ops: [0, 1, 2].map(i => ({ op: 'place', id: `ballast${i}`, part: 'counterweight-2kg', position: [i * .2, .05, 0], anchored: true })) };
  const rejected = await rt.call('assemble', batch) as { error: string };
  assert.match(rejected.error, /Assembly mass 6\.000 kg exceeds 5 kg/);
  assert.match(rejected.error, /write_plan.*numeric maxMass_kg/);
  assert.equal(rt.assembly.instances.length, 0, 'rejected batch must leave no partial assembly');
  assert.equal(rt.spec.constraints.maxMass_kg, 5, 'feedback must not silently raise the cap');
  const invalid = await rt.call('write_plan', { ...plan, maxMass_kg: 51 }) as { error: string };
  assert.match(invalid.error, /maxMass_kg/);
  assert.equal(rt.spec.constraints.maxMass_kg, 5);
  const allowed = await rt.call('write_plan', { ...plan, maxMass_kg: 20 }) as { constraints: { maxMass_kg: number } };
  assert.equal(allowed.constraints.maxMass_kg, 20);
  const applied = await rt.call('assemble', batch) as { error?: string };
  assert.equal(applied.error, undefined);
  assert.equal(rt.assembly.instances.length, 3);
  assert.equal(rt.tests.length, 0, 'changing a plan is not simulation evidence');
});

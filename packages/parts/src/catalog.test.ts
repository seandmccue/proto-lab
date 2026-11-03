import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, searchCatalog, generatePart, buildWalker, DEFAULT_WALKER, ParamError } from './index.ts';
import { billOfMaterials, Assembly } from '@protolab/schema';

test('catalog has 30-50 valid parts', () => {
  const c = catalog();
  assert.ok(c.length >= 30 && c.length <= 50, `got ${c.length}`);
  for (const p of c) assert.ok(p.mass_kg > 0 && p.connectors.length > 0, p.id);
});

test('search finds servos by query and category', () => {
  const r = searchCatalog('servo torque', { category: 'motors' });
  assert.ok(r.length >= 4);
  assert.ok(r.every((p) => p.kind === 'servo_motor'));
});

test('generatePart rejects out-of-range params', () => {
  assert.throws(() => generatePart('beam', { length: 5 }), ParamError);
  assert.throws(() => generatePart('beam', { bogus: 1 }), ParamError);
});

test('walker builds a valid assembly with feet on the ground', () => {
  const a = buildWalker(DEFAULT_WALKER);
  Assembly.parse(a);
  const feet = a.instances.filter((i) => i.id.startsWith('foot_'));
  assert.equal(feet.length, 4);
  const foot = a.parts.find((p) => p.kind === 'foot_pad')!;
  for (const f of feet) assert.ok(Math.abs(f.transform.position[1] - foot.params.radius) < 1e-9);
  assert.equal(a.joints.filter((j) => j.type === 'revolute').length, 8);
  const bom = billOfMaterials(a);
  assert.ok(bom.length >= 5);
});

test('hexapod walker builds with 6 legs', () => {
  const a = buildWalker({ ...DEFAULT_WALKER, legCount: 6, chassisPartId: 'chassis-hex-200' });
  assert.equal(a.instances.filter((i) => i.id.startsWith('foot_')).length, 6);
  assert.equal(a.joints.filter((j) => j.type === 'revolute').length, 12);
});

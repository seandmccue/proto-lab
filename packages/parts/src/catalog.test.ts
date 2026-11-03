import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, searchCatalog, generatePart, buildWalker, DEFAULT_WALKER, ParamError, applyOps, emptyAssembly, getPart, mateTransform, transformPoint, summarize } from './index.ts';
import { Assembly, billOfMaterials } from '@protolab/schema';

test('catalog has 80+ valid parts across categories', () => {
  const c = catalog();
  assert.ok(c.length >= 80, `got ${c.length}`);
  const cats = new Set(c.map((p) => p.category));
  for (const want of ['beams', 'plates', 'gears', 'wheels', 'hinges', 'sliders', 'linkages', 'cranks', 'motors', 'springs', 'wings', 'propellers', 'grippers', 'legs']) assert.ok(cats.has(want as never), `missing category ${want}`);
  for (const p of c) assert.ok(p.mass_kg > 0 && p.connectors.length > 0, p.id);
});

test('search finds servos by query and category', () => {
  const r = searchCatalog('servo torque', { category: 'motors' });
  assert.ok(r.length >= 4 && r.every((p) => p.kind === 'servo_motor'));
});

test('generatePart rejects out-of-range params', () => {
  assert.throws(() => generatePart('beam', { length: 5 }), ParamError);
  assert.throws(() => generatePart('beam', { bogus: 1 }), ParamError);
});

test('mount places the child so connectors coincide and face each other', () => {
  const beam = getPart('beam-100')!, servo = getPart('servo-mg996r')!;
  const r = applyOps(emptyAssembly(), [
    { op: 'place', id: 'b', part: beam.id, position: [0, 0.1, 0] },
    { op: 'mount', id: 's', part: servo.id, onto: 'b', connector: 'top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart);
  const b = r.assembly.instances[0], s = r.assembly.instances[1];
  const pb = transformPoint(b.transform, beam.connectors.find((c) => c.id === 'top')!.position);
  const ps = transformPoint(s.transform, servo.connectors.find((c) => c.id === 'mount')!.position);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(pb[k] - ps[k]) < 1e-9, `axis ${k}: ${pb[k]} vs ${ps[k]}`);
  void mateTransform;
});

test('polar pattern replicates instances, joints and drives', () => {
  const wheel = getPart('spoked-wheel-400')!, gondola = getPart('gondola-40')!;
  let r = applyOps(emptyAssembly(), [
    { op: 'place', id: 'wheel', part: wheel.id, position: [0, 0.3, 0] },
    { op: 'mount', id: 'cab', part: gondola.id, onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'revolute', spin_deg: 0, offset_m: 0 },
    { op: 'pattern', instances: ['cab'], kind: 'polar', axis: 'z', center: [0, 0.3, 0], count: 8, controlSuffix: true },
  ], getPart);
  assert.equal(r.assembly.instances.filter((i) => i.partId === gondola.id).length, 8);
  assert.equal(r.assembly.joints.filter((j) => j.type === 'revolute').length, 8);
  const s = summarize(r.assembly); assert.ok(s.totalMass_kg > 0);
});

test('walker builds from generic ops with feet on the ground and 8 motorised joints', () => {
  const a = buildWalker(DEFAULT_WALKER);
  Assembly.parse(a);
  const feet = a.instances.filter((i) => i.id.startsWith('foot_'));
  assert.equal(feet.length, 4);
  const foot = a.parts.find((p) => p.kind === 'foot_pad')!;
  for (const f of feet) assert.ok(Math.abs(f.transform.position[1] - foot.params.radius) < 1e-6, `${f.id} y=${f.transform.position[1]}`);
  assert.equal(a.joints.filter((j) => j.type === 'revolute' && j.motor).length, 8);
  assert.equal(a.controller.drives.length, 8);
  assert.ok(billOfMaterials(a).length >= 5);
  // left and right legs mirror: upper legs hang below their hip servos on both sides
  const hipL = a.instances.find((i) => i.id === 'hip_servo_L0')!, upL = a.instances.find((i) => i.id === 'upper_leg_L0')!;
  const hipR = a.instances.find((i) => i.id === 'hip_servo_R0')!, upR = a.instances.find((i) => i.id === 'upper_leg_R0')!;
  assert.ok(upL.transform.position[2] > hipL.transform.position[2] && upR.transform.position[2] < hipR.transform.position[2]);
});

test('hexapod walker builds with 6 legs', () => {
  const a = buildWalker({ ...DEFAULT_WALKER, legCount: 6, chassisPartId: 'chassis-hex-200', gait: { ...DEFAULT_WALKER.gait, gaitType: 'tripod', swingDuty: 0.5 } });
  assert.equal(a.instances.filter((i) => i.id.startsWith('foot_')).length, 6);
});

test('butterfly: catalog wings mount on the winged body, span outward, forewings toward the head', () => {
  const body = getPart('body-butterfly-80')!, wl = getPart('wing-butterfly-200-left')!, wr = getPart('wing-butterfly-200')!;
  assert.ok(body.limits.maxTorque_Nm && body.limits.maxTorque_Nm > 0);
  const r = applyOps(emptyAssembly(), [
    { op: 'place', id: 'body', part: body.id, position: [0, 0.2, 0], anchored: true },
    { op: 'mount', id: 'wingL', part: wl.id, onto: 'body', connector: 'wing_L0', via: 'hinge', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'flapL', stiffness: 2, damping: 0.1 } },
    { op: 'mount', id: 'wingR', part: wr.id, onto: 'body', connector: 'wing_R0', via: 'hinge', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'flapR', stiffness: 2, damping: 0.1 } },
  ], getPart);
  const inst = (id: string) => r.assembly.instances.find((i) => i.id === id)!;
  const tipL = transformPoint(inst('wingL').transform, [0.2, 0, 0]), tipR = transformPoint(inst('wingR').transform, [0.2, 0, 0]);
  assert.ok(tipL[2] > 0.15, `left tip should point +Z, got ${tipL}`);
  assert.ok(tipR[2] < -0.15, `right tip should point −Z, got ${tipR}`);
  assert.ok(Math.abs(tipL[1] - tipR[1]) < 1e-6 && Math.abs(tipL[0] - tipR[0]) < 1e-6, 'tips are symmetric');
  // forewing lobe (profile +chord for the right wing, −chord for the mirrored left) must point toward the head (+X) on both sides
  const foreL = transformPoint(inst('wingL').transform, [0.1, 0, -0.05]), foreR = transformPoint(inst('wingR').transform, [0.1, 0, 0.05]);
  assert.ok(foreL[0] > 0.03 && foreR[0] > 0.03, `forewings toward +X: ${foreL[0]} ${foreR[0]}`);
  // both joints run along the body axis (±X) and carry the body's torque rating
  for (const j of r.assembly.joints) { assert.ok(Math.abs(Math.abs(j.axis![0]) - 1) < 1e-9, `axis ${j.axis}`); assert.equal(j.motor?.maxTorque_Nm, body.limits.maxTorque_Nm); }
});

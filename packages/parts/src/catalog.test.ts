import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, searchCatalog, generatePart, buildWalker, DEFAULT_WALKER, ParamError, AssemblyError, AssemblyOp, applyOps, emptyAssembly, getPart, mateTransform, transformPoint, summarize } from './index.ts';
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

test('gravity feed presets provide a free marble, clear railed path and deep receiver', () => {
  const marble = getPart('wood-marble-24')!;
  const chute = getPart('gravity-chute-160x54')!;
  const receiver = getPart('catch-cup-80x35')!;
  assert.deepEqual(marble.geometry[0].shape, { kind: 'sphere', radius: 0.012 });
  assert.ok(chute.params.width > marble.dimensions_m[2]);
  assert.ok(chute.params.railHeight >= marble.params.radius);
  assert.deepEqual(chute.geometry.map(({ shape, collide }) => [shape.kind, collide]),
    [['box', true], ['box', true], ['box', true]]);
  const [floor, leftRail, rightRail] = chute.geometry;
  assert.ok(floor.shape.kind === 'box' && leftRail.shape.kind === 'box' && rightRail.shape.kind === 'box');
  assert.equal(floor.shape.size[0], chute.params.length);
  assert.ok(Math.abs(rightRail.offset.position[2] - leftRail.offset.position[2] - rightRail.shape.size[2] - chute.params.width) < 1e-10);
  assert.deepEqual(chute.connectors.map(({ id, position, axis }) => [id, position, axis]), [
    ['mount', [0, -0.002, 0], [0, -1, 0]],
    ['entry', [-0.08, 0.002, 0], [-1, 0, 0]],
    ['exit', [0.08, 0.002, 0], [1, 0, 0]],
  ]);
  assert.ok(receiver.params.depth > marble.dimensions_m[1]);
  assert.ok(receiver.geometry.every(({ collide }) => collide));
  assert.ok(receiver.connectors.some(({ id }) => id === 'mount'));
});

test('generatePart rejects out-of-range params', () => {
  assert.throws(() => generatePart('beam', { length: 5 }), ParamError);
  assert.throws(() => generatePart('beam', { bogus: 1 }), ParamError);
});

test('drive discs, clevises, and bell cranks expose usable pivots in both catalog sizes', () => {
  for (const id of ['eccentric-disc-40', 'eccentric-disc-70']) {
    const part = getPart(id)!;
    assert.ok(searchCatalog('eccentric', { category: 'cranks' }).some((result) => result.id === id));
    assert.deepEqual(part.connectors.find((connector) => connector.id === 'pin')?.position, [part.params.throw, 0, part.params.thickness * 1.5]);
  }
  for (const id of ['clevis-12', 'clevis-20']) {
    const part = getPart(id)!;
    assert.ok(searchCatalog('clevis', { category: 'joints' }).some((result) => result.id === id));
    assert.deepEqual(part.connectors.find((connector) => connector.id === 'pin')?.position, [0, part.params.rise, 0]);
  }
  for (const id of ['bell-crank-30x40', 'bell-crank-50x65']) {
    const part = getPart(id)!;
    assert.ok(searchCatalog('bell crank', { category: 'linkages' }).some((result) => result.id === id));
    assert.deepEqual(part.connectors.find((connector) => connector.id === 'input')?.position.slice(0, 2), [part.params.input, 0]);
    assert.deepEqual(part.connectors.find((connector) => connector.id === 'output')?.position.slice(0, 2), [0, part.params.output]);
  }
  assert.throws(() => generatePart('eccentric_disc', { radius: 0.02, throw: 0.03 }), ParamError);

  const { assembly } = applyOps(emptyAssembly(), [
    { op: 'place', id: 'drive', part: 'eccentric-disc-40', position: [0, 0.1, 0], anchored: true },
    { op: 'mount', id: 'link', part: 'link-40', onto: 'drive', connector: 'pin', via: 'pivot_a_back', joint: 'revolute', spin_deg: 0, offset_m: 0 },
  ], getPart);
  assert.deepEqual(assembly.joints[0].axis, [0, 0, 1]);
  const drivePin = getPart('eccentric-disc-40')!.connectors.find((connector) => connector.id === 'pin')!;
  const linkPivot = getPart('link-40')!.connectors.find((connector) => connector.id === 'pivot_a_back')!;
  const drivePoint = transformPoint(assembly.instances[0].transform, drivePin.position);
  const linkPoint = transformPoint(assembly.instances[1].transform, linkPivot.position);
  assert.ok(drivePoint.every((coordinate, axis) => Math.abs(coordinate - linkPoint[axis]) < 1e-9));
});

test('eccentric cam has a colliding dwell core and a raised contact lobe on the drive plane', () => {
  for (const [id, lift] of [['eccentric-cam-48', 0.013], ['eccentric-cam-74', 0.019]] as const) {
    const part = getPart(id)!;
    const [core, lobe] = part.geometry;
    for (const piece of [core, lobe]) {
      assert.ok(piece.collide);
      assert.equal(piece.shape.kind, 'cylinder');
      assert.equal(piece.shape.axis, 'z');
      assert.equal(piece.shape.height, part.params.thickness);
    }
    assert.ok(core.shape.kind === 'cylinder' && lobe.shape.kind === 'cylinder');
    assert.deepEqual(core.offset.position, [0, 0, 0]);
    assert.ok(Math.abs(lobe.offset.position[0] + lobe.shape.radius - core.shape.radius - lift) < 1e-9);
    assert.deepEqual(part.connectors.find((connector) => connector.id === 'drive')?.axis, [0, 0, -1]);
    assert.equal(part.connectors.find((connector) => connector.id === 'shaft')?.kind, 'fixed');
  }
  assert.throws(() => generatePart('eccentric_cam', { eccentricity: 0.004 }), ParamError, 'a hidden lobe cannot lift');
  assert.throws(() => generatePart('eccentric_cam', { eccentricity: 0.075 }), ParamError, 'a detached lobe cannot turn with the core');
});

test('follower mounts upright in either matching guide with only the shoe making contact', () => {
  for (const [followerId, guideId] of [['cam-follower-65', 'follower-guide-6'], ['cam-follower-98', 'follower-guide-9']]) {
    const follower = getPart(followerId)!;
    const guide = getPart(guideId)!;
    const [shoe, stem] = follower.geometry;
    assert.ok(shoe.collide && !stem.collide);
    assert.ok(guide.geometry.every((piece) => !piece.collide));
    const bushing = guide.geometry.find((piece) => piece.shape.kind === 'revolve')?.shape;
    assert.ok(bushing?.kind === 'revolve');
    assert.ok(Math.min(...bushing.profile.map(([radius]) => radius)) > Math.SQRT1_2 * follower.params.stemSize, 'bore clears the stem corners');
    const { assembly } = applyOps(emptyAssembly(), [
      { op: 'place', id: 'guide', part: guideId, position: [0, 0.16, 0], anchored: true },
      { op: 'mount', id: 'follower', part: followerId, onto: 'guide', connector: 'guide', via: 'slide', joint: 'prismatic', spin_deg: 0, offset_m: 0 },
    ], getPart);
    const mounted = assembly.instances[1].transform;
    const mount = follower.connectors.find((connector) => connector.id === 'mount')!;
    assert.deepEqual(assembly.joints[0].axis, [0, 1, 0]);
    assert.ok(mounted.position[1] < 0.16, 'shoe starts below the guide');
    assert.ok(transformPoint(mounted, mount.position)[1] > 0.16, 'payload remains above the guide');
  }
});

test('pillow blocks and adjustable linkage plates mount shafts and selectable passive pivots', () => {
  const { assembly } = applyOps(emptyAssembly(), [
    { op: 'place', id: 'frame', part: 'plate-120x80', position: [0, 0.02, 0], anchored: true },
    { op: 'mount', id: 'bearing', part: 'pillow-block-8', onto: 'frame', connector: 'top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'axle', part: 'shaft-8x200', onto: 'bearing', connector: 'bore_front', via: 'end_a', joint: 'revolute', spin_deg: 0, offset_m: 0 },
    { op: 'place', id: 'lever', part: 'adjustable-link-60', position: [0.2, 0.1, 0], anchored: true },
    { op: 'mount', id: 'near_link', part: 'link-40', onto: 'lever', connector: 'pin_4', via: 'pivot_a_back', joint: 'revolute', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'far_link', part: 'link-40', onto: 'lever', connector: 'pin_5', via: 'pivot_a_back', joint: 'revolute', spin_deg: 0, offset_m: 0 },
  ], getPart);
  const [baseJoint, shaftJoint, nearJoint, farJoint] = assembly.joints;
  assert.equal(baseJoint.type, 'fixed');
  assert.equal(shaftJoint.type, 'revolute');
  assert.deepEqual(shaftJoint.axis, [0, 0, 1]);
  assert.deepEqual(nearJoint.axis, [0, 0, 1]);
  assert.deepEqual(farJoint.axis, [0, 0, 1]);
  assert.ok(Math.abs(farJoint.anchor![0] - nearJoint.anchor![0] - 0.015) < 1e-9, 'selecting a new pin changes the lever arm');
});

test('contact-enabled mounts keep their passive joint', () => {
  const assembly = applyOps(emptyAssembly(), [
    AssemblyOp.parse({ op: 'place', id: 'tower', part: 'tower-300', position: [0, 0, 0], anchored: true }),
    AssemblyOp.parse({ op: 'mount', id: 'wheel', part: 'spoked-wheel-200', onto: 'tower',
      connector: 'axle', via: 'hub', joint: 'revolute', contact: true }),
  ], getPart).assembly;
  assert.equal(assembly.instances.find(({ id }) => id === 'wheel')?.free, true);
  assert.equal(assembly.joints.length, 1);
  assert.equal(assembly.joints[0].type, 'revolute');
  assert.equal(assembly.joints[0].motor, undefined);
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
  assert.deepEqual(r.assembly.joints.map(joint => joint.a.connectorId), Array.from({ length: 8 }, (_, index) => `rim_${index}`));
  for (const joint of r.assembly.joints) {
    const parent = r.assembly.instances.find(instance => instance.id === joint.a.instanceId)!;
    const child = r.assembly.instances.find(instance => instance.id === joint.b.instanceId)!;
    const parentPoint = transformPoint(parent.transform, wheel.connectors.find(connector => connector.id === joint.a.connectorId)!.position);
    const childPoint = transformPoint(child.transform, gondola.connectors.find(connector => connector.id === joint.b.connectorId)!.position);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(parentPoint[axis] - childPoint[axis]) < 1e-9);
      assert.ok(Math.abs(parentPoint[axis] - joint.anchor![axis]) < 1e-9);
    }
  }
  const s = summarize(r.assembly); assert.ok(s.totalMass_kg > 0);
});

test('pattern preserves a valid external axis with axial spacing and leaves both-copied joints unchanged', () => {
  const original = applyOps(emptyAssembly(), [
    { op: 'place', id: 'wheel', part: 'spoked-wheel-400', position: [0, .3, 0] },
    AssemblyOp.parse({ op: 'mount', id: 'cab', part: 'gondola-40', onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'revolute', motor: { controlId: 'level', stiffness: 3, damping: .2 } }),
  ], getPart).assembly;
  original.controller.drives = [{ controlId: 'level', mode: 'velocity', rampIn_s: .1, profile: { kind: 'constant', value: -.7 } }];
  const alongAxis = applyOps(original, [AssemblyOp.parse({ op: 'pattern', instances: ['cab'], kind: 'linear', step: [0, 0, .11], count: 2 })], getPart).assembly;
  assert.equal(alongAxis.joints[1].a.connectorId, 'rim_0', 'coaxial spacing does not need a new connector');
  assert.ok(Math.abs(alongAxis.joints[1].anchor![2] - original.joints[0].anchor![2] - .11) < 1e-9);

  const both = applyOps(original, [AssemblyOp.parse({ op: 'pattern', instances: ['wheel', 'cab'], kind: 'polar', axis: 'z', center: [0, .3, 0], count: 2 })], getPart).assembly;
  const joint = both.joints[1];
  assert.deepEqual(joint.a, { instanceId: 'wheel_1', connectorId: 'rim_0' });
  assert.deepEqual(joint.b, { instanceId: 'cab_1', connectorId: 'hanger' });
  assert.deepEqual(joint.axis, original.joints[0].axis);
  assert.deepEqual(joint.motor, { ...original.joints[0].motor, controlId: 'level_1' });
  assert.deepEqual(both.controller.drives[1], { ...original.controller.drives[0], controlId: 'level_1' });
});

test('remapping a legacy joint onto an antiparallel bearing preserves its effective motor axis', () => {
  const original = structuredClone(applyOps(emptyAssembly(), [
    { op: 'place', id: 'wheel', part: 'spoked-wheel-400', position: [0, .3, 0] },
    AssemblyOp.parse({ op: 'mount', id: 'cab', part: 'gondola-40', onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'revolute', motor: { controlId: 'level', stiffness: 3, damping: .2 } }),
  ], getPart).assembly);
  delete original.joints[0].axis;
  original.controller.drives = [{ controlId: 'level', mode: 'velocity', rampIn_s: .1, profile: { kind: 'constant', value: -.7 } }];
  const opposite = original.parts.find(part => part.id === 'spoked-wheel-400')!.connectors.find(connector => connector.id === 'rim_4')!;
  opposite.axis = [0, 0, -1];
  const patterned = applyOps(original, [AssemblyOp.parse({ op: 'pattern', instances: ['cab'], kind: 'polar', axis: 'z', center: [0, .3, 0], count: 2 })], getPart).assembly;
  assert.equal(original.joints[0].axis, undefined, 'do not rewrite saved source joints');
  assert.equal(patterned.joints[0].axis, undefined);
  assert.equal(patterned.joints[1].a.connectorId, 'rim_4');
  assert.deepEqual(patterned.joints[1].axis, [0, 0, 1], 'use the transformed original fallback, not the replacement connector’s negative normal');
  assert.deepEqual(patterned.joints[1].motor, { ...original.joints[0].motor, controlId: 'level_1' });
  assert.deepEqual(patterned.controller.drives[1], { ...original.controller.drives[0], controlId: 'level_1' });
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

test('move carries everything mounted on the moved instance and shifts joint anchors', () => {
  const r0 = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.005, 0], anchored: true },
    { op: 'mount', id: 'servo', part: 'servo-mg996r', onto: 'base', connector: 'top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'arm', part: 'leg-bar-100', onto: 'servo', connector: 'horn', via: 'pivot', joint: 'revolute', spin_deg: 0, offset_m: 0, motor: { controlId: 'swing', stiffness: 5, damping: 0.2 } },
  ], getPart);
  const before = Object.fromEntries(r0.assembly.instances.map((x) => [x.id, [...x.transform.position]]));
  const anchorBefore = [...r0.assembly.joints.find((j) => j.id === 'j_arm')!.anchor!];
  const r = applyOps(r0.assembly, [{ op: 'move', id: 'base', translate: [0, 0.1, 0], withAttached: true }], getPart);
  for (const x of r.assembly.instances) assert.ok(Math.abs(x.transform.position[1] - before[x.id][1] - 0.1) < 1e-9, `${x.id} should move up 0.1 m`);
  assert.ok(Math.abs(r.assembly.joints.find((j) => j.id === 'j_arm')!.anchor![1] - anchorBefore[1] - 0.1) < 1e-9, 'joint anchor follows');
  assert.ok(r.summary[0].includes('+2 attached'), r.summary[0]);
  const solo = applyOps(r0.assembly, [{ op: 'move', id: 'base', translate: [0, 0.1, 0], withAttached: false }], getPart);
  assert.ok(Math.abs(solo.assembly.instances.find((x) => x.id === 'arm')!.transform.position[1] - before.arm[1]) < 1e-9, 'withAttached:false moves only the base');
});

test('a first batch that mounts onto an unplaced "body" gets the chassis placed automatically; re-using an id replaces', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'mount', id: 'hipL0', part: 'servo-ds3218', onto: 'body', connector: 'hip_L0', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'hipR2', part: 'servo-ds3218', onto: 'body', connector: 'hip_R2', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart, undefined, catalog);
  const body = r.assembly.instances.find((x) => x.id === 'body');
  assert.ok(body && body.partId === 'chassis-hex-200', `auto-placed ${body?.partId}`);
  assert.ok(r.summary[0].startsWith('auto-placed body as chassis-hex-200'), r.summary[0]);
  assert.equal(r.assembly.instances.length, 3);
  const r2 = applyOps(r.assembly, [{ op: 'mount', id: 'hipL0', part: 'servo-mg996r', onto: 'body', connector: 'hip_L0', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 }], getPart, undefined, catalog);
  assert.equal(r2.assembly.instances.filter((x) => x.id === 'hipL0').length, 1);
  assert.equal(r2.assembly.instances.find((x) => x.id === 'hipL0')!.partId, 'servo-mg996r');
  assert.ok(r2.summary.some((l) => l === 'replaced hipL0'), r2.summary.join('|'));
  // ambiguous connectors (top exists on many parts) are not guessed for an arbitrary id…
  assert.throws(() => applyOps(emptyAssembly(), [{ op: 'mount', id: 'x', part: 'beam-100', onto: 'frame', connector: 'top', via: 'end_a', joint: 'fixed', spin_deg: 0, offset_m: 0 }], getPart, undefined, catalog), /Unknown instance "frame"/);
  // …but a "base" is a plate: base.top gets the purpose-made base plate
  const rb = applyOps(emptyAssembly(), [{ op: 'mount', id: 'post', part: 'beam-100', onto: 'base', connector: 'top', via: 'end_a', joint: 'fixed', spin_deg: 0, offset_m: 0 }], getPart, undefined, catalog);
  assert.equal(rb.assembly.instances.find((x) => x.id === 'base')!.partId, 'base-plate-300x200');
});

test('an unplaced "base" that only plates can be is auto-placed as the largest plate', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'mount', id: 'servo', part: 'servo-high-torque-35', onto: 'base', connector: 'top_back', via: 'bottom', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart, undefined, catalog);
  const base = r.assembly.instances.find((x) => x.id === 'base');
  assert.ok(base && base.anchored, 'base placed and anchored');
  assert.equal(base!.partId, 'base-plate-300x200');
});

test('joint "free" sets a payload down on a connector without creating a joint', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'place', id: 'base', part: 'base-plate-300x200', position: [0, 0.005, 0], anchored: true },
    { op: 'mount', id: 'tray', part: 'tray-45', onto: 'base', connector: 'top', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'pizza', part: 'foam-pizza-80', onto: 'tray', connector: 'payload', via: 'bottom', joint: 'free', spin_deg: 0, offset_m: 0 },
  ], getPart);
  const pizza = r.assembly.instances.find((x) => x.id === 'pizza')!;
  const tray = r.assembly.instances.find((x) => x.id === 'tray')!;
  assert.ok(pizza.free && !pizza.anchored);
  assert.equal(r.assembly.joints.length, 1, 'only the tray joint');
  assert.ok(pizza.transform.position[1] > tray.transform.position[1] && pizza.transform.position[1] - tray.transform.position[1] < 0.03, `pizza sits just above the tray floor: ${pizza.transform.position[1] - tray.transform.position[1]}`);
});

test('an unplaced "tower" with an axle is auto-placed as the tallest tower, and the summary lowest point is the real one', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'mount', id: 'rotor', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', spin_deg: 0, offset_m: 0.03 },
  ], getPart, undefined, catalog);
  const tower = r.assembly.instances.find((x) => x.id === 'tower');
  assert.ok(tower && tower.anchored, 'tower placed and anchored');
  assert.equal(tower!.partId, 'tower-500');
  const s = summarize(r.assembly);
  assert.ok(s.lowestPoint_m !== null && s.lowestPoint_m > -0.01, `lowest point ${s.lowestPoint_m} should sit on the ground, not below it`);
});

test('a batch that mounts onto an id it places later is reordered, not auto-placed', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower1', connector: 'axle', via: 'hub', joint: 'revolute', spin_deg: 0, offset_m: 0.03 },
    { op: 'place', id: 'tower1', part: 'tower-300', position: [0, 0.15, 0], anchored: true },
  ], getPart, undefined, catalog);
  assert.equal(r.assembly.instances.length, 2);
  assert.equal(r.assembly.instances.find((x) => x.id === 'tower1')!.partId, 'tower-300');
  assert.equal(r.assembly.joints.length, 1, 'the wheel stays joined to the tower the model placed');
  assert.ok(r.summary[0].startsWith('reordered: placed tower1'), r.summary[0]);
  assert.ok(!r.summary.some((x) => x.startsWith('auto-placed')), 'no guess when the batch places it itself');
});

test('late mounted parents are resolved in order and retain all eight child joints', () => {
  const base = AssemblyOp.parse({ op: 'place', id: 'base', part: 'base-plate-300x200', position: [.03, .005, -.04], anchored: true });
  const stand = AssemblyOp.parse({ op: 'mount', id: 'stand', part: 'tower-150', onto: 'base', connector: 'top', via: 'base' });
  const hub = AssemblyOp.parse({ op: 'mount', id: 'hub', part: 'radial-hub-8x160', onto: 'stand', connector: 'top', via: 'mount' });
  const shoulders = Array.from({ length: 8 }, (_, index) => AssemblyOp.parse({
    op: 'mount', id: `sh${index}`, part: 'servo-ds3218', onto: 'hub', connector: `hinge_${index}`, via: 'mount',
  }));
  const expected = applyOps(emptyAssembly(), [base, stand, hub, ...shoulders], getPart).assembly;
  for (const library of [undefined, catalog]) {
    const result = applyOps(emptyAssembly(), [...shoulders, stand, base, hub], getPart, undefined, library);
    assert.deepEqual(result.assembly, expected);
    assert.equal(result.assembly.joints.filter((joint) => joint.a.instanceId === 'hub').length, 8);
    assert.ok(!result.summary.some((entry) => entry.startsWith('auto-placed') || entry.startsWith('replaced')));
  }
});

test('a circular forward mount fails atomically without guessing a library part', () => {
  const input = emptyAssembly();
  const before = structuredClone(input);
  const cycle = [
    { op: 'mount', id: 'left', part: 'beam-100', onto: 'right', connector: 'end_a', via: 'end_b' },
    { op: 'mount', id: 'right', part: 'beam-100', onto: 'left', connector: 'end_a', via: 'end_b' },
  ].map((op) => AssemblyOp.parse(op));
  assert.throws(() => applyOps(input, cycle, getPart, undefined, catalog),
    (error) => error instanceof AssemblyError && error.opIndex === 0 && /Circular mount dependency/.test(error.message));
  assert.deepEqual(input, before);
});

test('a pattern-produced parent keeps its authored order before an explicit replacement', () => {
  const ops = [
    { op: 'place', id: 'stand', part: 'tower-150', position: [0, .075, 0], anchored: true },
    { op: 'place', id: 'hub', part: 'radial-hub-8x160', position: [0, .2, 0] },
    { op: 'pattern', kind: 'linear', instances: ['hub'], step: [.15, 0, 0] },
    { op: 'mount', id: 'arm', part: 'servo-ds3218', onto: 'hub_1', connector: 'hinge_0', via: 'mount' },
    { op: 'mount', id: 'hub_1', part: 'radial-hub-8x160', onto: 'stand', connector: 'top', via: 'mount' },
  ].map((op) => AssemblyOp.parse(op));
  const { assembly, summary } = applyOps(emptyAssembly(), ops, getPart, undefined, catalog);
  assert.ok(!summary.some((entry) => entry.startsWith('reordered') || entry.startsWith('auto-placed')));
  assert.equal(summary.filter((entry) => entry === 'replaced hub_1').length, 1);
  assert.deepEqual(assembly.joints.map((joint) => joint.id), ['j_hub_1'], 'the intentional replacement removes the old arm joint');
});

test('a forward mount producer reports its original operation index on failure', () => {
  const ops = [
    { op: 'mount', id: 'arm', part: 'beam-100', onto: 'hub', connector: 'hinge_0', via: 'end_a' },
    { op: 'place', id: 'stand', part: 'tower-150', position: [0, .075, 0], anchored: true },
    { op: 'mount', id: 'hub', part: 'missing-hub', onto: 'stand', connector: 'top' },
  ].map((op) => AssemblyOp.parse(op));
  assert.throws(() => applyOps(emptyAssembly(), ops, getPart, undefined, catalog),
    (error) => error instanceof AssemblyError && error.opIndex === 2 && /Unknown part "missing-hub"/.test(error.message));
});

test('an unplaced quadruped "body" is auto-placed as the mid-size quad chassis when the family ties on connectors', () => {
  const r = applyOps(emptyAssembly(), [
    { op: 'mount', id: 'hip_L0', part: 'servo-ds3218', onto: 'body', connector: 'hip_L0', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
    { op: 'mount', id: 'hip_R1', part: 'servo-ds3218', onto: 'body', connector: 'hip_R1', via: 'mount', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart, undefined, catalog);
  const body = r.assembly.instances.find((x) => x.id === 'body');
  assert.equal(body?.partId, 'chassis-quad-160', `auto-placed ${body?.partId}`);
  assert.ok(r.summary[0].startsWith('auto-placed body as chassis-quad-160'), r.summary[0]);
});

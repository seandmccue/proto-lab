import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, AssemblyOp, emptyAssembly, getPart, quatFromAxisAngle } from '@protolab/parts';
import type { Assembly } from '@protolab/schema';
import { inspectArticulatedMateAlignment } from './assembly-integrity.ts';

function assemble(ops: unknown[], initial = emptyAssembly()) {
  return applyOps(initial, ops.map(op => AssemblyOp.parse(op)), getPart).assembly;
}

function wheel() {
  return assemble([
    { op: 'place', id: 'stand', part: 'tower-300', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-200', onto: 'stand', connector: 'axle', via: 'hub', joint: 'revolute' },
  ]);
}

const near = (actual: number | null | undefined, expected: number) =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-8, `expected ${expected}, got ${actual}`);

test('radial mate gaps are rejected even below connect’s legacy distance allowance, without changing the draft', () => {
  const initial = wheel();
  assert.deepEqual(inspectArticulatedMateAlignment(initial), []);
  for (const gap of [.0185, .025]) {
    const moved = assemble([{ op: 'move', id: 'wheel', translate: [gap, 0, 0], withAttached: false }], initial);
    const saved = structuredClone(moved);
    const [issue, ...others] = inspectArticulatedMateAlignment(moved);
    assert.equal(others.length, 0);
    assert.equal(issue.kind, 'articulated_joint_misalignment');
    assert.equal(issue.jointId, moved.joints[0].id);
    assert.deepEqual(issue.instanceIds, ['stand', 'wheel']);
    assert.deepEqual(issue.connectorIds, ['axle', 'hub']);
    near(issue.radialGap_m, gap);
    near(issue.axisError_deg, 0);
    near(issue.anchorRadialGap_m, 0);
    assert.equal(issue.nearestGap_m, null, 'radial offset is not a material surface distance');
    assert.match(issue.suggestion, /stand\.axle and wheel\.hub/);
    assert.match(issue.suggestion, /mount or bridge/);
    assert.deepEqual(moved, saved);
  }
});

test('coaxial shaft spacing, opposite axes, and rounded submillimetre poses are valid', () => {
  const spaced = assemble([{ op: 'move', id: 'wheel', translate: [.001, 0, .11], withAttached: false }], wheel());
  assert.deepEqual(inspectArticulatedMateAlignment(spaced), []);
  // Mount uses opposite endpoint normals; either direction describes the same bearing axis.
  const reversed = structuredClone(spaced);
  reversed.joints[0].axis = [0, 0, -1];
  assert.deepEqual(inspectArticulatedMateAlignment(reversed), []);
  const tooFar = assemble([{ op: 'move', id: 'wheel', translate: [.00001, 0, 0] }], spaced);
  near(inspectArticulatedMateAlignment(tooFar)[0].radialGap_m, .00101);
});

test('slider travel along its axis is valid but a sideways carriage move is not', () => {
  const slider = assemble([
    { op: 'place', id: 'actuator', part: 'actuator-150', position: [0, .01, 0], anchored: true },
    { op: 'mount', id: 'carriage', part: 'carriage-20', onto: 'actuator', connector: 'rod', via: 'rail_face', joint: 'prismatic' },
    { op: 'move', id: 'carriage', translate: [.12, 0, 0] },
  ]);
  assert.deepEqual(inspectArticulatedMateAlignment(slider), []);
  const skewed = assemble([{ op: 'move', id: 'carriage', translate: [0, .0185, 0] }], slider);
  near(inspectArticulatedMateAlignment(skewed)[0].radialGap_m, .0185);
});

test('rotated endpoint axes and stale saved joint axes are measured independently', () => {
  const tilted = wheel();
  tilted.instances[1].transform.rotation = quatFromAxisAngle([1, 0, 0], Math.PI / 180 * 2);
  near(inspectArticulatedMateAlignment(tilted)[0].axisError_deg, 2);
  tilted.instances[1].transform.rotation = quatFromAxisAngle([1, 0, 0], Math.PI / 180 * .5);
  assert.deepEqual(inspectArticulatedMateAlignment(tilted), []);
  const stale = wheel();
  stale.joints[0].axis = [1, 0, 0];
  near(inspectArticulatedMateAlignment(stale)[0].axisError_deg, 90);
});

test('explicit anchors may move along the axis but cannot remain beside a re-mated hinge', () => {
  const stale = wheel();
  assert.ok(stale.joints[0].anchor);
  stale.joints[0].anchor[2] += .11;
  assert.deepEqual(inspectArticulatedMateAlignment(stale), []);
  stale.joints[0].anchor[0] += .02;
  const [issue] = inspectArticulatedMateAlignment(stale);
  near(issue.radialGap_m, 0);
  near(issue.anchorRadialGap_m, .02);
});

test('a real two-crank bridge keeps both passive rod mates valid', () => {
  const mechanism = assemble([
    { op: 'place', id: 'crank_a', part: 'crank-30', position: [0, .2, 0] },
    { op: 'place', id: 'crank_b', part: 'crank-30', position: [.08, .2, 0] },
    { op: 'bridge', id: 'rod', part: 'link-80', a: 'crank_a', a_connector: 'pin', via_a: 'pivot_a', b: 'crank_b', b_connector: 'pin', via_b: 'pivot_b' },
  ]);
  assert.equal(mechanism.joints.filter(joint => joint.type === 'revolute').length, 2);
  assert.deepEqual(inspectArticulatedMateAlignment(mechanism), []);
});

test('patterns remap only unique existing bearings; missing or ambiguous matches remain rejected', () => {
  for (const variant of ['valid', 'missing', 'ambiguous'] as const) {
    const source = structuredClone(assemble([
      { op: 'place', id: 'wheel', part: 'spoked-wheel-400', position: [0, .3, 0] },
      { op: 'mount', id: 'cab', part: 'gondola-40', onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'revolute' },
    ]));
    const part = source.parts.find(part => part.id === 'spoked-wheel-400')!;
    const target = part.connectors.find(connector => connector.id === 'rim_1')!;
    // Fixed connector faces are permitted bearing endpoints in mount/connect.
    target.kind = 'fixed';
    if (variant === 'missing') part.connectors = part.connectors.filter(connector => connector.id !== target.id);
    if (variant === 'ambiguous') part.connectors.push({ ...structuredClone(target), id: 'other_same_bearing' });
    const saved = structuredClone(source);
    const patterned = assemble([{ op: 'pattern', instances: ['cab'], kind: 'polar', axis: 'z', center: [0, .3, 0], count: 8 }], source);
    assert.deepEqual(source, saved);
    assert.deepEqual(patterned.parts, saved.parts, 'pattern cannot fabricate connectors');
    const issues = inspectArticulatedMateAlignment(patterned);
    if (variant === 'valid') {
      assert.deepEqual(issues, []);
      assert.equal(patterned.joints[1].a.connectorId, 'rim_1');
    } else {
      assert.equal(patterned.joints[1].a.connectorId, 'rim_0', 'do not guess an unmatched or ambiguous replacement');
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].instanceIds, ['wheel', 'cab_1']);
      assert.ok(issues[0].radialGap_m! > .15);
    }
  }
});

test('missing and invalid mate data is actionable, while fixed and spring constraints are outside this check', () => {
  const corruptions: ((assembly: Assembly) => void)[] = [
    assembly => { assembly.joints[0].b.connectorId = 'missing'; },
    assembly => { assembly.joints[0].axis = [0, 0, 0]; },
    assembly => { assembly.joints[0].axis = [Infinity, 0, 0]; },
    assembly => { assembly.joints[0].anchor = [0, NaN, 0]; },
    assembly => { assembly.instances[1].transform.position[0] = NaN; },
  ];
  for (const corrupt of corruptions) {
    const assembly = wheel();
    corrupt(assembly);
    const [issue] = inspectArticulatedMateAlignment(assembly);
    assert.equal(issue.kind, 'articulated_joint_misalignment');
    assert.equal(typeof issue.measurementError, 'string');
    assert.equal(issue.radialGap_m, null);
    assert.deepEqual(issue.instanceIds, ['stand', 'wheel']);
  }
  for (const type of ['fixed', 'spring'] as const) {
    const assembly = wheel();
    assembly.joints[0].type = type;
    assembly.joints[0].axis = [0, 0, 0];
    assembly.instances[1].transform.position[0] += .1;
    assert.deepEqual(inspectArticulatedMateAlignment(assembly), []);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWalker, DEFAULT_WALKER, emptyAssembly, getPart, quatFromAxisAngle } from '@protolab/parts';
import { IDENTITY, type Assembly, type Instance, type Joint, type PartDefinition, type Shape, type Vec3 } from '@protolab/schema';
import { auditAssemblyIntegrity } from './index.ts';

function solid(id: string, shape: Shape = { kind: 'box', size: [.10, .10, .10] }): PartDefinition {
  return {
    ...getPart('block-40')!, id, name: id, kind: 'designed',
    source: { kind: 'designed', license: 'CC0-1.0', creator: 'Test fixture' },
    geometry: [{ shape, offset: IDENTITY, role: 'structure', collide: true }],
  };
}

function instance(part: PartDefinition, id: string, position: Vec3, flags: Partial<Pick<Instance, 'anchored' | 'free'>> = {}): Instance {
  return { id, partId: part.id, label: id, transform: { ...IDENTITY, position }, anchored: false, free: false, ...flags };
}

function fixed(first: string, second: string): Joint {
  return { id: `${first}_${second}`, type: 'fixed', a: { instanceId: first, connectorId: 'top' }, b: { instanceId: second, connectorId: 'bottom' } };
}

function fixture(parts: PartDefinition[], instances: Instance[], joints: Joint[] = []): Assembly {
  return { ...emptyAssembly(), parts, instances, joints };
}

test('integrity distinguishes grounded fixtures, separately anchored panels and detached non-free parts', async () => {
  const block = solid('block');
  const assembly = fixture([block], [
    instance(block, 'base', [0, .05, 0], { anchored: true }),
    instance(block, 'separate_floor_fixture', [.4, .05, 0], { anchored: true }),
    instance(block, 'separately_anchored_panel', [0, .15, 0], { anchored: true }),
    instance(block, 'loose_trim', [.15, .22, 0]),
    instance(block, 'free_payload', [0, .4, 0], { free: true }),
    instance(block, 'grounded_nonfree', [.8, .05, 0]),
  ]);
  const issues = await auditAssemblyIntegrity(assembly);
  assert.deepEqual(issues.map(({ kind, instanceIds }) => [kind, instanceIds]), [
    ['unsupported_anchor', ['separately_anchored_panel']],
    ['detached_part', ['loose_trim']],
  ]);
  assert.equal(issues[0].nearestInstanceId, 'base');
  assert.ok(issues[0].nearestGap_m! < 1e-6);
  assert.ok(Math.abs(issues[0].groundGap_m! - .10) < 1e-6);
  assert.ok(Math.abs(issues[1].groundGap_m! - .17) < 1e-6);
});

test('a declared fixed joint needs a material path, but an intervening bracket can provide it', async () => {
  const block = solid('block');
  const foot = instance(block, 'base', [0, .05, 0], { anchored: true });
  const top = instance(block, 'panel', [0, .25, 0]);
  const joint = fixed('base', 'panel');
  const issues = await auditAssemblyIntegrity(fixture([block], [foot, top], [joint]));
  const gap = issues.find(({ kind }) => kind === 'fixed_joint_gap');
  assert.equal(gap?.jointId, joint.id);
  assert.deepEqual(gap?.instanceIds, ['base', 'panel']);
  assert.ok(Math.abs(gap?.nearestGap_m! - .1) < 1e-6);
  assert.ok(issues.some(({ kind }) => kind === 'unsupported_anchor'));

  const brace = instance(block, 'brace', [0, .15, 0]);
  assert.deepEqual(await auditAssemblyIntegrity(fixture([block], [foot, top, brace], [joint, fixed('base', 'brace')])), []);
});

test('an elevated rigid subassembly still needs a mount unless it is intentionally free', async () => {
  const block = solid('block');
  const base = instance(block, 'base', [0, .05, 0], { anchored: true });
  const lower = instance(block, 'lower_clip', [0, .25, 0]);
  const upper = instance(block, 'upper_clip', [0, .35, 0]);
  const joint = fixed(lower.id, upper.id);
  const issues = await auditAssemblyIntegrity(fixture([block], [base, lower, upper], [joint]));
  assert.deepEqual(issues.map(({ kind, instanceIds }) => [kind, instanceIds]), [
    ['detached_part', [lower.id, upper.id]],
  ]);
  assert.deepEqual(await auditAssemblyIntegrity(fixture([block], [base, { ...lower, free: true }, upper], [joint])), []);
});

test('floor support uses actual solid distance rather than a rotated bounding box', async () => {
  const sphere = solid('sphere', { kind: 'sphere', radius: .05 });
  const rotated = instance(sphere, 'fixture', [0, .065, 0], { anchored: true });
  rotated.transform.rotation = quatFromAxisAngle([0, 0, 1], Math.PI / 4);
  const issues = await auditAssemblyIntegrity(fixture([sphere], [rotated]));
  assert.equal(issues[0]?.kind, 'unsupported_anchor');
  assert.ok(Math.abs(issues[0]?.groundGap_m! - .015) < 1e-6);
  rotated.transform.position[1] = .059;
  assert.deepEqual(await auditAssemblyIntegrity(fixture([sphere], [rotated])), []);
});

test('an articulated unanchored walker does not need a fixed base', async () => {
  assert.deepEqual(await auditAssemblyIntegrity(buildWalker(DEFAULT_WALKER)), []);
});

test('an articulated island needs an anchor or floor contact somewhere in its mechanism', async () => {
  const block = solid('block');
  const base = instance(block, 'base', [0, .05, 0], { anchored: true });
  const motor = instance(block, 'motor', [.3, .25, 0]);
  const rotor = instance(block, 'rotor', [.4, .25, 0], { free: true });
  const pivot: Joint = { ...fixed(motor.id, rotor.id), type: 'revolute' };
  const issues = await auditAssemblyIntegrity(fixture([block], [base, motor, rotor], [pivot]));
  assert.deepEqual(issues.map(({ kind, instanceIds }) => [kind, instanceIds]), [
    ['detached_part', [motor.id, rotor.id]],
  ]);
  assert.ok(Math.abs(issues[0].groundGap_m! - .20) < 1e-6);

  motor.transform.position[1] = .05;
  rotor.transform.position[1] = .05;
  assert.deepEqual(await auditAssemblyIntegrity(fixture([block], [base, motor, rotor], [pivot])), []);
});

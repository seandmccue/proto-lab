import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, emptyAssembly, getPart, quatFromAxisAngle, setDrives } from '@protolab/parts';
import { TestSpec, type Trace, type Vec3 } from '@protolab/schema';
import { runTest } from './index.ts';
import { measurePlanarOrbit } from './planar-orbit.ts';

const dt = 0.05;
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `expected ${expected}, got ${actual}`);

const pose = (position: Vec3, yaw = 0) => ({ position, rotation: quatFromAxisAngle([0, 1, 0], yaw) });
const circle = (origin: Vec3, radius: number, angle: number): Vec3 =>
  [origin[0] + radius * Math.cos(angle), origin[1], origin[2] + radius * Math.sin(angle)];

function nestedTrace(moonMoves = true): Trace {
  return {
    dt,
    frames: Array.from({ length: 81 }, (_, n) => {
      const a = 2 * Math.PI * n / 80;
      const sun = circle([0, 0, 0], 1, -2 * a);
      const earth = circle(sun, 0.2, a);
      const moon = circle(earth, 0.05, moonMoves ? -2 * a : 0);
      return { t: n * dt, joints: {}, bodies: { sun: pose(sun), earth: pose(earth, -a), moon: pose(moon) } };
    }),
  };
}

test('separates nested winding from carrier translation and removes reference rotation when requested', () => {
  const trace = nestedTrace();
  const earth = measurePlanarOrbit(trace, { body: 'earth', center: 'sun', plane: 'xz' });
  assert.ok(earth);
  near(earth.signedTurns, 1);
  near(earth.minRadius_m, 0.2);
  near(earth.maxRadius_m, 0.2);

  const moonPath = { body: 'moon', center: 'earth', plane: 'xz' as const };
  const world = measurePlanarOrbit(trace, moonPath);
  const pair = measurePlanarOrbit(trace, { ...moonPath, reference: { from: 'sun', to: 'earth' } });
  const quaternion = measurePlanarOrbit(trace, { ...moonPath, reference: 'earth' });
  assert.ok(world && pair && quaternion);
  near(world.signedTurns, -2);
  near(pair.signedTurns, -3);
  near(quaternion.signedTurns, -3);
  near(pair.minRadius_m, 0.05);
  near(pair.maxRadius_m, 0.05);
  assert.equal(pair.points.length, trace.frames.length);
  for (const [i, point] of pair.points.entries()) {
    near(point.t, trace.frames[i].t);
    near(point.u_m, quaternion.points[i].u_m);
    near(point.v_m, quaternion.points[i].v_m);
  }
});

test('shared translation does not give an orbit even when the center travels in a loop', () => {
  const measured = measurePlanarOrbit(nestedTrace(false), { body: 'moon', center: 'earth', plane: 'xz' });
  assert.ok(measured);
  near(measured.signedTurns, 0);
  near(measured.maxRadius_m, 0.05);
});

test('rejects unresolved centers, undefined reference directions, and missing samples', () => {
  const trace = nestedTrace();
  const path = { body: 'moon', center: 'earth', plane: 'xz' as const };
  assert.equal(measurePlanarOrbit(trace, { ...path, body: 'earth' }), null);
  assert.equal(measurePlanarOrbit(trace, { ...path, reference: { from: 'sun', to: 'sun' } }), null);
  trace.frames.splice(10, 1);
  assert.equal(measurePlanarOrbit(trace, path), null);
});

test('a simulator test can require an orbit radius band and minimum turns', async () => {
  const { assembly } = applyOps(emptyAssembly(), [
    { op: 'place', id: 'tower', part: 'tower-500', position: [0, 0, 0], anchored: true },
    { op: 'mount', id: 'wheel', part: 'spoked-wheel-400', onto: 'tower', connector: 'axle', via: 'hub', joint: 'revolute', spin_deg: 0, offset_m: 0.06, motor: { controlId: 'spin', stiffness: 0.5, damping: 0.2 } },
    { op: 'mount', id: 'marker', part: 'gondola-40', onto: 'wheel', connector: 'rim_0', via: 'hanger', joint: 'fixed', spin_deg: 0, offset_m: 0 },
  ], getPart);
  const driven = setDrives(assembly, [{ controlId: 'spin', mode: 'velocity', rampIn_s: 0.3, profile: { kind: 'constant', value: 3 } }]);
  const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };
  const orbit = { body: 'marker', center: 'wheel', plane: 'xy' as const, minTurns: 1, minRadius_m: 0.14, maxRadius_m: 0.28 };
  const spec = (orbits: (typeof orbit & { reference?: string })[]) => TestSpec.parse({
    kind: 'motion', id: 'orbit', duration_s: 4, measure: { orbits },
  });

  const result = await runTest(driven, { env, test: spec([orbit]) });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(Math.abs(result.metrics['marker.orbitSignedTurns']) >= 1);
  assert.ok(result.metrics['marker.orbitMinRadius_m'] >= 0.14);
  assert.ok(result.metrics['marker.orbitMaxRadius_m'] <= 0.28);

  const stationary = await runTest(driven, { env, test: spec([{ ...orbit, reference: 'wheel' }]) });
  assert.equal(stationary.passed, false);
  assert.ok(Math.abs(stationary.metrics['marker.orbitSignedTurns']) < 0.001);

  const tooSmall = await runTest(driven, { env, test: spec([{ ...orbit, minRadius_m: 0.25, maxRadius_m: 0.3 }]) });
  assert.equal(tooSmall.passed, false);
  assert.match(tooSmall.failureReasons.join(', '), /orbit radius fell to/);

  const duplicate = await runTest(driven, { env, test: spec([orbit, orbit]) });
  assert.equal(duplicate.passed, false);
  assert.match(duplicate.failureReasons.join(', '), /different body/);
});

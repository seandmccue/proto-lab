import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTest } from './index.ts';
import { buildDrawingAutomaton, drawingAutomatonTest, measureDrawingAutomaton } from './drawing-automaton.ts';

const env = { gravity_m_s2: 9.81, groundFriction: 0.9 };

test('one powered crank moves the passive pen around a closed two-axis path', async () => {
  const assembly = buildDrawingAutomaton();
  assert.deepEqual(assembly.controller.drives.map(({ controlId }) => controlId), ['draw_loop']);
  assert.equal(assembly.joints.filter((joint) => joint.motor).length, 1);
  assert.equal(assembly.joints.filter((joint) => joint.type === 'revolute').length, 4);

  const result = await runTest(assembly, { env, test: drawingAutomatonTest });
  assert.ok(result.passed, result.failureReasons.join(', '));
  assert.ok(result.metrics['pen_tip.travel_x_m'] >= 0.06);
  assert.ok(result.metrics['pen_tip.travel_y_m'] >= 0.045);
  const { loopClosure_m } = measureDrawingAutomaton(result);
  assert.ok(loopClosure_m !== null && loopClosure_m < 0.001, `Loop closure error was ${loopClosure_m} m`);
});

test('an unpowered crank fails the passive drawing test', async () => {
  const result = await runTest(buildDrawingAutomaton(), { env, test: drawingAutomatonTest, controller: { drives: [] } });
  assert.equal(result.passed, false);
  assert.ok(result.failureReasons.some((reason) => reason.includes('draw_loop')));
  assert.equal(result.failureReasons.filter((reason) => reason.startsWith('pen_tip travelled')).length, 2);
  assert.equal(measureDrawingAutomaton(result).loopClosure_m, null);
});

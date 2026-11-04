import { applyOps, emptyAssembly, generatePart, getPart, piece, setDrives, type AssemblyOp } from '@protolab/parts';
import type { TestResult, TestSpec, Vec3 } from '@protolab/schema';

const pivotHeight = 0.115;
const fixedSpan = 0.16;
const crankLength = 0.035;
const couplerLength = 0.14;
const rockerLength = 0.105;
const barThickness = 0.006;

export const drawingAutomatonTest: TestSpec = {
  kind: 'motion', id: 'draw_a_closed_curve', duration_s: 8,
  measure: {
    joints: ['draw_loop'], base: 'base', clearancePairs: [['pen_tip', 'board']], noGroundContact: ['pen_tip'],
    linearTravel: [
      { instance: 'pen_tip', axis: 'x', minTravel_m: 0.06 },
      { instance: 'pen_tip', axis: 'y', minTravel_m: 0.045 },
    ],
  },
  criteria: { minRevolutions: 3, maxBaseTilt_deg: 2, torqueWithinRating: true },
};

export function buildDrawingAutomaton() {
  const motor = getPart('gearmotor-37')!;
  const motorNose = motor.connectors.find((connector) => connector.id === 'shaft')!.position[0];
  const base = generatePart('plate', { length: 0.32, width: 0.20, thickness: 0.007 }, 'drawing-base');
  const board = generatePart('plate', { length: 0.29, width: 0.28, thickness: 0.004 }, 'drawing-board');
  board.geometry = [
    ...board.geometry.map((item) => ({ ...item, color: '#e8e6d9' })),
    ...[-0.135, 0.135].map((edge) => piece({ kind: 'box', size: [0.29, 0.004, 0.008] }, [0, 0.002, edge], '#3e5264', 'decor', undefined, { collide: false })),
    ...[-0.141, 0.141].map((edge) => piece({ kind: 'box', size: [0.008, 0.004, 0.28] }, [edge, 0.002, 0], '#3e5264', 'decor', undefined, { collide: false })),
  ];
  const stand = generatePart('beam', { length: pivotHeight, width: 0.015, height: 0.015 }, 'drawing-stand');
  const groundBar = generatePart('link', { length: fixedSpan, width: 0.015, thickness: barThickness }, 'drawing-ground-bar');
  const crank = generatePart('link', { length: crankLength, width: 0.013, thickness: barThickness }, 'drawing-crank');
  crank.geometry = crank.geometry.map((item) => ({ ...item, color: '#ec9b3e' }));
  const rocker = generatePart('link', { length: rockerLength, width: 0.013, thickness: barThickness }, 'drawing-rocker');
  rocker.geometry = rocker.geometry.map((item) => ({ ...item, color: '#507fbc' }));
  const coupler = generatePart('link', { length: couplerLength, width: 0.013, thickness: barThickness }, 'drawing-coupler');
  coupler.geometry = coupler.geometry.map((item) => ({ ...item, color: '#249e8d' }));

  const pen = getPart('marker-tip-8')!;
  const markerMount = pen.connectors.find((connector) => connector.id === 'mount')!;
  const penOffset: Vec3 = [0.03, 0.058, barThickness / 2 - markerMount.position[2]];
  coupler.geometry.push(piece({ kind: 'box', size: [0.008, penOffset[1], 0.005] }, [penOffset[0], penOffset[1] / 2, 0], '#249e8d'));
  coupler.connectors.push({ id: 'pen', position: [penOffset[0], penOffset[1], barThickness / 2], axis: [0, 0, 1], kind: 'fixed' });

  // The upper intersection of the coupler and rocker circles determines the starting pose.
  const pivotGap = fixedSpan - crankLength;
  const intersectionX = (couplerLength ** 2 - rockerLength ** 2 + pivotGap ** 2) / (2 * pivotGap);
  const elbowX = crankLength + intersectionX;
  const elbowRise = Math.sqrt(couplerLength ** 2 - intersectionX ** 2);
  const couplerAngle = Math.atan2(elbowRise, intersectionX);
  const rockerAngle = Math.atan2(elbowRise, elbowX - fixedSpan);
  const couplerCenter: Vec3 = [(crankLength + elbowX) / 2, pivotHeight + elbowRise / 2, 0.036];
  const penPosition: Vec3 = [
    couplerCenter[0] + Math.cos(couplerAngle) * penOffset[0] - Math.sin(couplerAngle) * penOffset[1],
    couplerCenter[1] + Math.sin(couplerAngle) * penOffset[0] + Math.cos(couplerAngle) * penOffset[1],
    couplerCenter[2] + penOffset[2],
  ];
  const parts = new Map([base, board, stand, groundBar, crank, rocker, coupler].map((part) => [part.id, part]));
  const ops: AssemblyOp[] = [
    { op: 'place', id: 'base', part: base.id, position: [fixedSpan / 2, 0.0035, -0.025], anchored: true },
    { op: 'place', id: 'board', part: board.id, label: 'Drawing backboard', position: [fixedSpan / 2, 0.147, -0.085], rotation_deg: [90, 0, 0], anchored: true },
    { op: 'place', id: 'motor_stand', part: stand.id, position: [0, pivotHeight / 2, 0.017], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'rocker_stand', part: stand.id, position: [fixedSpan, pivotHeight / 2, 0.017], rotation_deg: [0, 0, 90], anchored: true },
    { op: 'place', id: 'ground_bar', part: groundBar.id, position: [fixedSpan / 2, pivotHeight, 0.024], anchored: true },
    { op: 'place', id: 'motor', part: motor.id, position: [0, pivotHeight, 0.027 - motorNose], rotation_deg: [0, -90, 0], anchored: true },
    { op: 'place', id: 'crank', part: crank.id, label: 'Powered crank', position: [crankLength / 2, pivotHeight, 0.030] },
    { op: 'connect', a: 'motor', a_connector: 'shaft', b: 'crank', b_connector: 'pivot_a_back', joint: 'revolute', motor: { controlId: 'draw_loop', stiffness: 0.2, damping: 0.15 } },
    { op: 'place', id: 'coupler', part: coupler.id, label: 'Pen carrier', position: couplerCenter, rotation_deg: [0, 0, couplerAngle * 180 / Math.PI] },
    { op: 'connect', a: 'crank', a_connector: 'pivot_b', b: 'coupler', b_connector: 'pivot_a_back', joint: 'revolute' },
    { op: 'place', id: 'rocker', part: rocker.id, label: 'Passive rocker', position: [(fixedSpan + elbowX) / 2, pivotHeight + elbowRise / 2, 0.030], rotation_deg: [0, 0, rockerAngle * 180 / Math.PI] },
    { op: 'connect', a: 'ground_bar', a_connector: 'pivot_b', b: 'rocker', b_connector: 'pivot_a_back', joint: 'revolute' },
    { op: 'connect', a: 'rocker', a_connector: 'pivot_b', b: 'coupler', b_connector: 'pivot_b_back', joint: 'revolute' },
    { op: 'place', id: 'pen_tip', part: pen.id, label: 'Passive pen tip', position: penPosition, rotation_deg: [0, 0, couplerAngle * 180 / Math.PI] },
    { op: 'connect', a: 'coupler', a_connector: 'pen', b: 'pen_tip', b_connector: 'mount', joint: 'fixed' },
  ];
  return setDrives(applyOps(emptyAssembly(), ops, (id) => parts.get(id) ?? getPart(id)).assembly, [
    { controlId: 'draw_loop', mode: 'velocity', rampIn_s: 0.45, profile: { kind: 'constant', value: 4 } },
  ]);
}

/** Compare two pen positions exactly one measured crank turn apart, interpolated across trace samples. */
export function measureDrawingAutomaton(result: TestResult) {
  const startAngle = 2 * Math.PI;
  const endAngle = 4 * Math.PI;
  const penAt = (angle: number): Vec3 | undefined => {
    const frames = result.trace.frames;
    const index = frames.findIndex((frame) => frame.joints.draw_loop >= angle);
    if (index <= 0) return undefined;
    const before = frames[index - 1], after = frames[index];
    const t = (angle - before.joints.draw_loop) / (after.joints.draw_loop - before.joints.draw_loop);
    const a = before.bodies.pen_tip.position, b = after.bodies.pen_tip.position;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  };
  const start = penAt(startAngle), end = penAt(endAngle);
  return {
    loopClosure_m: start && end ? Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) : null,
  };
}

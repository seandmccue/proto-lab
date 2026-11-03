// Dev experiment: run the default walker and print metrics.
import { buildWalker, DEFAULT_WALKER } from '@protolab/parts';
import { runTest } from './index.ts';

const overrides = JSON.parse(process.argv[2] ?? '{}');
const params = { ...DEFAULT_WALKER, ...overrides, gait: { ...DEFAULT_WALKER.gait, ...(overrides.gait ?? {}) } };
const a = buildWalker(params);
const r = await runTest(a, { env: { gravity_m_s2: 9.81, groundFriction: 0.9 }, test: { id: 'walk', kind: 'walk', duration_s: +(process.argv[3] ?? 6), targets: { minDistance_m: 0.3, maxTilt_deg: 25 } } });
console.log(JSON.stringify({ passed: r.passed, metrics: r.metrics, reasons: r.failureReasons }));
if (process.argv[4] === 'frames') for (const f of r.trace.frames.filter((_, i) => i % 15 === 0)) { const b = f.bodies.body; console.log(f.t.toFixed(2), 'body y', b.position[1].toFixed(4), 'x', b.position[0].toFixed(4), 'q', b.rotation.map((x) => x.toFixed(3)).join(',')); }

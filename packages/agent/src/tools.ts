import { z } from 'zod';
import { Assembly, Plan, Spec, TestSpec, TestResult, ToolLogEntry, PartDefinition, GeometryPiece, Connector, Drive, PartCategory, billOfMaterials } from '@protolab/schema';
import { searchCatalog, getPart, generatePart, generatorInfo, applyOps, emptyAssembly, setDrives, summarize, AssemblyOp, AssemblyError, ParamError, shapeVolume, piecesBoundingRadius, buildWalker, DEFAULT_WALKER, DEFAULT_DANCE, danceDrives, type WalkerParams } from '@protolab/parts';
import { runTest } from '@protolab/simulator';
import type { ToolDef } from './llm.ts';

// ---------- argument schemas ----------
const SearchArgs = z.object({ query: z.string().default(''), category: PartCategory.optional(), limit: z.number().int().min(1).max(40).optional() });
const GetPartArgs = z.object({ part_id: z.string() });
const CreatePartArgs = z.object({ kind: z.string(), params: z.record(z.number()), name: z.string().max(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), rationale: z.string().optional() });
const DesignPartArgs = z.object({
  name: z.string().min(2).max(60), category: PartCategory, description: z.string().max(300).default(''), material: z.string().max(40).default('PLA'), mass_kg: z.number().positive().max(20).optional(),
  pieces: z.array(GeometryPiece).min(1).max(16), connectors: z.array(Connector).max(16).default([]), rationale: z.string().optional(),
});
const AssembleArgs = z.object({ ops: z.array(AssemblyOp).min(1).max(120), rationale: z.string(), based_on: z.string().optional() });
const DrivesArgs = z.object({ drives: z.array(Drive).min(1).max(40), rationale: z.string().optional(), based_on: z.string().optional() });
const DefineTestArgs = z.object({ test: TestSpec });
const RunTestArgs = z.object({ test_id: z.string() });
const SweepArgs = z.object({ test_id: z.string(), controlId: z.string(), field: z.enum(['amplitude', 'frequency_hz', 'value', 'offset']), values: z.array(z.number()).min(2).max(8), duration_s: z.number().min(1).max(6).optional() });
const PlanArgs = Plan.extend({ task: z.string().max(400).optional(), assumptions: z.array(z.string()).max(12).optional(), maxMass_kg: z.number().positive().max(50).optional() });
const FinalizeArgs = z.object({ summary: z.string().max(1200), status: z.enum(['passed', 'failed']), unverified: z.array(z.string()).max(12).optional() });

export const TOOL_DEFS: ToolDef[] = [
  { name: 'write_plan', description: 'Step 1–3 and 7 of the engineering procedure: state the purpose, the recognisable physical features, the required motions, the sub-assemblies, measurable success criteria, and which behaviours the rigid-body physics cannot verify (e.g. aerodynamic lift). Shown to the user. Call once before building; call again only if the plan changes.', parameters: { type: 'object', properties: { purpose: { type: 'string' }, features: { type: 'array', items: { type: 'string' } }, motions: { type: 'array', items: { type: 'string' } }, subassemblies: { type: 'array', items: { type: 'string' } }, successCriteria: { type: 'array', items: { type: 'string' } }, unverified: { type: 'array', items: { type: 'string' } }, assumptions: { type: 'array', items: { type: 'string' } }, maxMass_kg: { type: 'number' } }, required: ['purpose', 'features', 'motions', 'subassemblies', 'successCriteria', 'unverified'] } },
  { name: 'search_catalog', description: 'Search the component library (100+ parts: beams, plates, chassis, towers, gears, shafts, bearings, wheels, spoked wheels, pulleys, hinges, sliders, linkages, cranks, pistons, servos, gearmotors, springs, actuators, wings, propellers, gripper fingers, gondolas, tracks, payload balls/blocks/discs, trays, winged bodies with built-in flap hinges, left/right butterfly, bird and dragonfly wings…). Returns ids, parameters, mass, limits and connector ids with their kinds and axes.', parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: PartCategory.options }, limit: { type: 'integer' } } } },
  { name: 'get_part', description: 'Full details of a catalog or custom part: connectors (id, position, axis, kind), geometry pieces, limits.', parameters: { type: 'object', properties: { part_id: { type: 'string' } }, required: ['part_id'] } },
  { name: 'create_part', description: 'Create a parametric part from a generator when no preset fits (any generator kind with custom params, e.g. wing{span,chord,style}, body_frame{length,width,height,legPairs}, big_wheel{radius,spokes}, servo_motor{size,torque,speed}, beam, plate, curved_panel, gear, crank, link, gripper_finger, propeller…). Returns the new part id and its connectors.', parameters: { type: 'object', properties: { kind: { type: 'string' }, params: { type: 'object', additionalProperties: { type: 'number' } }, name: { type: 'string' }, color: { type: 'string', description: 'hex colour like #e63946' }, rationale: { type: 'string' } }, required: ['kind', 'params'] } },
  { name: 'design_part', description: 'Design a fully custom part from primitives when no generator fits. Example: {"name":"Butterfly thorax","category":"frames","material":"PLA","pieces":[{"shape":{"kind":"capsule","radius":0.012,"height":0.06,"axis":"x"},"offset":{"position":[0,0,0],"rotation":[0,0,0,1]},"color":"#333333","role":"structure"},{"shape":{"kind":"extrude","profile":[[0,0],[0.03,0.01],[0.03,-0.01]],"depth":0.002,"axis":"y"},"offset":{"position":[0.03,0,0],"rotation":[0,0,0,1]},"color":"#e63946","role":"shell"}],"connectors":[{"id":"wing_l","position":[0,0.01,0.012],"axis":[-1,0,0],"kind":"revolute"},{"id":"wing_r","position":[0,0.01,-0.012],"axis":[1,0,0],"kind":"revolute"},{"id":"base","position":[0,-0.012,0],"axis":[0,-1,0],"kind":"fixed"}]} (flap hinges run along the body axis: left −X, right +X, so wings mounted via "hinge" flap up/down). Shapes: box{size}, cylinder{radius,height,axis}, sphere{radius}, capsule{radius,height,axis}, ellipsoid{radii}, extrude{profile (2D polygon, CCW), depth, axis}, revolve{profile [(r,h)...], axis}. Metres, part-local frame, +Y up. Connector axes point OUT of the part. Mass defaults from volume × material density (shells/wings ×0.3).', parameters: { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string', enum: PartCategory.options }, description: { type: 'string' }, material: { type: 'string', enum: ['PLA', 'aluminium', 'steel', 'carbon', 'rubber', 'acrylic', 'nylon', 'balsa', 'foam'] }, mass_kg: { type: 'number' }, pieces: { type: 'array', items: { type: 'object' } }, connectors: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string' } }, required: ['name', 'category', 'pieces'] } },
  { name: 'assemble', description: 'Apply structured assembly operations to the current design (atomic: all or nothing; on error the failing op index and reason are returned and nothing changes). Ops: {op:"place", id, part, position:[x,y,z], rotation_deg?:[x,y,z], anchored?, free?} · {op:"mount", id, part, onto:<instance>, connector:<parent connector>, via?:<child connector>, joint:"fixed"|"revolute"|"prismatic", spin_deg?, offset_m?, limits?:[min,max], motor?:{controlId, stiffness, damping}} (places the child so the two connectors coincide and face each other; joint axis = parent connector axis) · {op:"connect", a, a_connector, b, b_connector, joint:"revolute"|"prismatic"|"fixed"|"spring", motor?, spring?} (connectors must already touch, ≤ 20 mm) · {op:"pattern", instances:[ids], kind:"mirror"|"polar"|"linear", plane?:"xy"|"yz"|"xz", axis?, center?, count?, step?} (copies instances, joints, drives) · {op:"remove", id} · {op:"move", id, position?, rotation_deg?, translate?} (moving an instance carries everything mounted on it). Ground is y = 0; +Y is up. Use anchored:true for bases fixed to the ground, free:true for projectiles/payloads.', parameters: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string', description: 'What this builds or changes and why, in one or two sentences for the user' }, based_on: { type: 'string', description: 'Test id and measurement this change responds to, if any' } }, required: ['ops', 'rationale'] } },
  { name: 'set_drives', description: 'Set motor drives for motorised joints (by controlId). Each: {controlId, mode:"position"|"velocity", rampIn_s?, profile}. Profiles: {kind:"constant", value} · {kind:"sine", amplitude, offset?, frequency_hz, phase?} · {kind:"ramp", from, to, start_s?, duration_s} · {kind:"step", before, after, at_s} · {kind:"gait", role:"swing"|"lift", amplitude, offset?, frequency_hz, phase?, swingDuty?} for legged locomotion. Position values are radians (revolute) or metres (prismatic); velocity values rad/s or m/s. Replaces drives with the same controlId.', parameters: { type: 'object', properties: { drives: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string' }, based_on: { type: 'string' } }, required: ['drives'] } },
  { name: 'inspect_assembly', description: 'Current assembly: instances with positions, joints with axes/motors, drives, mass, extents and lowest point (should be ≥ 0 unless intended).', parameters: { type: 'object', properties: {} } },
  { name: 'define_test', description: 'Define a measurable test (step 7). Kinds: {kind:"motion", id, duration_s, measure:{joints:[controlIds], base?:<instance>, clearancePairs:[[a,b]], noGroundContact:[ids]}, criteria:{minJointAmplitude_rad?, minJointRate_rad_s? (peak angular rate), minRevolutions?, maxBaseTilt_deg?, maxBaseDrift_m?, torqueWithinRating}} (metrics also report <joint>.cycles_hz for oscillation frequency) · {kind:"walk", id, duration_s, base, minDistance_m, maxTilt_deg, direction, signed?:false (either sense along the axis counts unless signed:true)} · {kind:"launch", id, duration_s, projectile:<free instance>, targetDistance_m, tolerance_m, direction} · {kind:"grip", id, duration_s, payload:<free instance>, holder:<instance>, supportUntil_s, maxSeparation_m}.', parameters: { type: 'object', properties: { test: { type: 'object' } }, required: ['test'] } },
  { name: 'run_test', description: 'Run a defined test on the current assembly in the rigid-body simulator. Returns measured metrics, failure reasons and notes. Creates a version.', parameters: { type: 'object', properties: { test_id: { type: 'string' } }, required: ['test_id'] } },
  { name: 'sweep_drive', description: 'Exploration (no version, no test budget): rerun a test briefly while varying one field of one drive over a list of values; returns the measured metrics per value so you can pick a revision from data.', parameters: { type: 'object', properties: { test_id: { type: 'string' }, controlId: { type: 'string' }, field: { type: 'string', enum: ['amplitude', 'frequency_hz', 'value', 'offset'] }, values: { type: 'array', items: { type: 'number' } }, duration_s: { type: 'number' } }, required: ['test_id', 'controlId', 'field', 'values'] } },
  { name: 'finalize_design', description: 'Finish with an honest summary: what was built, what each test measured, what changed between iterations, and which behaviours remain unverified by the physics.', parameters: { type: 'object', properties: { summary: { type: 'string' }, status: { type: 'string', enum: ['passed', 'failed'] }, unverified: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'status'] } },
];

export interface ToolEvents {
  onLog(entry: ToolLogEntry): void;
  onPlan(spec: Spec): void;
  onAssembly(assembly: Assembly, rationale: string, basedOn?: string): void;
  onTest(result: TestResult): void;
}

/** Accept common field synonyms in assembly ops. */
function normaliseOp(o: unknown): unknown {
  if (!o || typeof o !== 'object') return o;
  const x = { ...(o as Record<string, unknown>) };
  const alias = (from: string, to: string) => { if (x[to] === undefined && x[from] !== undefined) { x[to] = x[from]; } if (from !== to) delete x[from]; };
  if (typeof x.type === 'string' && x.op === undefined) { x.op = x.type; delete x.type; }
  if (typeof x.action === 'string' && x.op === undefined) { x.op = x.action; delete x.action; }
  if (x.op === 'add' || x.op === 'create' || x.op === 'spawn') x.op = 'place';
  if (x.op === 'attach' || x.op === 'join') x.op = x.onto || x.parent ? 'mount' : 'connect';
  alias('partId', 'part'); alias('part_id', 'part'); alias('instance', 'id'); alias('instanceId', 'id'); alias('name', 'id'); alias('instance_id', 'id');
  alias('at', 'position'); alias('pos', 'position'); alias('translation', 'position'); alias('rotation', 'rotation_deg'); alias('rotation_euler_deg', 'rotation_deg'); alias('euler_deg', 'rotation_deg');
  alias('parent', 'onto'); alias('on', 'onto'); alias('to', 'onto'); alias('parent_connector', 'connector'); alias('parentConnector', 'connector'); alias('onto_connector', 'connector'); alias('at_connector', 'connector'); alias('target_connector', 'connector'); alias('socket', 'connector');
  alias('child_connector', 'via'); alias('childConnector', 'via'); alias('with', 'via'); alias('using', 'via'); alias('own_connector', 'via'); alias('my_connector', 'via');
  // Dotted shorthand the summaries use: onto:"base.top" / via:"wing.hinge" → instance + connector.
  if (typeof x.onto === 'string' && x.onto.includes('.') && x.connector === undefined) { const k = x.onto.indexOf('.'); x.connector = x.onto.slice(k + 1); x.onto = x.onto.slice(0, k); }
  if (typeof x.via === 'string' && x.via.includes('.')) x.via = x.via.slice(x.via.indexOf('.') + 1);
  if (x.op === 'mount' && typeof x.connector === 'string' && x.connector.includes('.')) x.connector = x.connector.slice(x.connector.indexOf('.') + 1);
  alias('jointType', 'joint'); alias('joint_type', 'joint'); alias('spin', 'spin_deg'); alias('offset', 'offset_m');
  alias('fixed', 'anchored'); alias('static', 'anchored');
  if (x.op === 'place' && x.position === undefined && Array.isArray(x.transform)) { x.position = x.transform; delete x.transform; }
  if (x.op === 'pattern' && x.instances === undefined && typeof x.id === 'string') { x.instances = [x.id]; delete x.id; }
  if (x.op === 'pattern' && x.kind === undefined && typeof x.type === 'string') { x.kind = x.type; }
  if (x.motor && typeof x.motor === 'object') { const m = x.motor as Record<string, unknown>; if (m.controlId === undefined && typeof m.id === 'string') { m.controlId = m.id; delete m.id; } if (m.controlId === undefined && typeof m.name === 'string') { m.controlId = m.name; delete m.name; } }
  return x;
}
/** For a missing required field, show which keys the model actually sent on that object so it can fix the name. */
function describeReceived(args: unknown, path: (string | number)[]): string {
  if (path.length < 2) return args && typeof args === 'object' ? ` (received keys: ${Object.keys(args as object).join(', ') || 'none'})` : '';
  let o: unknown = args; for (const k of path.slice(0, -1)) { if (!o || typeof o !== 'object') return ''; o = (o as Record<string, unknown>)[k as string]; }
  if (!o || typeof o !== 'object') return '';
  return ` (received keys: ${Object.keys(o as object).join(', ')})`;
}
/** Accept drives written flat ({controlId, kind:'sine', amplitude...}) by wrapping the profile. */
function normaliseDrive(d: unknown): unknown {
  if (!d || typeof d !== 'object') return d;
  const o = { ...(d as Record<string, unknown>) };
  // Infer a missing profile kind from the fields present (the model often omits it): role/swingDuty → gait, from/to → ramp, before/after → step, amplitude → sine, value → constant.
  const inferKind = (x: Record<string, unknown>) => { if (typeof x.kind === 'string') return; if ('role' in x || 'swingDuty' in x) x.kind = 'gait'; else if ('from' in x && 'to' in x) x.kind = 'ramp'; else if ('before' in x && 'after' in x) x.kind = 'step'; else if ('amplitude' in x) x.kind = 'sine'; else if ('value' in x) x.kind = 'constant'; };
  if (!o.profile) inferKind(o);
  if (o.profile && typeof o.profile === 'object') inferKind(o.profile as Record<string, unknown>);
  if (!o.profile && typeof o.kind === 'string') { const profile: Record<string, unknown> = {}; for (const k of ['kind', 'value', 'amplitude', 'offset', 'frequency_hz', 'phase', 'from', 'to', 'start_s', 'duration_s', 'before', 'after', 'at_s', 'role', 'swingDuty']) if (k in o) { profile[k] = o[k]; delete o[k]; } o.profile = profile; }
  if (o.profile && typeof o.profile === 'object') { const p = o.profile as Record<string, unknown>; if (p.kind === 'gait' && !p.role) p.role = /knee|lift/i.test(String(o.controlId)) ? 'lift' : 'swing'; if (p.kind === 'sine' && p.frequency_hz === undefined && typeof p.frequency === 'number') { p.frequency_hz = p.frequency; delete p.frequency; } }
  if (o.mode === undefined) o.mode = 'position';
  return o;
}
/** Accept the shorthand models tend to write: {shape:'box', size:[..], position:[..]} → full GeometryPiece. */
function normalisePiece(pc: unknown): unknown {
  if (!pc || typeof pc !== 'object') return pc;
  const o = { ...(pc as Record<string, unknown>) };
  if (typeof o.shape === 'string') { const kind = o.shape; const shape: Record<string, unknown> = { kind }; for (const k of ['size', 'radius', 'height', 'axis', 'radii', 'profile', 'depth', 'segments']) if (k in o) { shape[k] = o[k]; delete o[k]; } o.shape = shape; }
  if (Array.isArray(o.offset)) o.offset = { position: o.offset, rotation: [0, 0, 0, 1] };
  if (!o.offset && Array.isArray(o.position)) { o.offset = { position: o.position, rotation: o.rotation ?? [0, 0, 0, 1] }; delete o.position; delete o.rotation; }
  if (o.offset && typeof o.offset === 'object' && !('rotation' in (o.offset as object))) (o.offset as Record<string, unknown>).rotation = [0, 0, 0, 1];
  if (o.collide === undefined) o.collide = true; if (o.role === undefined) o.role = 'structure';
  return o;
}
const DENSITY: Record<string, number> = { PLA: 1240, aluminium: 2700, steel: 7850, carbon: 1600, rubber: 1100, acrylic: 1180, nylon: 1150, balsa: 160, foam: 30 };

export class ToolRuntime {
  spec: Spec;
  customParts = new Map<string, PartDefinition>();
  assembly: Assembly = emptyAssembly();
  tests: TestResult[] = [];
  testSpecs = new Map<string, TestSpec>();
  testCount = 0; sweeps = 0; calls = 0;
  finalized: { summary: string; status: 'passed' | 'failed'; unverified?: string[] } | null = null;
  private events: ToolEvents;
  budget: { maxTests: number; maxToolCalls: number };
  constructor(spec: Spec, events: ToolEvents, budget = { maxTests: 9, maxToolCalls: 60 }) { this.spec = spec; this.events = events; this.budget = budget; }
  resolve = (id: string) => this.customParts.get(id) ?? getPart(id);

  summarisePart(p: PartDefinition) {
    return { id: p.id, kind: p.kind, name: p.name, category: p.category, params: p.params, mass_kg: +p.mass_kg.toFixed(4), dimensions_m: p.dimensions_m.map((v) => +v.toFixed(4)), limits: p.limits, connectors: p.connectors.map((c) => `${c.id} (${c.kind}, axis ${c.axis.map((v) => +v.toFixed(2)).join(',')})`) };
  }

  async call(name: string, rawArgs: unknown): Promise<unknown> {
    this.calls++;
    if (this.calls > this.budget.maxToolCalls) throw new Error(`Tool-call budget (${this.budget.maxToolCalls}) exhausted; call finalize_design.`);
    const t = new Date().toISOString();
    const log = (ok: boolean, summary: string) => this.events.onLog({ t, tool: name, args: rawArgs, ok, summary });
    try {
      switch (name) {
        case 'write_plan': {
          { const r = rawArgs as Record<string, unknown>;
            if (typeof r.purpose === 'string' && /^\s*\[/.test(r.purpose)) { try { const v = JSON.parse(r.purpose); if (Array.isArray(v)) r.purpose = v.map(String).join(' '); } catch { /* keep as text */ } }
            if (Array.isArray(r.purpose)) r.purpose = r.purpose.map(String).join(' '); for (const k of ['features', 'motions', 'successCriteria', 'unverified', 'assumptions']) if (typeof r[k] === 'string') r[k] = [r[k]]; }
          const a = PlanArgs.parse(rawArgs);
          const plan = Plan.parse({ purpose: a.purpose, features: a.features, motions: a.motions, subassemblies: a.subassemblies, successCriteria: a.successCriteria, unverified: a.unverified });
          this.spec = { ...this.spec, plan, assumptions: a.assumptions ?? this.spec.assumptions, constraints: { ...this.spec.constraints, maxMass_kg: a.maxMass_kg ?? this.spec.constraints.maxMass_kg } };
          this.events.onPlan(this.spec);
          log(true, `Plan: ${plan.purpose.slice(0, 80)} — ${plan.subassemblies.length} sub-assemblies, ${plan.successCriteria.length} criteria, ${plan.unverified.length} unverified`);
          return { ok: true, plan };
        }
        case 'search_catalog': {
          const a = SearchArgs.parse(rawArgs);
          const res = searchCatalog(a.query, { category: a.category, limit: a.limit ?? 8 });
          const custom = [...this.customParts.values()].filter((p) => !a.category || p.category === a.category);
          log(true, `${res.length + custom.length} parts for "${a.query}"${a.category ? ` in ${a.category}` : ''}`);
          return { parts: [...custom, ...res].map((p) => this.summarisePart(p)), generators: a.query === '' ? generatorInfo().map((g) => `${g.kind}(${Object.keys(g.params).join(',')})`) : undefined };
        }
        case 'get_part': {
          const a = GetPartArgs.parse(rawArgs); const p = this.resolve(a.part_id);
          if (!p) throw new Error(`Unknown part id "${a.part_id}"`);
          log(true, p.name);
          return { part: { ...this.summarisePart(p), description: p.description, material: p.material, connectors: p.connectors, geometry: p.geometry.map((g) => ({ shape: g.shape.kind, role: g.role, offset: g.offset.position })) } };
        }
        case 'create_part': {
          const a = CreatePartArgs.parse(rawArgs);
          const id = `custom-${a.kind}-${this.customParts.size + 1}`;
          const p = generatePart(a.kind, a.params, id);
          if (a.name) p.name = a.name;
          if (a.color) for (const g of p.geometry) if (g.role !== 'contact' && g.role !== 'motor') g.color = a.color;
          this.customParts.set(id, p);
          log(true, `Created ${p.name} (${id})`);
          return { part: this.summarisePart(p) };
        }
        case 'design_part': {
          const raw = rawArgs as { pieces?: unknown[] };
          if (Array.isArray(raw?.pieces)) raw.pieces = raw.pieces.map((pc) => normalisePiece(pc));
          const a = DesignPartArgs.parse(rawArgs);
          const id = `designed-${this.customParts.size + 1}`;
          const pieces = a.pieces.map((g) => GeometryPiece.parse(g));
          const r = piecesBoundingRadius(pieces); if (r > 1.0) throw new Error(`Part spans ~${(2 * r).toFixed(2)} m; keep designed parts under 2 m`);
          const volume = pieces.reduce((s, g) => s + shapeVolume(g.shape), 0);
          const mass = a.mass_kg ?? Math.max(0.001, volume * (DENSITY[a.material] ?? 1240) * (pieces.some((g) => g.role === 'shell' || g.role === 'wing') ? 0.3 : 1));
          const ext = pieces.reduce((m, g) => { const h = g.offset.position; return [Math.max(m[0], Math.abs(h[0]) + r * 0.5), Math.max(m[1], Math.abs(h[1]) + r * 0.5), Math.max(m[2], Math.abs(h[2]) + r * 0.5)] as [number, number, number]; }, [0, 0, 0] as [number, number, number]);
          const p = PartDefinition.parse({ id, kind: 'designed', name: a.name, category: a.category, description: a.description || `Designed part: ${a.name}`, params: {}, mass_kg: mass, dimensions_m: ext, material: a.material, geometry: pieces, connectors: a.connectors, limits: {}, cost_usd: 5, source: { kind: 'designed', license: 'CC0-1.0', creator: 'ProtoLab agent (model-designed, geometry-engine validated)' } });
          this.customParts.set(id, p);
          log(true, `Designed ${p.name} (${id}): ${pieces.length} pieces, ${a.connectors.length} connectors, ${(mass * 1000).toFixed(0)} g`);
          return { part: this.summarisePart(p) };
        }
        case 'assemble': {
          { const r = rawArgs as Record<string, unknown>; for (const k of ['operations', 'steps', 'assembly_ops', 'actions']) if (r.ops === undefined && Array.isArray(r[k])) { r.ops = r[k]; delete r[k]; } for (const k of ['reason', 'why', 'description', 'note']) if (r.rationale === undefined && typeof r[k] === 'string') { r.rationale = r[k]; delete r[k]; } if (r.rationale === undefined && Array.isArray(r.ops)) r.rationale = 'Assembly step'; }
          const raw = rawArgs as { ops?: unknown[] };
          if (Array.isArray(raw?.ops)) raw.ops = raw.ops.map((o) => normaliseOp(o));
          const a = AssembleArgs.parse(rawArgs);
          const r = applyOps(this.assembly, a.ops, this.resolve, { maxInstances: this.spec.constraints.maxParts, maxMass_kg: this.spec.constraints.maxMass_kg, maxSize_m: this.spec.constraints.maxSize_m });
          this.assembly = r.assembly;
          const s = summarize(this.assembly);
          log(true, `${a.ops.length} ops: ${r.summary.slice(0, 4).join('; ')}${r.summary.length > 4 ? ` … (+${r.summary.length - 4})` : ''} → ${this.assembly.instances.length} components, ${s.totalMass_kg} kg`);
          this.events.onAssembly(this.assembly, a.rationale, a.based_on);
          return { applied: r.summary, assembly: s };
        }
        case 'set_drives': {
          const raw = rawArgs as { drives?: unknown[] };
          if (Array.isArray(raw?.drives)) raw.drives = raw.drives.map((d) => normaliseDrive(d));
          const a = DrivesArgs.parse(rawArgs);
          this.assembly = setDrives(this.assembly, a.drives);
          log(true, `Drives: ${a.drives.map((d) => `${d.controlId}=${d.profile.kind}`).join(', ')}`);
          if (a.rationale) this.events.onAssembly(this.assembly, a.rationale, a.based_on);
          return { drives: this.assembly.controller.drives };
        }
        case 'inspect_assembly': { log(true, 'Inspected'); return summarize(this.assembly); }
        case 'define_test': {
          const raw = rawArgs as { test?: Record<string, unknown> };
          if (raw?.test && Array.isArray(raw.test.direction)) { const v = raw.test.direction as number[]; raw.test.direction = Math.abs(v[0] ?? 0) >= Math.max(Math.abs(v[1] ?? 0), Math.abs(v[2] ?? 0)) ? 'x' : Math.abs(v[1] ?? 0) >= Math.abs(v[2] ?? 0) ? 'y' : 'z'; }
          if (raw?.test && typeof raw.test.direction === 'string') raw.test.direction = raw.test.direction.replace(/^[+-]/, '').toLowerCase();
          if (raw?.test && raw.test.kind === 'walk' && typeof raw.test.minDistance_m === 'number' && raw.test.minDistance_m > 1.5) throw new Error(`minDistance_m ${raw.test.minDistance_m} m is unrealistic for a tabletop walker in ${raw.test.duration_s ?? 6} s; small legged machines manage 0.2–0.6 m. Use a target the user asked for or a realistic one.`);
          const a = DefineTestArgs.parse(rawArgs);
          this.testSpecs.set(a.test.id, a.test);
          log(true, `Test ${a.test.id} (${a.test.kind}) defined`);
          return { ok: true, test: a.test };
        }
        case 'run_test': {
          const a = RunTestArgs.parse(rawArgs); const spec = this.testSpecs.get(a.test_id);
          if (!spec) throw new Error(`Unknown test "${a.test_id}"; define it first. Defined: ${[...this.testSpecs.keys()].join(', ') || 'none'}`);
          if (!this.assembly.instances.length) throw new Error('No assembly yet');
          if (this.testCount >= this.budget.maxTests) throw new Error(`Test budget (${this.budget.maxTests}) exhausted; call finalize_design with the best result so far.`);
          this.testCount++;
          const n = this.tests.filter((x) => x.testId.startsWith(a.test_id)).length + 1;
          const result = await runTest(this.assembly, { env: this.spec.environment, test: { ...spec, id: `${a.test_id}#${n}` } });
          this.tests.push(result);
          log(true, `${result.testId}: ${result.passed ? 'PASS' : 'FAIL'} — ${Object.entries(result.metrics).filter(([k]) => /distance|revolutions|landing|separation|maxTilt|amplitude/.test(k)).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')}${result.failureReasons.length ? ' — ' + result.failureReasons.join('; ') : ''}`);
          this.events.onTest(result);
          return { testId: result.testId, kind: result.kind, passed: result.passed, metrics: result.metrics, failureReasons: result.failureReasons, notes: result.notes };
        }
        case 'sweep_drive': {
          const a = SweepArgs.parse(rawArgs); const spec = this.testSpecs.get(a.test_id);
          if (!spec) throw new Error(`Unknown test "${a.test_id}"`);
          if (this.sweeps >= 4) throw new Error('Sweep budget (4) exhausted');
          this.sweeps++;
          const drive = this.assembly.controller.drives.find((d) => d.controlId === a.controlId);
          if (!drive) throw new Error(`No drive for controlId "${a.controlId}"`);
          const results: Array<Record<string, number>> = [];
          for (const v of a.values) {
            const prof = { ...drive.profile } as Record<string, unknown>; prof[a.field] = v;
            const ctl = { drives: this.assembly.controller.drives.map((d) => (d.controlId === a.controlId ? { ...d, profile: Drive.shape.profile.parse(prof) } : d)) };
            const r = await runTest(this.assembly, { env: this.spec.environment, test: { ...spec, id: 'sweep', duration_s: a.duration_s ?? Math.min(4, spec.duration_s) }, controller: ctl });
            results.push({ [a.field]: v, passed: r.passed ? 1 : 0, ...Object.fromEntries(Object.entries(r.metrics).filter(([k]) => /distance|revolutions|landing|separation|maxTilt|fell|peak|amplitude|clearance/.test(k)).slice(0, 8)) });
          }
          log(true, `${results.length} runs varying ${a.controlId}.${a.field}`);
          return { results };
        }
        case 'finalize_design': {
          const a = FinalizeArgs.parse(rawArgs); this.finalized = a;
          if (a.unverified && this.spec.plan) this.spec = { ...this.spec, plan: { ...this.spec.plan, unverified: a.unverified } };
          log(true, `Finalized (${a.status})`);
          return { ok: true };
        }
        default: throw new Error(`Unknown tool "${name}"`);
      }
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}${describeReceived(rawArgs, i.path)}`).slice(0, 6).join('; ') : e instanceof AssemblyError ? `${e.opIndex !== undefined ? `op[${e.opIndex}]: ` : ''}${e.message}` : e instanceof ParamError || e instanceof Error ? e.message : String(e);
      log(false, msg);
      return { error: msg };
    }
  }
}

export { buildWalker, DEFAULT_WALKER, DEFAULT_DANCE, danceDrives, billOfMaterials };
export type { WalkerParams };

import { z } from 'zod';
import { Assembly, Plan, Spec, TestSpec, TestResult, ToolLogEntry, PartDefinition, GeometryPiece, Connector, Drive, PartCategory, billOfMaterials } from '@protolab/schema';
import { searchCatalog, catalog, getPart, generatePart, generatorInfo, applyOps, emptyAssembly, setDrives, summarize, transformPoint, transformDir, AssemblyOp, AssemblyError, ParamError, shapeVolume, piecesBoundingRadius, buildWalker, DEFAULT_WALKER, DEFAULT_DANCE, danceDrives, type WalkerParams } from '@protolab/parts';
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
const InspectArgs = z.object({ instance_ids: z.array(z.string().min(1)).max(4).optional() });
const DefineTestArgs = z.object({ test: TestSpec });
const RunTestArgs = z.object({ test_id: z.string() });
const SweepArgs = z.object({ test_id: z.string(), controlId: z.string(), field: z.enum(['amplitude', 'frequency_hz', 'value', 'offset']), values: z.array(z.number()).min(2).max(8), duration_s: z.number().min(1).max(6).optional() });
const PlanArgs = Plan.extend({ task: z.string().max(400).optional(), assumptions: z.array(z.string()).max(12).optional(), maxMass_kg: z.number().positive().max(50).optional(), candidate_part_ids: z.array(z.string().min(1).max(100)).max(24).optional().catch(undefined) });
const FinalizeArgs = z.object({ summary: z.string().max(1200), status: z.enum(['passed', 'failed']), unverified: z.array(z.string()).max(12).optional() });

export const TOOL_DEFS: ToolDef[] = [
  { name: 'write_plan', description: 'Step 1–3 and 7 of the engineering procedure: state the purpose, the recognisable physical features, the required motions, the sub-assemblies, measurable success criteria, and which behaviours the rigid-body physics cannot verify (e.g. aerodynamic lift). Include exact candidate_part_ids from the catalog index when already known so the user can see the proposed parts. Call once before building; call again only if the plan changes.', parameters: { type: 'object', properties: { purpose: { type: 'string' }, features: { type: 'array', items: { type: 'string' } }, motions: { type: 'array', items: { type: 'string' } }, subassemblies: { type: 'array', items: { type: 'string' } }, successCriteria: { type: 'array', items: { type: 'string' } }, unverified: { type: 'array', items: { type: 'string' } }, assumptions: { type: 'array', items: { type: 'string' } }, maxMass_kg: { type: 'number' }, candidate_part_ids: { type: 'array', maxItems: 12, items: { type: 'string' } } }, required: ['purpose', 'features', 'motions', 'subassemblies', 'successCriteria', 'unverified'] } },
  { name: 'search_catalog', description: 'Search the component library (100+ parts: beams, plates, chassis, towers, gears, shafts, bearings, wheels, spoked wheels, pulleys, hinges, sliders, linkages, cranks, eccentric cams, cam followers and guides, pistons, servos, gearmotors, springs, actuators, wings, propellers, gripper fingers, gondolas, tracks, payload balls/blocks/discs, trays, winged bodies with built-in flap hinges, left/right butterfly, bird and dragonfly wings…). Returns ids, parameters, mass, limits and connector ids with their kinds and axes.', parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: PartCategory.options }, limit: { type: 'integer' } } } },
  { name: 'get_part', description: 'Full details of a catalog or custom part: connectors (id, position, axis, kind), geometry pieces, limits.', parameters: { type: 'object', properties: { part_id: { type: 'string' } }, required: ['part_id'] } },
  { name: 'create_part', description: 'Create a parametric part from a generator when no preset fits (any generator kind with custom params, e.g. wing{span,chord,style}, body_frame{length,width,height,legPairs}, big_wheel{radius,spokes}, servo_motor{size,torque,speed}, beam, plate, curved_panel, gear, crank, eccentric_cam{coreRadius,lobeRadius,eccentricity,thickness}, cam_follower{shoeLength,shoeWidth,shoeThickness,stemSize,stemLength}, follower_guide{stemSize,reach}, link, gripper_finger, propeller…). Returns the new part id and its connectors.', parameters: { type: 'object', properties: { kind: { type: 'string' }, params: { type: 'object', additionalProperties: { type: 'number' } }, name: { type: 'string' }, color: { type: 'string', description: 'hex colour like #e63946' }, rationale: { type: 'string' } }, required: ['kind', 'params'] } },
  { name: 'design_part', description: 'Design a fully custom part from primitives when no generator fits. Example: {"name":"Butterfly thorax","category":"frames","material":"PLA","pieces":[{"shape":{"kind":"capsule","radius":0.012,"height":0.06,"axis":"x"},"offset":{"position":[0,0,0],"rotation":[0,0,0,1]},"color":"#333333","role":"structure"},{"shape":{"kind":"extrude","profile":[[0,0],[0.03,0.01],[0.03,-0.01]],"depth":0.002,"axis":"y"},"offset":{"position":[0.03,0,0],"rotation":[0,0,0,1]},"color":"#e63946","role":"shell"}],"connectors":[{"id":"wing_l","position":[0,0.01,0.012],"axis":[-1,0,0],"kind":"revolute"},{"id":"wing_r","position":[0,0.01,-0.012],"axis":[1,0,0],"kind":"revolute"},{"id":"base","position":[0,-0.012,0],"axis":[0,-1,0],"kind":"fixed"}]} (flap hinges run along the body axis: left −X, right +X, so wings mounted via "hinge" flap up/down). Shapes: box{size}, cylinder{radius,height,axis}, sphere{radius}, capsule{radius,height,axis}, ellipsoid{radii}, extrude{profile (2D polygon, CCW), depth, axis}, revolve{profile [(r,h)...], axis}. Metres, part-local frame, +Y up. Connector axes point OUT of the part. Mass defaults from volume × material density (shells/wings ×0.3). An optional piece friction coefficient overrides the simulator default for that collider.', parameters: { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string', enum: PartCategory.options }, description: { type: 'string' }, material: { type: 'string', enum: ['PLA', 'aluminium', 'steel', 'carbon', 'rubber', 'acrylic', 'nylon', 'balsa', 'foam'] }, mass_kg: { type: 'number' }, pieces: { type: 'array', items: { type: 'object' } }, connectors: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string' } }, required: ['name', 'category', 'pieces'] } },
  { name: 'assemble', description: 'Apply structured assembly operations to the current design (atomic: all or nothing; on error the failing op index and reason are returned and nothing changes). Ops: {op:"place", id, part, position:[x,y,z], rotation_deg?:[x,y,z], anchored?, free?} · {op:"mount", id, part, onto:<instance>, connector:<parent connector>, via?:<child connector>, joint:"fixed"|"revolute"|"prismatic"|"free", spin_deg?, offset_m?, limits?:[min,max], contact?:true, motor?:{controlId, stiffness, damping}} (places the child so the two connectors coincide and face each other; joint axis = parent connector axis; contact:true enables collisions and keeps the joint, useful for a pin that drives a slotted wheel; joint:"free" sets a payload or projectile down with no joint) · {op:"connect", a, a_connector, b, b_connector, joint:"revolute"|"prismatic"|"fixed"|"spring", motor?, spring?} (connectors must already touch, ≤ 20 mm) · {op:"bridge", id, part, a, a_connector, via_a, b, b_connector, via_b} (fits a new rigid link between two already placed parts and adds two passive revolute joints; via_a/via_b are the new link’s pivots; endpoint spacing must match within 0.5 mm) · {op:"pattern", instances:[ids], kind:"mirror"|"polar"|"linear", plane?:"xy"|"yz"|"xz", axis?, center?, count?, step?} (copies instances, joints, drives) · {op:"remove", id} · {op:"move", id, position?, rotation_deg?, translate?} (moving an instance carries everything mounted on it). Ground is y = 0; +Y is up. Use anchored:true for bases fixed to the ground, free:true on place enables contact with other bodies. For a guided cam follower, place it with free:true, then connect its slide to the guide with a passive prismatic joint. Keep unrelated parts clear of the follower.', parameters: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string', description: 'What this builds or changes and why, in one or two sentences for the user' }, based_on: { type: 'string', description: 'Test id and measurement this change responds to, if any' } }, required: ['ops', 'rationale'] } },
  { name: 'set_drives', description: 'Set motor drives for motorised joints (by controlId). Each: {controlId, mode:"position"|"velocity", rampIn_s?, profile}. Profiles: {kind:"constant", value} · {kind:"sine", amplitude, offset?, frequency_hz, phase?} · {kind:"ramp", from, to, start_s?, duration_s} · {kind:"step", before, after, at_s} · {kind:"gait", role:"swing"|"lift", amplitude, offset?, frequency_hz, phase?, swingDuty?} for legged locomotion. Position values are radians (revolute) or metres (prismatic); velocity values rad/s or m/s. Replaces drives with the same controlId.', parameters: { type: 'object', properties: { drives: { type: 'array', items: { type: 'object' } }, rationale: { type: 'string' }, based_on: { type: 'string' } }, required: ['drives'] } },
  { name: 'inspect_assembly', description: 'Current assembly: world positions in metres, localY_world (part-local +Y in world coordinates), part masses, joint axes and their anchor points in the assembled pose, motors, drives, and lowest point. For passive leveling, check the tray’s local +Y and center the suspended mass below both pivot axes. For closed linkages, request instance_ids to see those parts’ world connector positions and axes before connecting the final joints.', parameters: { type: 'object', properties: { instance_ids: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Optional instance IDs whose connector poses to include' } } } },
  { name: 'define_test', description: 'Define a measurable test (step 7). Motion: {kind:"motion", id, duration_s, measure:{joints:[controlIds], base?:<instance>, clearancePairs:[[a,b]], noGroundContact:[ids], uprightInstances?:[ids], jointSwing?:[{joint:<motorized revolute controlId>,minEachWay_rad}], linearTravel?:[{instance:<instance id>,axis:"x"|"y"|"z",minTravel_m}], synchronizedTravel?:{instances:[<instance ids>],axis:"x"|"y"|"z",minTravel_m,maxSpread_m}, indexedMotion?:{input:<powered revolute controlId>,body:<output marker instance>,center:<axle instance>,plane:"xy"|"xz"|"yz",minSteps,step_deg,stepTolerance_deg,minDwell_s,maxDwellDrift_deg}, followerTiming?:{shaft:<motorized revolute controlId>,followers:[<instance id>,<instance id>,<optional third instance id>],axis:"x"|"y"|"z",minCycles:<integer>,minStroke_m,minLowDwell_s?,minPhaseGap_deg,maxPhaseGap_deg?}, orbits?:[{body:<instance id>,center:<instance id>,plane:"xy"|"xz"|"yz",reference?:<instance id>|{from:<instance id>,to:<instance id>},minTurns,direction?:"positive"|"negative",minRadius_m?,maxRadius_m?}], payload?:{instance:<load id>,holder?:<hook id>}}, criteria:{minJointAmplitude_rad?, minJointRate_rad_s?, minRevolutions?, maxBaseTilt_deg?, maxBaseDrift_m?, maxInstanceTilt_deg?, minPayloadLift_m?, maxPayloadSeparation_m?, maxPayloadReturnError_m?, torqueWithinRating}}. Joint swing checks that a revolute joint reaches both sides of its rest position. Linear travel measures peak-to-peak displacement along a world axis and can measure passive pistons or sliders. Synchronized travel requires every listed part to move at least minTravel_m and limits the largest same-time difference in displacement from each part’s start to maxSpread_m. Indexed motion checks repeated same-direction steps, one per input revolution, with measured output dwell while the input keeps moving. Put the output marker away from the axle. Follower timing skips the first shaft turn, then checks each complete turn for each stroke, optional contiguous low dwell within 1 mm of the low point, and the angular spacing of adjacent peaks. For three outputs, set both phase bounds to verify the spacing across the full circle. Allow enough time for the requested complete turns plus the first turn and motor ramp. Orbit targets measure net turns from sampled body positions relative to a moving center. Use a reference direction between two bodies when a nested orbit should be measured in the rotating frame. Radius targets check the full sampled path. Instance tilt is relative to world up throughout the run. Lift is peak rise from the starting payload height; retention uses maximum load-to-holder distance; return error is final distance from starting height. Motion also reports <joint>.cycles_hz. Other tests: {kind:"walk", id, duration_s, base, minDistance_m, maxTilt_deg, direction, signed?:false} (either direction counts unless signed:true) · {kind:"launch", id, duration_s, projectile:<free instance>, targetDistance_m, tolerance_m, direction} · {kind:"grip", id, duration_s, payload:<free instance>, holder:<instance>, supportUntil_s, maxSeparation_m}.', parameters: { type: 'object', properties: { test: { type: 'object' } }, required: ['test'] } },
  { name: 'run_test', description: 'Run a defined test on the current assembly in the rigid-body simulator. Returns measured metrics, failure reasons and notes. Creates a version.', parameters: { type: 'object', properties: { test_id: { type: 'string' } }, required: ['test_id'] } },
  { name: 'sweep_drive', description: 'Exploration (no version, no test budget): rerun a test briefly while varying one field of one drive over a list of values; returns the measured metrics per value so you can pick a revision from data.', parameters: { type: 'object', properties: { test_id: { type: 'string' }, controlId: { type: 'string' }, field: { type: 'string', enum: ['amplitude', 'frequency_hz', 'value', 'offset'] }, values: { type: 'array', items: { type: 'number' } }, duration_s: { type: 'number' } }, required: ['test_id', 'controlId', 'field', 'values'] } },
  { name: 'finalize_design', description: 'Finish with an honest summary: what was built, what each test measured, what changed between iterations, and which behaviours remain unverified by the physics.', parameters: { type: 'object', properties: { summary: { type: 'string' }, status: { type: 'string', enum: ['passed', 'failed'] }, unverified: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'status'] } },
];

export interface ToolEvents {
  onLog(entry: ToolLogEntry): void;
  onPlan(spec: Spec): void;
  onAssembly(assembly: Assembly, rationale: string, basedOn?: string): void;
  onTestStart?(testId: string, kind: TestSpec['kind']): void;
  onTest(result: TestResult): void;
}

/** Accept common field synonyms in assembly ops. */
function normaliseOp(o: unknown): unknown {
  if (!o || typeof o !== 'object') return o;
  const x = { ...(o as Record<string, unknown>) };
  const alias = (from: string, to: string) => { if (x[to] === undefined && x[from] !== undefined) { x[to] = x[from]; } if (from !== to) delete x[from]; };
  if (typeof x.type === 'string' && x.op === undefined) { x.op = x.type; delete x.type; }
  // No op at all: infer it from the fields present.
  if (x.op === undefined) { if (x.onto !== undefined || x.parent !== undefined || x.on !== undefined) x.op = 'mount'; else if (x.a !== undefined && x.b !== undefined) x.op = 'connect'; else if (x.instances !== undefined || x.kind === 'mirror' || x.kind === 'polar') x.op = 'pattern'; else if (x.translate !== undefined && x.part === undefined) x.op = 'move'; else if (x.part !== undefined) x.op = 'place'; }
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
  assembly: Assembly;
  private savedParts = new Map<string, PartDefinition>();
  tests: TestResult[] = [];
  testSpecs = new Map<string, TestSpec>();
  private testEvidence = new Map<string, { spec: TestSpec; result: TestResult }>();
  private lastTestedAssembly: Assembly | null = null;
  testCount = 0; sweeps = 0; calls = 0;
  finalized: { summary: string; status: 'passed' | 'failed'; unverified?: string[] } | null = null;
  private events: ToolEvents;
  budget: { maxTests: number; maxToolCalls: number };
  constructor(spec: Spec, events: ToolEvents, budget = { maxTests: 9, maxToolCalls: 60 }, savedAssembly?: Assembly) {
    this.spec = spec;
    this.events = events;
    this.budget = budget;
    this.assembly = savedAssembly ? structuredClone(savedAssembly) : emptyAssembly();
    for (const part of this.assembly.parts) {
      this.savedParts.set(part.id, part);
      if (part.source.kind === 'designed' || part.kind === 'designed' || part.id.startsWith('custom-')) this.customParts.set(part.id, part);
    }
  }
  resolve = (id: string) => this.customParts.get(id) ?? this.savedParts.get(id) ?? getPart(id);

  private nextPartId(prefix: string) {
    let next = 1;
    for (const id of this.customParts.keys()) {
      const suffix = Number(id.match(/-(\d+)$/)?.[1]);
      if (Number.isSafeInteger(suffix) && suffix >= next && suffix < Number.MAX_SAFE_INTEGER) next = suffix + 1;
    }
    while (this.resolve(`${prefix}-${next}`)) next++;
    return `${prefix}-${next}`;
  }

  pendingChecks(): string[] {
    if (!this.tests.length) return ['No simulation test has run'];
    const pending = [...this.testSpecs].flatMap(([id, spec]) => {
      const evidence = this.testEvidence.get(id);
      if (!evidence || evidence.spec !== spec) return [`${id}: current criteria have not been tested`];
      return evidence.result.passed ? [] : [`${id}: latest test failed`];
    });
    if (this.lastTestedAssembly !== this.assembly) pending.push('The latest assembly or drive settings have not been tested');
    return pending;
  }

  summarisePart(p: PartDefinition) {
    return { id: p.id, kind: p.kind, name: p.name, category: p.category, params: p.params, mass_kg: +p.mass_kg.toFixed(4), dimensions_m: p.dimensions_m.map((v) => +v.toFixed(4)), limits: p.limits, connectors: p.connectors.map((c) => `${c.id} (${c.kind}, at ${c.position.map((v) => +v.toFixed(3)).join(',')}, axis ${c.axis.map((v) => +v.toFixed(2)).join(',')})`) }; // positions in the search result: a round of get_part per part was the commonest detour in the v10 pass (22 calls)
  }

  async call(name: string, rawArgs: unknown): Promise<unknown> {
    // Array fields sometimes arrive as JSON strings ("pieces": "[...]"); parse them before validation.
    if (rawArgs && typeof rawArgs === 'object') for (const k of ['ops', 'drives', 'pieces', 'connectors', 'features', 'motions', 'subassemblies', 'successCriteria', 'unverified', 'values', 'candidate_part_ids']) { const r = rawArgs as Record<string, unknown>; if (typeof r[k] === 'string' && /^\s*\[/.test(r[k] as string)) { try { r[k] = JSON.parse(r[k] as string); } catch { /* leave for the validator */ } } }
    this.calls++;
    const t = new Date().toISOString();
    const picked = (p: PartDefinition, withGeometry = false) => ({ id: p.id, name: p.name, category: p.category, mass_kg: p.mass_kg, custom: this.customParts.has(p.id), part: withGeometry ? p : undefined });
    const log = (ok: boolean, summary: string, parts?: ReturnType<typeof picked>[]) => this.events.onLog({ t, tool: name, args: rawArgs, ok, summary, parts });
    try {
      if (this.calls > this.budget.maxToolCalls && name !== 'finalize_design') throw new Error(`Tool-call budget (${this.budget.maxToolCalls}) exhausted; call finalize_design.`);
      switch (name) {
        case 'write_plan': {
          { const r = rawArgs as Record<string, unknown>;
            if (typeof r.purpose === 'string' && /^\s*\[/.test(r.purpose)) { try { const v = JSON.parse(r.purpose); if (Array.isArray(v)) r.purpose = v.map(String).join(' '); } catch { /* keep as text */ } }
            if (Array.isArray(r.purpose)) r.purpose = r.purpose.map(String).join(' '); for (const k of ['features', 'motions', 'successCriteria', 'unverified', 'assumptions']) if (typeof r[k] === 'string') r[k] = [r[k]]; }
          const a = PlanArgs.parse(rawArgs);
          const plan = Plan.parse({ purpose: a.purpose, features: a.features, motions: a.motions, subassemblies: a.subassemblies, successCriteria: a.successCriteria, unverified: a.unverified });
          const candidates = [...new Set(a.candidate_part_ids ?? [])].map(this.resolve).filter((p): p is PartDefinition => p !== undefined).slice(0, 12);
          this.spec = { ...this.spec, plan, assumptions: a.assumptions ?? this.spec.assumptions, constraints: { ...this.spec.constraints, maxMass_kg: a.maxMass_kg ?? this.spec.constraints.maxMass_kg } };
          this.events.onPlan(this.spec);
          log(true, `Plan: ${plan.purpose.slice(0, 80)} — ${plan.subassemblies.length} sub-assemblies, ${plan.successCriteria.length} criteria, ${plan.unverified.length} unverified`, candidates.length ? candidates.map((p) => picked(p)) : undefined);
          return { ok: true, plan };
        }
        case 'search_catalog': {
          const a = SearchArgs.parse(rawArgs);
          const res = searchCatalog(a.query, { category: a.category, limit: a.limit ?? 8 }).map((part) => this.savedParts.get(part.id) ?? part);
          const custom = [...this.customParts.values()].filter((p) => !a.category || p.category === a.category);
          log(true, `${res.length + custom.length} parts for "${a.query}"${a.category ? ` in ${a.category}` : ''}`, [...custom, ...res].slice(0, 8).map((p) => picked(p)));
          return { parts: [...custom, ...res].map((p) => this.summarisePart(p)), generators: a.query === '' ? generatorInfo().map((g) => `${g.kind}(${Object.keys(g.params).join(',')})`) : undefined };
        }
        case 'get_part': {
          const a = GetPartArgs.parse(rawArgs); const p = this.resolve(a.part_id);
          if (!p) throw new Error(`Unknown part id "${a.part_id}"`);
          log(true, p.name, [picked(p)]);
          return { part: { ...this.summarisePart(p), description: p.description, material: p.material, connectors: p.connectors, geometry: p.geometry.map((g) => ({ shape: g.shape.kind, role: g.role, offset: g.offset.position, friction: g.friction })) } };
        }
        case 'create_part': {
          const a = CreatePartArgs.parse(rawArgs);
          const id = this.nextPartId(`custom-${a.kind}`);
          const p = generatePart(a.kind, a.params, id);
          if (a.name) p.name = a.name;
          if (a.color) for (const g of p.geometry) if (g.role !== 'contact' && g.role !== 'motor') g.color = a.color;
          this.customParts.set(id, p);
          log(true, `Created ${p.name} (${id})`, [picked(p, true)]);
          return { part: this.summarisePart(p) };
        }
        case 'design_part': {
          const raw = rawArgs as { pieces?: unknown[] };
          if (Array.isArray(raw?.pieces)) raw.pieces = raw.pieces.map((pc) => normalisePiece(pc));
          const a = DesignPartArgs.parse(rawArgs);
          const id = this.nextPartId('designed');
          const pieces = a.pieces.map((g) => GeometryPiece.parse(g));
          const r = piecesBoundingRadius(pieces); if (r > 1.0) throw new Error(`Part spans ~${(2 * r).toFixed(2)} m; keep designed parts under 2 m`);
          const volume = pieces.reduce((s, g) => s + shapeVolume(g.shape), 0);
          const mass = a.mass_kg ?? Math.max(0.001, volume * (DENSITY[a.material] ?? 1240) * (pieces.some((g) => g.role === 'shell' || g.role === 'wing') ? 0.3 : 1));
          const ext = pieces.reduce((m, g) => { const h = g.offset.position; return [Math.max(m[0], Math.abs(h[0]) + r * 0.5), Math.max(m[1], Math.abs(h[1]) + r * 0.5), Math.max(m[2], Math.abs(h[2]) + r * 0.5)] as [number, number, number]; }, [0, 0, 0] as [number, number, number]);
          const p = PartDefinition.parse({ id, kind: 'designed', name: a.name, category: a.category, description: a.description || `Designed part: ${a.name}`, params: {}, mass_kg: mass, dimensions_m: ext, material: a.material, geometry: pieces, connectors: a.connectors, limits: {}, cost_usd: 5, source: { kind: 'designed', license: 'CC0-1.0', creator: 'ProtoLab agent (model-designed, geometry-engine validated)' } });
          this.customParts.set(id, p);
          log(true, `Designed ${p.name} (${id}): ${pieces.length} pieces, ${a.connectors.length} connectors, ${(mass * 1000).toFixed(0)} g`, [picked(p, true)]);
          return { part: this.summarisePart(p) };
        }
        case 'assemble': {
          { const r = rawArgs as Record<string, unknown>; for (const k of ['operations', 'steps', 'assembly_ops', 'actions']) if (r.ops === undefined && Array.isArray(r[k])) { r.ops = r[k]; delete r[k]; } for (const k of ['reason', 'why', 'description', 'note']) if (r.rationale === undefined && typeof r[k] === 'string') { r.rationale = r[k]; delete r[k]; } if (r.rationale === undefined && Array.isArray(r.ops)) r.rationale = 'Assembly step'; }
          const raw = rawArgs as { ops?: unknown[] };
          if (Array.isArray(raw?.ops)) raw.ops = raw.ops.map((o) => normaliseOp(o));
          const a = AssembleArgs.parse(rawArgs);
          const before = new Map(this.assembly.instances.map((instance) => [instance.id, instance.partId]));
          const r = applyOps(this.assembly, a.ops, this.resolve, { maxInstances: this.spec.constraints.maxParts, maxMass_kg: this.spec.constraints.maxMass_kg, maxSize_m: this.spec.constraints.maxSize_m }, () => [...catalog().map((part) => this.savedParts.get(part.id) ?? part), ...this.customParts.values()]);
          this.assembly = r.assembly;
          const s = summarize(this.assembly);
          const added = new Set(this.assembly.instances.filter((instance) => before.get(instance.id) !== instance.partId).map((instance) => instance.partId));
          const mounted = this.assembly.parts.filter((p) => added.has(p.id));
          log(true, `${a.ops.length} ops: ${r.summary.slice(0, 4).join('; ')}${r.summary.length > 4 ? ` … (+${r.summary.length - 4})` : ''} → ${this.assembly.instances.length} components, ${s.totalMass_kg} kg`, mounted.length ? mounted.map((p) => picked(p, this.customParts.has(p.id))) : undefined);
          this.events.onAssembly(this.assembly, a.rationale, a.based_on);
          return { applied: r.summary, assembly: s };
        }
        case 'set_drives': {
          const raw = rawArgs as { drives?: unknown[] };
          if (Array.isArray(raw?.drives)) raw.drives = raw.drives.map((d) => normaliseDrive(d));
          const a = DrivesArgs.parse(rawArgs);
          this.assembly = setDrives(this.assembly, a.drives);
          const brief = (d: (typeof a.drives)[number]) => { const q = d.profile as Record<string, unknown>; const f = ['amplitude', 'offset', 'frequency_hz', 'swingDuty', 'value', 'from', 'to', 'after'].filter((k) => q[k] !== undefined).map((k) => `${k.replace('frequency_hz', 'f').replace('amplitude', 'a').replace('swingDuty', 'duty').replace('offset', 'o')}=${q[k]}`).join(','); return `${d.controlId}=${d.profile.kind}(${f})`; };
          log(true, `Drives: ${a.drives.slice(0, 4).map(brief).join('; ')}${a.drives.length > 4 ? ` … (+${a.drives.length - 4} more)` : ''}`);
          this.events.onAssembly(this.assembly, a.rationale ?? 'Updated motor drive settings', a.based_on);
          return { drives: this.assembly.controller.drives };
        }
        case 'inspect_assembly': {
          const { instance_ids } = InspectArgs.parse(rawArgs ?? {});
          const summary = summarize(this.assembly, true);
          const ids = [...new Set(instance_ids)];
          const connectorPoses = ids.map((id) => {
            const instance = this.assembly.instances.find((candidate) => candidate.id === id);
            if (!instance) throw new Error(`Unknown instance id "${id}"`);
            const part = this.assembly.parts.find(({ id }) => id === instance.partId);
            return {
              instance: id,
              connectors: part?.connectors.map((connector) => ({
                id: connector.id,
                kind: connector.kind,
                position_m: transformPoint(instance.transform, connector.position).map((value) => +value.toFixed(5)),
                axis_world: transformDir(instance.transform, connector.axis).map((value) => +value.toFixed(4)),
              })) ?? [],
            };
          });
          log(true, ids.length ? `Inspected connectors on ${ids.join(', ')}` : 'Inspected');
          return ids.length ? { connectorPoses, ...summary } : summary;
        }
        case 'define_test': {
          const raw = rawArgs as { test?: Record<string, unknown> };
          if (raw?.test && Array.isArray(raw.test.direction)) { const v = raw.test.direction as number[]; raw.test.direction = Math.abs(v[0] ?? 0) >= Math.max(Math.abs(v[1] ?? 0), Math.abs(v[2] ?? 0)) ? 'x' : Math.abs(v[1] ?? 0) >= Math.abs(v[2] ?? 0) ? 'y' : 'z'; }
          if (raw?.test && typeof raw.test.direction === 'string') raw.test.direction = raw.test.direction.replace(/^[+-]/, '').toLowerCase();
          if (raw?.test && raw.test.kind === 'walk' && typeof raw.test.minDistance_m === 'number' && raw.test.minDistance_m > 1.5) throw new Error(`minDistance_m ${raw.test.minDistance_m} m is unrealistic for a tabletop walker in ${raw.test.duration_s ?? 6} s; small legged machines manage 0.2–0.6 m. Use a target the user asked for or a realistic one.`);
          if (raw?.test && raw.test.kind === 'walk' && typeof raw.test.maxTilt_deg === 'number' && raw.test.maxTilt_deg < 8) throw new Error(`maxTilt_deg ${raw.test.maxTilt_deg}° is tighter than this simulator measures for the recipes (3–5° bare, 6–8° with a shell or claws on top); a limit that tight burns the whole test budget chasing noise. Use 10–15° unless the user asked for a stability figure.`);
          if (raw?.test && raw.test.kind === 'motion' && this.assembly.parts.some((p) => p.category === 'legs')) { // a legged machine dancing in place measures 8–12° of tilt and 5–12 cm of drift on the recipe
            const c = raw.test.criteria as Record<string, unknown> | undefined;
            if (c && typeof c.maxBaseTilt_deg === 'number' && c.maxBaseTilt_deg < 10) throw new Error(`maxBaseTilt_deg ${c.maxBaseTilt_deg}° is tighter than a legged machine measures while dancing in place (8–12° on the recipe, more with big feet); use 12–15° unless the user asked for a stability figure.`);
            if (c && typeof c.maxBaseDrift_m === 'number' && c.maxBaseDrift_m < 0.12) throw new Error(`maxBaseDrift_m ${c.maxBaseDrift_m} m is tighter than a legged machine measures while dancing in place (5–12 cm on the recipe); use 0.15 m, or test a walk if travel is the point.`);
          }
          const a = DefineTestArgs.parse(rawArgs);
          const previous = this.testSpecs.get(a.test.id);
          if (previous && this.testEvidence.get(a.test.id)?.result.trace.frames.length) {
            const criteria = (test: TestSpec) => {
              switch (test.kind) {
                case 'motion': return [test.kind, test.duration_s, test.criteria, test.measure.followerTiming, test.measure.orbits, test.measure.jointSwing, test.measure.synchronizedTravel, test.measure.indexedMotion];
                case 'walk': return [test.kind, test.duration_s, test.minDistance_m, test.maxTilt_deg, test.direction, test.signed];
                case 'launch': return [test.kind, test.duration_s, test.targetDistance_m, test.tolerance_m, test.direction];
                case 'grip': return [test.kind, test.duration_s, test.supportUntil_s, test.maxSeparation_m];
              }
            };
            if (JSON.stringify(criteria(a.test)) !== JSON.stringify(criteria(previous))) throw new Error(`Keep the measured criteria for "${a.test.id}" fixed when comparing revisions: a test that already has a measurement is not redefined. If the first definition was wrong (for example a revolutions criterion on a swinging joint), define a new test with a different id and say in its rationale what was wrong; the old result stays on record.`);
          }
          if (!previous || JSON.stringify(previous) !== JSON.stringify(a.test)) this.testSpecs.set(a.test.id, a.test);
          log(true, `Test ${a.test.id} (${a.test.kind}) defined`);
          return { ok: true, test: a.test };
        }
        case 'run_test': {
          const a = RunTestArgs.parse(rawArgs); const spec = this.testSpecs.get(a.test_id);
          if (!spec) throw new Error(`Unknown test "${a.test_id}"; define it first. Defined: ${[...this.testSpecs.keys()].join(', ') || 'none'}`);
          if (!this.assembly.instances.length) throw new Error('No assembly yet');
          if (this.testCount >= this.budget.maxTests) throw new Error(`Test budget (${this.budget.maxTests}) exhausted; call finalize_design with the best result so far.`);
          this.testCount++;
          const n = this.tests.filter((x) => x.testId.slice(0, x.testId.lastIndexOf('#')) === a.test_id).length + 1;
          const testId = `${a.test_id}#${n}`;
          this.events.onTestStart?.(testId, spec.kind);
          const result = await runTest(this.assembly, { env: this.spec.environment, test: { ...spec, id: testId } });
          this.tests.push(result);
          this.testEvidence.set(a.test_id, { spec, result });
          this.lastTestedAssembly = this.assembly;
          const showcaseMetrics = ['maxInstanceTilt_deg', 'payloadLift_m', 'payloadSeparation_m', 'payloadReturnError_m'];
          const summary = [...showcaseMetrics, ...Object.keys(result.metrics).filter((k) => /distance|revolutions|landing|separation|maxTilt|amplitude/.test(k))]
            .filter((k) => result.metrics[k] !== undefined).slice(0, 4).map((k) => `${k}=${result.metrics[k]}`).join(', ');
          log(true, `${result.testId}: ${result.passed ? 'PASS' : 'FAIL'} — ${summary}${result.failureReasons.length ? ' — ' + result.failureReasons.join('; ') : ''}`);
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
          const a = FinalizeArgs.parse(rawArgs);
          const pending = this.pendingChecks();
          if (a.status === 'passed' && pending.length) throw new Error(`Cannot mark this build passed: ${pending.join('; ')}. Finish those checks or report the build as incomplete.`);
          this.finalized = a;
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

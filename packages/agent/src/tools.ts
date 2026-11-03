import { z } from 'zod';
import type { Assembly, PartDefinition, Spec, TestResult, ToolLogEntry, Controller } from '@protolab/schema';
import { billOfMaterials, totalMass } from '@protolab/schema';
import { searchCatalog, getPart, generatePart, generatorInfo, buildWalker, danceController, DEFAULT_WALKER, DEFAULT_DANCE, WALKER_PARAM_RANGES, type WalkerParams, ParamError, transformPoint } from '@protolab/parts';
import { runTest, walkTest, danceTest } from '@protolab/simulator';
import type { ToolDef } from './llm.ts';

export const WalkerParamsSchema = z.object({
  legCount: z.union([z.literal(4), z.literal(6)]),
  chassisPartId: z.string(),
  hipServoPartId: z.string(),
  kneeServoPartId: z.string(),
  upperLegPartId: z.string(),
  lowerLegPartId: z.string(),
  footPartId: z.string(),
  hipOffset_rad: z.number().min(WALKER_PARAM_RANGES.hipOffset_rad.min).max(WALKER_PARAM_RANGES.hipOffset_rad.max),
  kneeFlex_rad: z.number().min(WALKER_PARAM_RANGES.kneeFlex_rad.min).max(WALKER_PARAM_RANGES.kneeFlex_rad.max),
  gait: z.object({
    frequency_hz: z.number().min(0.3).max(4),
    hipAmplitude_rad: z.number().min(0.05).max(0.9),
    kneeAmplitude_rad: z.number().min(0).max(1),
    stiffness: z.number().min(0.2).max(50),
    damping: z.number().min(0).max(5),
    gaitType: z.enum(['crawl', 'trot', 'tripod']),
    swingDuty: z.number().min(0.1).max(0.5),
  }),
  shell: z.boolean(),
  dance: z.object({ frequency_hz: z.number().min(0.3).max(4), bobAmplitude_rad: z.number().min(0).max(0.8), swayAmplitude_rad: z.number().min(0).max(0.6) }).optional(),
});

const SearchArgs = z.object({ query: z.string().default(''), category: z.string().optional(), limit: z.number().int().min(1).max(30).optional() });
const GetPartArgs = z.object({ part_id: z.string() });
const CreatePartArgs = z.object({ kind: z.string(), params: z.record(z.number()), rationale: z.string().optional() });
const BuildArgs = z.object({ params: WalkerParamsSchema.partial({ shell: true }), rationale: z.string() });
const ReviseArgs = z.object({ changes: z.record(z.unknown()), rationale: z.string(), based_on: z.string().optional() });
const RunTestArgs = z.object({ kind: z.enum(['walk', 'dance']) });
const SweepArgs = z.object({
  hipAmplitude_rad: z.array(z.number().min(0.05).max(0.9)).min(1).max(4),
  frequency_hz: z.array(z.number().min(0.3).max(4)).min(1).max(4),
  kneeAmplitude_rad: z.array(z.number().min(0).max(1)).min(1).max(2).optional(),
  duration_s: z.number().min(2).max(6).optional(),
});
const FinalizeArgs = z.object({ summary: z.string(), status: z.enum(['passed', 'failed']) });
const SpecArgs = z.object({
  walkDistance_m: z.number().positive().max(5).optional(),
  maxTilt_deg: z.number().positive().max(60).optional(),
  duration_s: z.number().positive().max(12).optional(),
  legCount: z.union([z.literal(4), z.literal(6)]).optional(),
  assumptions: z.array(z.string()).max(12).optional(),
});

export const TOOL_DEFS: ToolDef[] = [
  { name: 'write_spec', description: 'Refine the engineering specification (targets, leg count, assumptions) before building. Call at most once.', parameters: {
    type: 'object', properties: {
      walkDistance_m: { type: 'number', description: 'Target distance to walk in duration_s (metres)' },
      maxTilt_deg: { type: 'number', description: 'Max allowed body tilt from upright (degrees)' },
      duration_s: { type: 'number', description: 'Test duration in seconds (≤12)' },
      legCount: { type: 'integer', enum: [4, 6] },
      assumptions: { type: 'array', items: { type: 'string' }, description: 'Explicit assumptions shown to the user' },
    } } },
  { name: 'search_catalog', description: 'Search the parts catalog. Returns part ids with key parameters, mass and limits.', parameters: {
    type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: ['motors', 'gears', 'bearings', 'shafts', 'joints', 'springs', 'brackets', 'fasteners', 'frames', 'wheels', 'pads', 'shells', 'grippers'] }, limit: { type: 'integer' } } } },
  { name: 'get_part', description: 'Get full details of a catalog or custom part.', parameters: { type: 'object', properties: { part_id: { type: 'string' } }, required: ['part_id'] } },
  { name: 'create_parametric_part', description: 'Create a custom parametric part when no catalog part fits (e.g. a longer leg_segment, a chassis with specific dimensions, a servo with different torque). Returns the new part id. Parameter ranges are enforced.', parameters: {
    type: 'object', properties: { kind: { type: 'string', description: 'Generator kind: beam, plate, body_frame, servo_motor, leg_segment, foot_pad, bracket, shell_panel, ...' }, params: { type: 'object', additionalProperties: { type: 'number' } }, rationale: { type: 'string' } }, required: ['kind', 'params'] } },
  { name: 'build_walker', description: 'Place and connect all components of a legged walker from the given part ids and parameters (chassis, hip/knee servos, leg bars, foot pads, rest angles, gait). Replaces the current assembly. Returns an assembly summary with foot positions relative to hips and total mass.', parameters: {
    type: 'object', properties: { params: { type: 'object', description: 'WalkerParams JSON: legCount, chassisPartId, hipServoPartId, kneeServoPartId, upperLegPartId, lowerLegPartId, footPartId, hipOffset_rad, kneeFlex_rad, gait{frequency_hz,hipAmplitude_rad,kneeAmplitude_rad,stiffness,damping,gaitType,swingDuty}, shell' }, rationale: { type: 'string', description: 'Why these choices, in one or two sentences shown to the user' } }, required: ['params', 'rationale'] } },
  { name: 'revise_walker', description: 'Change specific walker parameters or part ids on the current assembly and rebuild it. Use dotted keys, e.g. {"gait.hipAmplitude_rad": 0.4, "hipServoPartId": "servo-mg996r", "dance.swayAmplitude_rad": 0.1}. Dance params: dance.frequency_hz, dance.bobAmplitude_rad, dance.swayAmplitude_rad.', parameters: {
    type: 'object', properties: { changes: { type: 'object' }, rationale: { type: 'string', description: 'What measured result motivates this change' }, based_on: { type: 'string', description: 'Test id and metric the decision is based on, e.g. "walk_1: fell at 1.1 s"' } }, required: ['changes', 'rationale'] } },
  { name: 'inspect_assembly', description: 'Summarise the current assembly: parts, BOM, mass, foot placement relative to hips, joint count.', parameters: { type: 'object', properties: {} } },
  { name: 'sweep_gait', description: 'Engineering sweep: simulate the CURRENT assembly over a grid of gait values (up to 4 hip amplitudes × 4 frequencies × 2 knee lifts, short runs) and return measured distance, tilt, falls and peak torque for each. Use it after a walk test to map the stride/cadence space before choosing a revision. Sweeps are exploration: they do not create versions or count against the test budget.', parameters: {
    type: 'object', properties: { hipAmplitude_rad: { type: 'array', items: { type: 'number' } }, frequency_hz: { type: 'array', items: { type: 'number' } }, kneeAmplitude_rad: { type: 'array', items: { type: 'number' } }, duration_s: { type: 'number', description: '2–6 s per run (default 4)' } }, required: ['hipAmplitude_rad', 'frequency_hz'] } },
  { name: 'run_test', description: 'Run a deterministic physics test on the current assembly. "walk": must travel the target distance without falling. "dance": must bob/sway in place without falling or drifting. Returns measured metrics and failure reasons.', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['walk', 'dance'] } }, required: ['kind'] } },
  { name: 'finalize_design', description: 'Finish. Give an honest one-paragraph summary of what was built, what the tests measured, and what was changed between iterations.', parameters: { type: 'object', properties: { summary: { type: 'string' }, status: { type: 'string', enum: ['passed', 'failed'] } }, required: ['summary', 'status'] } },
];

export interface ToolEvents {
  onLog(entry: ToolLogEntry): void;
  onAssembly(assembly: Assembly, params: WalkerParams, rationale: string, basedOn?: string, changes?: Record<string, { from?: number; to: number }>): void;
  onTest(result: TestResult): void;
  onSpec(spec: Spec): void;
}

export class ToolRuntime {
  spec: Spec;
  customParts = new Map<string, PartDefinition>();
  params: WalkerParams | null = null;
  assembly: Assembly | null = null;
  tests: TestResult[] = [];
  testCount = 0;
  finalized: { summary: string; status: 'passed' | 'failed' } | null = null;
  specWritten = false;
  calls = 0;
  sweeps = 0;
  private events: ToolEvents;
  budget: { maxTests: number; maxToolCalls: number };
  constructor(spec: Spec, events: ToolEvents, budget = { maxTests: 6, maxToolCalls: 40 }) { this.spec = spec; this.events = events; this.budget = budget; }

  private partResolver = (id: string) => this.customParts.get(id) ?? getPart(id);

  summarisePart(p: PartDefinition) {
    return { id: p.id, kind: p.kind, name: p.name, category: p.category, params: p.params, mass_kg: +p.mass_kg.toFixed(4), limits: p.limits, cost_usd: p.cost_usd };
  }

  summariseAssembly(a: Assembly) {
    const hips = a.instances.filter((i) => i.id.startsWith('hip_servo_'));
    const feet = a.instances.filter((i) => i.id.startsWith('foot_'));
    const footOffsets = feet.map((f) => {
      const leg = f.id.replace('foot_', '');
      const hip = hips.find((h) => h.id === `hip_servo_${leg}`)!;
      return { leg, footBehindHip_m: +(f.transform.position[0] - hip.transform.position[0]).toFixed(4) };
    });
    const chassis = a.parts.find((p) => p.kind === 'body_frame')!;
    return {
      family: a.family,
      instances: a.instances.length,
      joints: a.joints.length,
      revoluteJoints: a.joints.filter((j) => j.type === 'revolute').length,
      totalMass_kg: +totalMass(a).toFixed(4),
      bodyHeight_m: +a.instances.find((i) => i.id === 'body')!.transform.position[1].toFixed(4),
      chassis: { id: chassis.id, length_m: chassis.params.length, width_m: chassis.params.width },
      footOffsets,
      note: 'footBehindHip_m should be near 0 for a statically stable crawl; negative means feet sit behind the hips (nose-heavy).',
      bom: billOfMaterials(a).map((l) => ({ part: l.name, qty: l.qty, mass_kg: +l.mass_kg.toFixed(4) })),
      params: a.familyConfig,
    };
  }

  private applyChanges(base: WalkerParams, changes: Record<string, unknown>): { next: WalkerParams; diff: Record<string, { from?: number; to: number }> } {
    const next: WalkerParams = { ...base, gait: { ...base.gait }, dance: { ...DEFAULT_DANCE, ...(base.dance ?? {}) } };
    const diff: Record<string, { from?: number; to: number }> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (k.startsWith('dance.')) {
        const dk = k.slice(6) as keyof typeof DEFAULT_DANCE;
        if (!(dk in next.dance!)) throw new Error(`Unknown dance parameter "${dk}"`);
        const from = next.dance![dk];
        if (typeof v !== 'number') throw new Error(`dance.${dk} must be a number`);
        next.dance![dk] = v; diff[k] = { from, to: v };
      } else if (k.startsWith('gait.')) {
        const gk = k.slice(5) as keyof WalkerParams['gait'];
        if (!(gk in next.gait)) throw new Error(`Unknown gait parameter "${gk}"`);
        const from = next.gait[gk];
        (next.gait as Record<string, unknown>)[gk] = v;
        if (typeof v === 'number') diff[k] = { from: typeof from === 'number' ? from : undefined, to: v };
      } else if (k === 'gait' && typeof v === 'object' && v) {
        for (const [gk, gv] of Object.entries(v as Record<string, unknown>)) { const from = (next.gait as Record<string, unknown>)[gk]; (next.gait as Record<string, unknown>)[gk] = gv; if (typeof gv === 'number') diff[`gait.${gk}`] = { from: typeof from === 'number' ? from : undefined, to: gv }; }
      } else {
        if (!(k in next)) throw new Error(`Unknown walker parameter "${k}"`);
        const rec = next as unknown as Record<string, unknown>;
        const from = rec[k];
        rec[k] = v;
        if (typeof v === 'number') diff[k] = { from: typeof from === 'number' ? from : undefined, to: v };
        else if (typeof v === 'string' && from !== v) diff[k] = { to: 0 }; // part swap; summarised in rationale
      }
    }
    const chassisPairs = this.partResolver(next.chassisPartId)?.params.legPairs;
    if (next.legCount === 6 && chassisPairs !== 3) next.chassisPartId = 'chassis-hex-200';
    if (next.legCount === 4 && chassisPairs === 3) next.chassisPartId = 'chassis-quad-160';
    return { next: WalkerParamsSchema.parse(next), diff };
  }

  /** Execute a named tool with raw JSON args. Always returns a JSON-serialisable result; throws on invalid args. */
  async call(name: string, rawArgs: unknown): Promise<unknown> {
    this.calls++;
    if (this.calls > this.budget.maxToolCalls) throw new Error(`Tool-call budget (${this.budget.maxToolCalls}) exhausted; call finalize_design.`);
    const t = new Date().toISOString();
    const log = (ok: boolean, summary: string, args: unknown = rawArgs) => this.events.onLog({ t, tool: name, args, ok, summary });
    try {
      switch (name) {
        case 'write_spec': {
          const a = SpecArgs.parse(rawArgs);
          const next: Spec = { ...this.spec, targets: { ...this.spec.targets }, constraints: { ...this.spec.constraints } };
          if (a.walkDistance_m) next.targets.walkDistance_m = a.walkDistance_m;
          if (a.maxTilt_deg) next.targets.maxTilt_deg = a.maxTilt_deg;
          if (a.duration_s) next.targets.duration_s = a.duration_s;
          if (a.legCount) next.constraints.legCount = a.legCount;
          if (a.assumptions) next.assumptions = [...a.assumptions];
          this.spec = next; this.specWritten = true;
          this.events.onSpec(next);
          log(true, `Spec: walk ${next.targets.walkDistance_m} m in ${next.targets.duration_s} s, tilt ≤ ${next.targets.maxTilt_deg}°, ${next.constraints.legCount} legs`);
          return { spec: next };
        }
        case 'search_catalog': {
          const a = SearchArgs.parse(rawArgs);
          const res = searchCatalog(a.query, { category: a.category as never, limit: a.limit ?? 12 });
          const custom = [...this.customParts.values()].filter((p) => !a.category || p.category === a.category);
          log(true, `${res.length + custom.length} parts for "${a.query}"${a.category ? ` in ${a.category}` : ''}`);
          return { parts: [...custom, ...res].map((p) => this.summarisePart(p)), generators: a.query === '' ? generatorInfo().map((g) => g.kind) : undefined };
        }
        case 'get_part': {
          const a = GetPartArgs.parse(rawArgs);
          const p = this.partResolver(a.part_id);
          if (!p) throw new Error(`Unknown part id "${a.part_id}"`);
          log(true, `${p.name}`);
          return { part: { ...this.summarisePart(p), description: p.description, connectors: p.connectors.map((c) => ({ id: c.id, kind: c.kind })), dimensions_m: p.dimensions_m, material: p.material } };
        }
        case 'create_parametric_part': {
          const a = CreatePartArgs.parse(rawArgs);
          const id = `custom-${a.kind}-${this.customParts.size + 1}`;
          const p = generatePart(a.kind, a.params, id);
          this.customParts.set(id, p);
          log(true, `Created ${p.name} (${id})`);
          return { part: this.summarisePart(p) };
        }
        case 'build_walker': {
          const a = BuildArgs.parse(rawArgs);
          const params = WalkerParamsSchema.parse({ shell: true, ...a.params });
          if (params.legCount !== this.spec.constraints.legCount) throw new Error(`Spec requires ${this.spec.constraints.legCount} legs`);
          const asm = buildWalker(params, this.partResolver);
          const summary = this.summariseAssembly(asm);
          if (summary.totalMass_kg > this.spec.constraints.maxMass_kg) throw new Error(`Assembly mass ${summary.totalMass_kg} kg exceeds limit ${this.spec.constraints.maxMass_kg} kg; choose lighter parts`);
          this.params = params; this.assembly = asm;
          log(true, `Built ${asm.instances.length} components, ${summary.revoluteJoints} joints, ${summary.totalMass_kg} kg`);
          this.events.onAssembly(asm, params, a.rationale);
          return summary;
        }
        case 'revise_walker': {
          const a = ReviseArgs.parse(rawArgs);
          if (!this.params) throw new Error('No assembly yet; call build_walker first');
          const { next, diff } = this.applyChanges(this.params, a.changes);
          const asm = buildWalker(next, this.partResolver);
          const summary = this.summariseAssembly(asm);
          if (summary.totalMass_kg > this.spec.constraints.maxMass_kg) throw new Error(`Assembly mass ${summary.totalMass_kg} kg exceeds limit ${this.spec.constraints.maxMass_kg} kg; the change was not applied`);
          this.params = next; this.assembly = asm;
          log(true, `Revised: ${Object.entries(a.changes).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`).join(', ')}`);
          this.events.onAssembly(asm, next, a.rationale, a.based_on, diff);
          return summary;
        }
        case 'inspect_assembly': {
          if (!this.assembly) throw new Error('No assembly yet');
          log(true, 'Inspected assembly');
          return this.summariseAssembly(this.assembly);
        }
        case 'run_test': {
          const a = RunTestArgs.parse(rawArgs);
          if (!this.assembly) throw new Error('No assembly yet; call build_walker first');
          if (this.testCount >= this.budget.maxTests) throw new Error(`Test budget (${this.budget.maxTests}) exhausted; call finalize_design with the best result so far.`);
          this.testCount++;
          const n = this.tests.filter((x) => x.kind === a.kind).length + 1;
          const test = a.kind === 'walk' ? walkTest(this.spec, `walk_${n}`) : danceTest(this.spec, `dance_${n}`);
          const controller: Controller | undefined = a.kind === 'dance' ? danceController(this.assembly.controller as never, this.params?.dance) : undefined;
          const result = await runTest(this.assembly, { env: this.spec.environment, test, controller });
          if (controller) this.assembly = { ...this.assembly, controller };
          this.tests.push(result);
          log(true, `${test.id}: ${result.passed ? 'PASS' : 'FAIL'} — distance ${result.metrics.distance_m} m, tilt ${result.metrics.maxTilt_deg}°${result.failureReasons.length ? ' — ' + result.failureReasons.join('; ') : ''}`);
          this.events.onTest(result);
          return { testId: test.id, kind: a.kind, passed: result.passed, metrics: result.metrics, failureReasons: result.failureReasons, engine: result.engine };
        }
        case 'sweep_gait': {
          const a = SweepArgs.parse(rawArgs);
          if (!this.assembly || !this.params) throw new Error('No assembly yet; call build_walker first');
          if (this.sweeps >= 3) throw new Error('Sweep budget (3) exhausted');
          this.sweeps++;
          const base = this.assembly.controller;
          if (!base || base.kind !== 'gait') throw new Error('Assembly has no gait controller');
          const duration = a.duration_s ?? 4;
          const spec = this.spec;
          const results: Array<Record<string, number>> = [];
          for (const hip of a.hipAmplitude_rad) for (const f of a.frequency_hz) for (const knee of a.kneeAmplitude_rad ?? [base.kneeAmplitude_rad]) {
            const controller = { ...base, hipAmplitude_rad: hip, frequency_hz: f, kneeAmplitude_rad: knee };
            const r = await runTest(this.assembly, { env: spec.environment, controller, test: { id: 'sweep', kind: 'walk', duration_s: duration, targets: { minDistance_m: spec.targets.walkDistance_m * (duration / spec.targets.duration_s), maxTilt_deg: spec.targets.maxTilt_deg } } });
            results.push({ hipAmplitude_rad: hip, frequency_hz: f, kneeAmplitude_rad: knee, distance_m: r.metrics.distance_m, projected6s_m: +((r.metrics.distance_m / Math.max(0.5, duration - 0.25)) * (spec.targets.duration_s - 0.25)).toFixed(3), maxTilt_deg: r.metrics.maxTilt_deg, fell: r.metrics.fell, peakHipTorque_Nm: r.metrics.peakHipTorque_Nm, peakKneeTorque_Nm: r.metrics.peakKneeTorque_Nm });
          }
          results.sort((x, y) => (x.fell - y.fell) || (y.distance_m - x.distance_m));
          const best = results[0];
          log(true, `${results.length} runs × ${duration} s; best: hip ${best.hipAmplitude_rad} rad @ ${best.frequency_hz} Hz, knee ${best.kneeAmplitude_rad} → ${best.distance_m} m${best.fell ? ' (fell)' : ''}`);
          return { duration_s: duration, note: 'distance_m is over the sweep duration; projected6s_m scales it to the spec duration. Torque ratings: ' + `hip ${this.assembly.joints.find((j) => j.id.startsWith('hip_'))?.motor?.maxTorque_Nm} N·m, knee ${this.assembly.joints.find((j) => j.id.startsWith('knee_'))?.motor?.maxTorque_Nm} N·m`, results };
        }
        case 'finalize_design': {
          const a = FinalizeArgs.parse(rawArgs);
          this.finalized = a;
          log(true, `Finalized (${a.status})`);
          return { ok: true };
        }
        default:
          throw new Error(`Unknown tool "${name}"`);
      }
    } catch (e) {
      const msg = e instanceof ParamError || e instanceof z.ZodError || e instanceof Error ? (e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message) : String(e);
      log(false, msg);
      return { error: msg };
    }
  }
}

export { DEFAULT_WALKER, WALKER_PARAM_RANGES, transformPoint };

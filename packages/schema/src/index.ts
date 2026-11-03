import { z } from 'zod';

// ---------- Math primitives (SI units: metres, kilograms, seconds, radians) ----------
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
export const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]); // x y z w
export type Quat = z.infer<typeof Quat>;
export const Transform = z.object({ position: Vec3, rotation: Quat });
export type Transform = z.infer<typeof Transform>;
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

// ---------- Geometry ----------
export const Shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), size: Vec3 }),
  z.object({ kind: z.literal('cylinder'), radius: z.number().positive(), height: z.number().positive(), axis: z.enum(['x', 'y', 'z']) }),
  z.object({ kind: z.literal('sphere'), radius: z.number().positive() }),
]);
export type Shape = z.infer<typeof Shape>;

export const GeometryPiece = z.object({
  shape: Shape,
  offset: Transform.default(IDENTITY),
  color: z.string().optional(),
  role: z.enum(['structure', 'motor', 'shell', 'contact', 'fastener', 'decor']).default('structure'),
});
export type GeometryPiece = z.infer<typeof GeometryPiece>;

// ---------- Parts ----------
export const PartCategory = z.enum([
  'motors', 'gears', 'bearings', 'shafts', 'joints', 'springs', 'brackets', 'fasteners', 'frames', 'wheels', 'pads', 'shells', 'grippers',
]);
export type PartCategory = z.infer<typeof PartCategory>;

export const Connector = z.object({
  id: z.string(),
  position: Vec3,           // in part-local frame
  axis: Vec3,               // unit axis in part-local frame
  kind: z.enum(['fixed', 'revolute', 'any']),
});
export type Connector = z.infer<typeof Connector>;

export const PartSource = z.object({
  kind: z.enum(['parametric', 'external']),
  license: z.string(),       // e.g. "CC0-1.0"
  creator: z.string(),
  url: z.string().optional(),
  attribution: z.string().optional(),
});

export const PartDefinition = z.object({
  id: z.string(),
  kind: z.string(),            // generator kind e.g. "beam", "servo_motor"
  name: z.string(),
  category: PartCategory,
  description: z.string(),
  params: z.record(z.number()),
  mass_kg: z.number().positive(),
  dimensions_m: Vec3,
  material: z.string(),
  geometry: z.array(GeometryPiece),
  connectors: z.array(Connector),
  limits: z.object({
    maxTorque_Nm: z.number().optional(),
    maxSpeed_rad_s: z.number().optional(),
    maxLoad_N: z.number().optional(),
  }).default({}),
  cost_usd: z.number().nonnegative().default(0),
  source: PartSource,
});
export type PartDefinition = z.infer<typeof PartDefinition>;

// ---------- Assembly ----------
export const Instance = z.object({
  id: z.string(),
  partId: z.string(),
  label: z.string(),
  transform: Transform,       // world pose at rest
  group: z.string().optional(), // e.g. "leg_fl" for tree display
});
export type Instance = z.infer<typeof Instance>;

export const Motor = z.object({
  controlId: z.string(),      // referenced by controller
  maxTorque_Nm: z.number().positive(),
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
});
export type Motor = z.infer<typeof Motor>;

export const Joint = z.object({
  id: z.string(),
  type: z.enum(['fixed', 'revolute']),
  a: z.object({ instanceId: z.string(), connectorId: z.string() }),
  b: z.object({ instanceId: z.string(), connectorId: z.string() }),
  axis: Vec3.optional(),            // world axis at rest pose (revolute)
  limits_rad: z.tuple([z.number(), z.number()]).optional(),
  motor: Motor.optional(),
});
export type Joint = z.infer<typeof Joint>;

export const GaitController = z.object({
  kind: z.literal('gait'),
  frequency_hz: z.number().positive(),
  hipAmplitude_rad: z.number(),
  kneeAmplitude_rad: z.number(),
  hipOffset_rad: z.number().default(0),
  kneeOffset_rad: z.number().default(0),
  phases: z.record(z.number()),     // controlId -> phase (rad)
  kneeLag_rad: z.number().default(Math.PI / 2),
  swingDuty: z.number().min(0.1).max(0.5).default(0.22), // fraction of the cycle a leg spends in the air
  rampIn_s: z.number().min(0).default(0.6),           // amplitude ramp after the controller starts
  gaitType: z.enum(['crawl', 'trot', 'tripod']).default('crawl'),
});
export const DanceController = z.object({
  kind: z.literal('dance'),
  frequency_hz: z.number().positive(),
  bobAmplitude_rad: z.number(),
  swayAmplitude_rad: z.number(),
  hipOffset_rad: z.number().default(0),
  kneeOffset_rad: z.number().default(0),
  rampIn_s: z.number().min(0).default(0.4),
  phases: z.record(z.number()),
});
export const Controller = z.discriminatedUnion('kind', [GaitController, DanceController]);
export type Controller = z.infer<typeof Controller>;
export type GaitController = z.infer<typeof GaitController>;
export type DanceController = z.infer<typeof DanceController>;

export const Assembly = z.object({
  family: z.string(),                 // e.g. "legged_walker"
  familyParams: z.record(z.number()), // parametric family values for display/remix
  familyConfig: z.record(z.unknown()).default({}), // full family input (part ids + params) so a version can be rebuilt/remixed
  parts: z.array(PartDefinition),
  instances: z.array(Instance),
  joints: z.array(Joint),
  controller: Controller.optional(),
});
export type Assembly = z.infer<typeof Assembly>;

// ---------- Specification ----------
export const Spec = z.object({
  task: z.string(),
  family: z.enum(['legged_walker']),
  targets: z.object({
    walkDistance_m: z.number().positive(),
    maxTilt_deg: z.number().positive(),
    duration_s: z.number().positive(),
  }),
  environment: z.object({
    gravity_m_s2: z.number(),
    groundFriction: z.number(),
  }),
  constraints: z.object({
    legCount: z.union([z.literal(4), z.literal(6)]),
    maxBodyLength_m: z.number().positive(),
    maxMass_kg: z.number().positive(),
    maxParts: z.number().int().positive(),
  }),
  followUps: z.array(z.enum(['dance'])).default([]),
  assumptions: z.array(z.string()),
});
export type Spec = z.infer<typeof Spec>;

// ---------- Tests ----------
export const TestKind = z.enum(['walk', 'dance']);
export const TestSpec = z.object({
  id: z.string(),
  kind: TestKind,
  duration_s: z.number().positive(),
  targets: z.object({
    minDistance_m: z.number().optional(),
    maxTilt_deg: z.number(),
    maxDrift_m: z.number().optional(),
  }),
});
export type TestSpec = z.infer<typeof TestSpec>;

export const TraceFrame = z.object({
  t: z.number(),
  bodies: z.record(Transform),       // instanceId -> world transform
});
export const Trace = z.object({
  dt: z.number(),
  frames: z.array(TraceFrame),
});
export type Trace = z.infer<typeof Trace>;

export const TestResult = z.object({
  testId: z.string(),
  kind: TestKind,
  passed: z.boolean(),
  metrics: z.record(z.number()),
  failureReasons: z.array(z.string()),
  engine: z.string(),                 // e.g. "rapier3d 0.14 @ 120 Hz"
  trace: Trace,
});
export type TestResult = z.infer<typeof TestResult>;

// ---------- Agent log / versions ----------
export const ToolLogEntry = z.object({
  t: z.string(),
  tool: z.string(),
  args: z.unknown(),
  ok: z.boolean(),
  summary: z.string(),
});
export type ToolLogEntry = z.infer<typeof ToolLogEntry>;

export const Decision = z.object({
  source: z.enum(['model', 'planner']),   // model = LLM decision, planner = deterministic fallback
  modelId: z.string().optional(),          // which model made this decision (primary or specialist)
  summary: z.string(),
  basedOn: z.string().optional(),          // e.g. "walk_1: distance 0.08 m < 0.4 m"
  changes: z.record(z.object({ from: z.number().optional(), to: z.number() })),
});
export type Decision = z.infer<typeof Decision>;

export const VersionRecord = z.object({
  id: z.string(),
  inventionId: z.string(),
  parentVersionId: z.string().nullable(),
  iteration: z.number().int(),
  prompt: z.string(),
  spec: Spec,
  assembly: Assembly,
  tests: z.array(TestResult),
  decisions: z.array(Decision),
  toolLog: z.array(ToolLogEntry),
  modelId: z.string(),
  status: z.enum(['passed', 'failed', 'error']),
  createdAt: z.string(),
});
export type VersionRecord = z.infer<typeof VersionRecord>;

export const BomLine = z.object({ partId: z.string(), name: z.string(), category: PartCategory, qty: z.number().int(), mass_kg: z.number(), cost_usd: z.number() });
export type BomLine = z.infer<typeof BomLine>;

export function billOfMaterials(a: Assembly): BomLine[] {
  const byPart = new Map<string, number>();
  for (const inst of a.instances) byPart.set(inst.partId, (byPart.get(inst.partId) ?? 0) + 1);
  const lines: BomLine[] = [];
  for (const [partId, qty] of byPart) {
    const p = a.parts.find((x) => x.id === partId);
    if (!p) continue;
    lines.push({ partId, name: p.name, category: p.category, qty, mass_kg: p.mass_kg * qty, cost_usd: p.cost_usd * qty });
  }
  return lines.sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
}

export function totalMass(a: Assembly): number {
  return billOfMaterials(a).reduce((s, l) => s + l.mass_kg, 0);
}

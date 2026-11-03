import { z } from 'zod';

// ============================================================================
// ProtoLab assembly schema v2 — general mechanical inventions.
// SI units internally: metres, kilograms, seconds, radians. Display converts.
// ============================================================================

export const SCHEMA_VERSION = 2;

// ---------- Math primitives ----------
export const Vec2 = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2>;
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
export const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]); // x y z w
export type Quat = z.infer<typeof Quat>;
export const Transform = z.object({ position: Vec3, rotation: Quat });
export type Transform = z.infer<typeof Transform>;
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
export const Axis = z.enum(['x', 'y', 'z']);
export type Axis = z.infer<typeof Axis>;

// ---------- Geometry ----------
// Profiles are closed 2D polygons (counter-clockwise, metres). Extrusions sweep a profile along an
// axis; revolves spin a (radius, height) profile around an axis. Both render as real curved solids
// and simulate as convex hulls.
export const Profile = z.array(Vec2).min(3).max(1024);
export type Profile = z.infer<typeof Profile>;

export const Shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), size: Vec3 }),
  z.object({ kind: z.literal('cylinder'), radius: z.number().positive(), height: z.number().positive(), axis: Axis }),
  z.object({ kind: z.literal('sphere'), radius: z.number().positive() }),
  z.object({ kind: z.literal('capsule'), radius: z.number().positive(), height: z.number().positive(), axis: Axis }),
  z.object({ kind: z.literal('ellipsoid'), radii: Vec3 }),
  z.object({ kind: z.literal('extrude'), profile: Profile, depth: z.number().positive(), axis: Axis }),
  z.object({ kind: z.literal('revolve'), profile: Profile, axis: Axis, segments: z.number().int().min(6).max(96).default(32) }),
]);
export type Shape = z.infer<typeof Shape>;

export const PieceRole = z.enum(['structure', 'motor', 'shell', 'contact', 'fastener', 'decor', 'blade', 'wing', 'payload']);
export const GeometryPiece = z.object({
  shape: Shape,
  offset: Transform.default(IDENTITY),
  color: z.string().optional(),
  material: z.string().optional(),
  role: PieceRole.default('structure'),
  collide: z.boolean().default(true),
});
export type GeometryPiece = z.infer<typeof GeometryPiece>;

// ---------- Parts ----------
export const PartCategory = z.enum([
  'frames', 'plates', 'beams', 'brackets', 'enclosures', 'panels',
  'gears', 'shafts', 'bearings', 'wheels', 'pulleys', 'flywheels',
  'hinges', 'sliders', 'joints', 'linkages', 'cranks', 'pistons',
  'motors', 'springs', 'actuators',
  'wings', 'propellers', 'grippers', 'tracks', 'legs', 'pads', 'fasteners', 'shells', 'payloads', 'misc',
]);
export type PartCategory = z.infer<typeof PartCategory>;

export const ConnectorKind = z.enum(['fixed', 'revolute', 'prismatic', 'any']);
export const Connector = z.object({
  id: z.string(),
  position: Vec3,           // part-local
  axis: Vec3,               // unit, part-local; points OUT of the part (mating connectors face each other)
  kind: ConnectorKind,
  description: z.string().optional(),
});
export type Connector = z.infer<typeof Connector>;

export const PartSource = z.object({
  kind: z.enum(['parametric', 'designed', 'external']),
  license: z.string(),
  creator: z.string(),
  url: z.string().optional(),
  attribution: z.string().optional(),
  shareAlike: z.boolean().optional(),
});
export type PartSource = z.infer<typeof PartSource>;

export const PartDefinition = z.object({
  id: z.string(),
  kind: z.string(),            // generator kind, or "designed" / "external"
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
    maxForce_N: z.number().optional(),
    maxLoad_N: z.number().optional(),
    stiffness_N_m: z.number().optional(),
    travel_m: z.number().optional(),
  }).default({}),
  cost_usd: z.number().nonnegative().default(0),
  source: PartSource,
  /** Decorative external meshes carry no mechanical properties and may not be mounted as structure. */
  decorative: z.boolean().default(false),
  meshUrl: z.string().optional(),
});
export type PartDefinition = z.infer<typeof PartDefinition>;

// ---------- Assembly ----------
export const Instance = z.object({
  id: z.string(),
  partId: z.string(),
  label: z.string(),
  transform: Transform,         // world pose at rest
  group: z.string().optional(),
  anchored: z.boolean().default(false),  // fixed to the world (base, tower, ground frame)
  free: z.boolean().default(false),      // unconstrained dynamic body (projectile, payload)
});
export type Instance = z.infer<typeof Instance>;

export const Motor = z.object({
  controlId: z.string(),
  maxTorque_Nm: z.number().positive().optional(),  // revolute rating
  maxForce_N: z.number().positive().optional(),    // prismatic rating
  stiffness: z.number().positive(),
  damping: z.number().nonnegative(),
});
export type Motor = z.infer<typeof Motor>;

export const Joint = z.object({
  id: z.string(),
  type: z.enum(['fixed', 'revolute', 'prismatic', 'spring']),
  a: z.object({ instanceId: z.string(), connectorId: z.string() }),
  b: z.object({ instanceId: z.string(), connectorId: z.string() }),
  axis: Vec3.optional(),                       // world axis at rest pose
  anchor: Vec3.optional(),                     // world anchor point at rest pose (connector a position)
  limits: z.tuple([z.number(), z.number()]).optional(), // rad (revolute) or m (prismatic)
  motor: Motor.optional(),
  spring: z.object({ stiffness: z.number().positive(), damping: z.number().nonnegative(), restLength_m: z.number().nonnegative() }).optional(),
});
export type Joint = z.infer<typeof Joint>;

// ---------- Drives (controllers) ----------
export const DriveProfile = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), value: z.number() }),
  z.object({ kind: z.literal('sine'), amplitude: z.number(), offset: z.number().default(0), frequency_hz: z.number().positive(), phase: z.number().default(0) }),
  z.object({ kind: z.literal('ramp'), from: z.number(), to: z.number(), start_s: z.number().default(0), duration_s: z.number().positive() }),
  z.object({ kind: z.literal('step'), before: z.number(), after: z.number(), at_s: z.number().nonnegative() }),
  // Legged-locomotion profile: fast swing over a short duty, linear stance sweep. "lift" drives add a lift bump during swing.
  z.object({ kind: z.literal('gait'), role: z.enum(['swing', 'lift']), amplitude: z.number(), offset: z.number().default(0), frequency_hz: z.number().positive(), phase: z.number().default(0), swingDuty: z.number().min(0.1).max(0.5).default(0.22) }),
]);
export type DriveProfile = z.infer<typeof DriveProfile>;

export const Drive = z.object({
  controlId: z.string(),
  mode: z.enum(['position', 'velocity']).default('position'),
  profile: DriveProfile,
  rampIn_s: z.number().min(0).default(0.5),
});
export type Drive = z.infer<typeof Drive>;

export const Controller = z.object({ drives: z.array(Drive) });
export type Controller = z.infer<typeof Controller>;

export const Assembly = z.object({
  schemaVersion: z.literal(2).default(2),
  parts: z.array(PartDefinition),
  instances: z.array(Instance),
  joints: z.array(Joint),
  controller: Controller.default({ drives: [] }),
  /** Free-form summary of the family/config for remix and display. */
  familyParams: z.record(z.number()).default({}),
  familyConfig: z.record(z.unknown()).default({}),
  family: z.string().default('custom'),
});
export type Assembly = z.infer<typeof Assembly>;

// ---------- Engineering plan / spec ----------
export const Plan = z.object({
  purpose: z.string(),
  features: z.array(z.string()).max(12),     // recognisable physical features
  motions: z.array(z.string()).max(12),      // required motions
  subassemblies: z.array(z.string()).max(12),
  successCriteria: z.array(z.string()).max(12),
  unverified: z.array(z.string()).max(12),   // behaviours the physics cannot verify (e.g. aerodynamic lift)
});
export type Plan = z.infer<typeof Plan>;

export const Spec = z.object({
  task: z.string(),
  plan: Plan.optional(),
  environment: z.object({ gravity_m_s2: z.number().default(9.81), groundFriction: z.number().default(0.9) }).default({}),
  constraints: z.object({ maxMass_kg: z.number().positive().default(5), maxParts: z.number().int().positive().default(80), maxSize_m: z.number().positive().default(1.5) }).default({}),
  assumptions: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
  // Legacy walker fields kept so earlier versions still load.
  family: z.string().optional(),
  targets: z.record(z.number()).optional(),
});
export type Spec = z.infer<typeof Spec>;

// ---------- Tests ----------
export const ClearancePair = z.tuple([z.string(), z.string()]);
export const TestSpec = z.discriminatedUnion('kind', [
  // Drive the mechanism and measure joints, a base body, clearances and ground contact.
  z.object({
    kind: z.literal('motion'), id: z.string(), duration_s: z.number().positive().max(15),
    measure: z.object({
      joints: z.array(z.string()).default([]),             // controlIds to report amplitude/rate/torque
      base: z.string().optional(),                           // instance whose tilt/drift are reported
      clearancePairs: z.array(ClearancePair).default([]),    // instance pairs that must not touch
      noGroundContact: z.array(z.string()).default([]),      // instances that must not touch the ground
      uprightInstances: z.array(z.string().min(1)).min(1).max(80).optional(),
      jointSwing: z.array(z.object({
        joint: z.string().min(1),
        minEachWay_rad: z.number().positive().max(Math.PI),
      })).min(1).max(8).optional(),
      linearTravel: z.array(z.object({
        instance: z.string().min(1),
        axis: Axis,
        minTravel_m: z.number().positive(),
      })).max(80).optional(),
      synchronizedTravel: z.object({
        instances: z.array(z.string().min(1)).min(2).max(16),
        axis: Axis,
        minTravel_m: z.number().positive(),
        maxSpread_m: z.number().positive(),
      }).optional(),
      orbits: z.array(z.object({
        body: z.string().min(1),
        center: z.string().min(1),
        plane: z.enum(['xy', 'xz', 'yz']),
        reference: z.union([z.string().min(1), z.object({ from: z.string().min(1), to: z.string().min(1) })]).optional(),
        minTurns: z.number().positive(),
        direction: z.enum(['positive', 'negative']).optional(),
        minRadius_m: z.number().positive().optional(),
        maxRadius_m: z.number().positive().optional(),
      })).min(1).max(4).optional(),
      followerTiming: z.object({
        shaft: z.string().min(1),
        followers: z.union([
          z.tuple([z.string().min(1), z.string().min(1)]),
          z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
        ]),
        axis: Axis,
        minCycles: z.number().int().min(1).max(30),
        minStroke_m: z.number().gt(0.001),
        minLowDwell_s: z.number().positive().max(15).optional(),
        minPhaseGap_deg: z.number().positive().max(180),
        maxPhaseGap_deg: z.number().positive().max(360).optional(),
      }).optional(),
      payload: z.object({ instance: z.string().min(1), holder: z.string().min(1).optional() }).optional(),
    }).default({}),
    criteria: z.object({
      minJointAmplitude_rad: z.number().optional(),
      minJointRate_rad_s: z.number().optional(),
      minRevolutions: z.number().optional(),
      maxBaseTilt_deg: z.number().optional(),
      maxBaseDrift_m: z.number().optional(),
      maxInstanceTilt_deg: z.number().min(0).max(180).optional(),
      minPayloadLift_m: z.number().positive().optional(),
      maxPayloadSeparation_m: z.number().positive().optional(),
      maxPayloadReturnError_m: z.number().nonnegative().optional(),
      torqueWithinRating: z.boolean().default(true),
    }).default({}),
  }),
  z.object({
    kind: z.literal('walk'), id: z.string(), duration_s: z.number().positive().max(15), base: z.string().default('body'),
    minDistance_m: z.number().nonnegative(), maxTilt_deg: z.number().positive().default(25), direction: Axis.default('x'),
    signed: z.boolean().default(false),   // false: travel in either sense along the axis counts (a backward walk is still a walk)
  }),
  z.object({
    kind: z.literal('launch'), id: z.string(), duration_s: z.number().positive().max(15), projectile: z.string(),
    targetDistance_m: z.number().positive(), tolerance_m: z.number().positive(), direction: Axis.default('x'),
  }),
  z.object({
    kind: z.literal('grip'), id: z.string(), duration_s: z.number().positive().max(15), payload: z.string(), holder: z.string(),
    supportUntil_s: z.number().nonnegative().default(1.0),   // payload rests on a temporary support until the fingers close
    maxSeparation_m: z.number().positive(),                  // payload must stay within this distance of the holder
  }),
]);
export type TestSpec = z.infer<typeof TestSpec>;
export const TestKind = z.enum(['motion', 'walk', 'launch', 'grip', 'dance']);

export const TraceFrame = z.object({ t: z.number(), bodies: z.record(Transform), joints: z.record(z.number()).default({}) });
export const Trace = z.object({ dt: z.number(), frames: z.array(TraceFrame) });
export type Trace = z.infer<typeof Trace>;

export const TestResult = z.object({
  testId: z.string(),
  kind: z.string(),
  passed: z.boolean(),
  metrics: z.record(z.number()),
  failureReasons: z.array(z.string()),
  notes: z.array(z.string()).default([]),
  engine: z.string(),
  trace: Trace,
});
export type TestResult = z.infer<typeof TestResult>;

// ---------- Agent log / versions ----------
export const PickedPart = z.object({ id: z.string(), name: z.string(), category: z.string(), mass_kg: z.number(), custom: z.boolean(), part: z.unknown().optional() });
export const ToolLogEntry = z.object({ t: z.string(), tool: z.string(), args: z.unknown(), ok: z.boolean(), summary: z.string(), parts: z.array(PickedPart).optional() });
export type ToolLogEntry = z.infer<typeof ToolLogEntry>;

export const Decision = z.object({
  source: z.enum(['model', 'planner']),
  modelId: z.string().optional(),
  summary: z.string(),
  basedOn: z.string().optional(),
  previousTestId: z.string().optional(),
  changes: z.record(z.object({ from: z.number().optional(), to: z.number() })).default({}),
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

export const BomLine = z.object({ partId: z.string(), name: z.string(), category: PartCategory, qty: z.number().int(), mass_kg: z.number(), cost_usd: z.number(), source: PartSource.optional() });
export type BomLine = z.infer<typeof BomLine>;

export function billOfMaterials(a: Assembly): BomLine[] {
  const byPart = new Map<string, number>();
  for (const inst of a.instances) byPart.set(inst.partId, (byPart.get(inst.partId) ?? 0) + 1);
  const lines: BomLine[] = [];
  for (const [partId, qty] of byPart) {
    const p = a.parts.find((x) => x.id === partId);
    if (!p) continue;
    lines.push({ partId, name: p.name, category: p.category, qty, mass_kg: p.mass_kg * qty, cost_usd: p.cost_usd * qty, source: p.source });
  }
  return lines.sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
}

export function totalMass(a: Assembly): number {
  return billOfMaterials(a).reduce((s, l) => s + l.mass_kg, 0);
}

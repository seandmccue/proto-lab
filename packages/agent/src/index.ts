import type { Assembly, Decision, Spec, TestResult, ToolLogEntry, VersionRecord } from '@protolab/schema';
import { chat, modelConfigFromEnv, specialistConfigFromEnv, smokeTest, prettyModelName, TransientModelError, DEFAULT_MODEL, DEFAULT_BASE_URL, type ChatMessage, type ModelConfig } from './llm.ts';
import { baseSpec } from './spec.ts';
import { ToolRuntime, TOOL_DEFS } from './tools.ts';
import { runPlanner } from './planner.ts';

export { modelConfigFromEnv, specialistConfigFromEnv, smokeTest, prettyModelName, DEFAULT_MODEL, DEFAULT_BASE_URL, baseSpec, ToolRuntime, TOOL_DEFS };
export type { ModelConfig };

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'spec'; spec: Spec }
  | { type: 'tool'; entry: ToolLogEntry }
  | { type: 'assembly'; iteration: number; assembly: Assembly; rationale: string }
  | { type: 'test'; iteration: number; result: TestResult }
  | { type: 'version'; version: VersionRecord }
  | { type: 'handoff'; from: string; to: string; message: string }
  | { type: 'done'; status: 'passed' | 'failed' | 'error'; summary: string; modelId: string }
  | { type: 'error'; message: string };

export interface AgentInput {
  prompt: string; inventionId: string; parent?: VersionRecord | null; changeRequest?: string;
  maxIterations?: number; startIteration?: number; model?: ModelConfig | null; specialist?: { model: ModelConfig; after: number } | null;
  newVersionId: () => string;
}
export interface AgentOutput { versions: VersionRecord[]; status: 'passed' | 'failed' | 'error'; summary: string; modelId: string; spec: Spec }
export const DETERMINISTIC_MODEL_ID = 'deterministic-planner';

export async function runAgent(input: AgentInput, emit: (e: AgentEvent) => void): Promise<AgentOutput> {
  const model = input.model === undefined ? modelConfigFromEnv() : input.model;
  const specialist = model ? (input.specialist === undefined ? specialistConfigFromEnv() : input.specialist) : null;
  const modelId = model ? model.model : DETERMINISTIC_MODEL_ID;
  let activeModelId = modelId;
  const maxIterations = input.maxIterations ?? 7;
  const fullPrompt = input.changeRequest ? `${input.prompt}\n\nChange request: ${input.changeRequest}` : input.prompt;
  let spec = baseSpec(fullPrompt, input.parent?.spec);
  emit({ type: 'status', message: model ? `Model: ${prettyModelName(model.model)} (${model.model}) via ${model.baseUrl}. Every design decision below is the model's; test results are the simulator's.` : 'Deterministic planner (no MODEL_API_KEY configured). It can only build the legged-walker example; decisions are fixed rules, not a model.' });
  emit({ type: 'spec', spec });

  const versions: VersionRecord[] = [];
  let iteration = input.startIteration ?? 0;
  let pending: { assembly: Assembly; decision: Decision; log: ToolLogEntry[] } | null = null;
  let currentLog: ToolLogEntry[] = [];
  let parentId: string | null = input.parent?.id ?? null;
  const rt = new ToolRuntime(spec, {
    onLog: (entry) => { currentLog.push(entry); emit({ type: 'tool', entry }); },
    onPlan: (s) => { spec = s; emit({ type: 'spec', spec: s }); },
    onAssembly: (assembly, rationale, basedOn) => {
      const testedThisIteration = versions.length > 0 && versions[versions.length - 1].iteration === iteration;
      if (!pending || testedThisIteration) {
        // First build, or the first change after a test: a new iteration begins and its decision is this rationale.
        iteration = Math.max(iteration + (pending ? 1 : 0), (input.startIteration ?? 0) + 1);
        // A revision that follows a failed test is, by construction, based on that measurement; record it if the model did not.
        const lastTest = rt.tests[rt.tests.length - 1];
        const cited = basedOn ?? (lastTest && !lastTest.passed ? `${lastTest.testId}: ${lastTest.failureReasons[0] ?? 'did not pass'}` : undefined);
        pending = { assembly, decision: { source: model ? 'model' : 'planner', modelId: activeModelId, summary: rationale, basedOn: cited, changes: {} }, log: currentLog };
        currentLog = [];
        emit({ type: 'status', message: iteration === (input.startIteration ?? 0) + 1 ? 'Assembling components' : `Revising design (iteration ${iteration})` });
      } else {
        // Further edits before the next test refine the same iteration; keep the first rationale, but adopt a cited measurement.
        pending.assembly = assembly; pending.log = [...pending.log, ...currentLog]; currentLog = [];
        if (basedOn && !pending.decision.basedOn) pending.decision.basedOn = basedOn;
      }
      emit({ type: 'assembly', iteration, assembly, rationale });
    },
    onTest: (result) => {
      emit({ type: 'status', message: `Testing: ${result.testId}` });
      emit({ type: 'test', iteration, result });
      if (!pending) return;
      const existing = versions.length && versions[versions.length - 1].iteration === iteration ? versions[versions.length - 1] : null;
      if (existing) { existing.tests = [...existing.tests, result]; existing.assembly = rt.assembly; existing.spec = spec; existing.toolLog = [...existing.toolLog, ...currentLog]; existing.status = existing.tests.every((t) => t.passed) ? 'passed' : 'failed'; currentLog = []; emit({ type: 'version', version: existing }); return; }
      const v: VersionRecord = { id: input.newVersionId(), inventionId: input.inventionId, parentVersionId: parentId, iteration, prompt: fullPrompt, spec, assembly: rt.assembly, tests: [result], decisions: [pending.decision], toolLog: [...pending.log, ...currentLog], modelId: pending.decision.modelId ?? modelId, status: result.passed ? 'passed' : 'failed', createdAt: new Date().toISOString() };
      currentLog = []; versions.push(v); parentId = v.id; emit({ type: 'version', version: v });
    },
  }, { maxTests: maxIterations + 2, maxToolCalls: 24 + maxIterations * 8 });

  try {
    if (model) await runModelLoop(model, specialist, rt, input, emit, maxIterations, (id) => { activeModelId = id; });
    else await runPlanner(rt, spec, { parent: input.parent ?? null, changeRequest: input.changeRequest, maxIterations });
  } catch (e) {
    const message = (e as Error).message; emit({ type: 'error', message });
    return { versions, status: 'error', summary: message, modelId, spec: rt.spec };
  }
  const anyTest = rt.tests.length > 0;
  const lastPassed = anyTest && [...rt.tests].slice(-3).some((t) => t.passed) && rt.tests[rt.tests.length - 1].passed;
  const status: 'passed' | 'failed' = rt.finalized ? rt.finalized.status : lastPassed ? 'passed' : 'failed';
  const summary = rt.finalized?.summary ?? (status === 'passed' ? 'Design passed its tests.' : 'Prototype did not pass its tests. The design is inspectable; try a change request.');
  // Keep the spec's unverified list in sync with the final statement.
  if (versions.length) versions[versions.length - 1].spec = rt.spec;
  emit({ type: 'done', status, summary, modelId });
  return { versions, status, summary, modelId, spec: rt.spec };
}

/** The assemble/set_drives op lists that produced the parent's final assembly (from its tool log). */
function parentOps(parent: VersionRecord): unknown[] {
  const ops: unknown[] = [];
  for (const e of parent.toolLog) if (e.ok && e.tool === 'assemble') { const a = e.args as { ops?: unknown[] }; if (a?.ops) ops.push(...a.ops); }
  return ops;
}

function systemPrompt(parent?: VersionRecord | null): string {
  return `You are the ProtoLab engineering agent: an autonomous mechanical designer. The user describes an invention; you turn it into a working, recognisable, interactive mechanical prototype using real components, structured assembly operations and a rigid-body physics simulator. You act only through tools. Every decision is yours and must come from catalog data or measured test results; never claim a result you did not measure.

Procedure (follow it, briefly narrating each step in one sentence for the user):
1. Understand the invention and its purpose. 2. Identify its recognisable physical features and required motions. 3. Break it into sub-assemblies and components → write_plan (include honest "unverified" items such as aerodynamic lift, fluid flow, or anything this simulator cannot measure).
4. search_catalog for each sub-assembly (use categories; read connector ids/axes from results). 5. create_part (parametric) or design_part (primitives/extrusions/revolves) for anything missing — custom chassis sizes, wings, shells, curved silhouettes, brackets. 6. assemble with "mount" ops so parts connect at real connectors (axis = parent connector axis; spin_deg orients the child; use pattern for mirrored or polar repeats), set_drives for every motorised joint. 7. define_test with measurable criteria (motion: amplitudes/revolutions/clearances/base tilt; walk: distance & tilt; launch: landing distance; grip: payload retention). 8. run_test. 9. Read failure reasons and metrics; sweep_drive to measure before changing; revise with assemble (move/remove/mount) or set_drives, then re-test. 10. finalize_design with an honest summary and the unverified behaviours.

Rules of thumb:
- Make it look like the thing: use the recognisable silhouette (butterfly = body + 2 or 4 large shaped wings; Ferris wheel = tower + spoked wheel + hanging gondolas; crab = wide body + 6–8 legs; catapult = base + pivot arm + tray + counterweight/spring; windmill = tower + rotor blades; crane = base + boom + winch/line stand-in; drawbridge = deck on a hinge + tower + actuator). Choose colours (create_part color) and shells for appeal, but every motion must come from real joints and drives.
- Coordinates: metres, +Y up, ground at y = 0. Place one anchored base for fixed machines (anchored:true) or a chassis for free-standing machines (feet/wheels must touch y = 0). A walker needs legs mounted so feet sit under the hips and a gait profile (swing on hips, lift on knees, swingDuty ≤ 0.25 for a crawl with 4 legs, 0.5 tripod with 6).
- Mount semantics: {op:"mount", id, part, onto, connector, via, joint}: the child's "via" connector is placed on the parent's "connector", facing it; revolute joints turn about that axis; spin_deg rotates the child about the axis before any motion; offset_m adds clearance. Joint coordinates are 0 at the assembled pose.
- Motors: servos (position drives, rad) for oscillation and holding; gearmotors (velocity drives, rad/s) for continuous rotation; linear actuators / pistons (position drives, m). Keep demand under the rating (metrics report it; saturation is applied physically). A test fails on torque only when a motor sits at its rating ≥ 3 % of the run or demand exceeds 1.5× rating; brief peaks a few percent over are tolerated and noted.
- Tests must be meaningful for the invention: a wheel must turn N revolutions without gondolas hitting the tower (clearancePairs), a wing must reach its stroke amplitude and rate with the body stable, a catapult must land the projectile near the target, a gripper must hold its payload after the support is removed, a walker must travel the distance upright.
- Honesty: if a requested behaviour cannot be verified (flight, lift, airflow, water), build the closest honest mechanical prototype, verify what can be measured (stroke, rate, clearance, torque), and list the rest under "unverified". Never pretend.
- Be economical: search results already include connector ids/axes, so avoid get_part lookups unless you need geometry; one well-formed assemble call with all ops beats many small ones; fix errors by resending the corrected batch. Keep component count under 80 and total mass under the budget.
- Set realistic criteria for the size: a tabletop walker covers 0.2–0.6 m in 6 s; a wing flaps 0.5–1.2 rad at 1–4 Hz; a Ferris wheel turns 0.5–2 rad/s; a catapult throws 0.3–1 m. Do not demand what a 200 mm machine cannot do.

Worked recipes (adapt, do not copy blindly):
• 2-DOF leg on a chassis side connector hip_L0 (axis +Z): mount hip servo {onto:"body",connector:"hip_L0",via:"mount",joint:"fixed"}; upper leg {onto:"hip_servo_L0",connector:"horn",via:"pivot",joint:"revolute",spin_deg:17,motor:{controlId:"hip_L0",stiffness:5,damping:0.2}}; knee servo {onto:"upper_leg_L0",connector:"tip_side",via:"mount",joint:"fixed"}; lower leg {onto:"knee_servo_L0",connector:"horn",via:"pivot",joint:"revolute",spin_deg:-12,motor:{controlId:"knee_L0",...}}; foot {onto:"lower_leg_L0",connector:"tip",via:"mount",joint:"fixed"}. Right-side legs use the hip_R* connectors (axis −Z) and the opposite sign of spin and drive amplitudes. Place the chassis so feet touch y = 0 (inspect_assembly reports lowestPoint_m; one move of the root instance by its negative carries everything mounted on it). Gait drives: hips {kind:"gait",role:"swing",amplitude:±0.4,frequency_hz:1,phase,swingDuty:0.2}, knees {kind:"gait",role:"lift",amplitude:∓0.3,...}; crawl phases 0, π/2, π, 3π/2 in the order left-front, left-rear, right-front, right-rear. Measured in this simulator: chassis-quad-160 + leg-bar-60 upper and lower + foot-pad-12 + servo-ds3218 (2 N·m) at stiffness 5 / damping 0.2 walks ≈ 0.4 m in 6 s with < 6° tilt; 1.1 N·m servos saturate under this load; 80 mm legs raise the centre of mass and tip; frequencies above ~1.3 Hz or amplitudes above ~0.45 rad slip. If a test reports negative distance, only the hip drive signs are reversed.
• Six legs (hexapod / crab / insect): chassis-hex-200 has hip_L0..L2 / hip_R0..R2; build each leg exactly as above (one assemble batch of ≈ 31 ops, or build one side and pattern-mirror it). Measured in this simulator: chassis-hex-200 + servo-ds3218 hips and knees + leg-bar-60 upper and lower + foot-pad-12, wave gait (crawl phases 0, π/3, 2π/3 … in the order L0, L1, L2, R0, R1, R2), hips {kind:"gait",role:"swing",amplitude:±0.4,frequency_hz:1,swingDuty:0.3}, knees {role:"lift",amplitude:∓0.3} walks 0.32 m in 6 s with 5° tilt; swingDuty 0.2 gives 0.25 m; amplitude 0.5 or 1.3 Hz slips and tips; a 600 g designed carapace on 1.1 N·m servos falls over — keep the body under ≈ 250 g or use 2 N·m servos. A crab that "scuttles sideways" is this hexapod with the body placed across the walk direction (rotate the chassis 90° about Y and test walk with direction "z", or keep +X and say so).
• Dance in place (legged machine, after walking passes): all knees bob together with a sine on the lift sign ({kind:"sine", amplitude:∓0.15, offset:∓0.15, frequency_hz:3.2}) while each hip adds half that bob so the foot stays under the hip plus a small alternating sway ({kind:"sine", amplitude:±0.1, offset:±0.075, frequency_hz:1.6, phase: 0 or π per leg}); measured: this keeps base drift under 3 cm and tilt under 2°. Large hip sway with all feet planted just drags the body along.
• Flapping wings (butterfly / bird / dragonfly): body-butterfly-80 (or create_part insect_body: length, radius, wingPairs, torque) has built-in flap hinges wing_L0 (+Z side, axis −X) and wing_R0 (−Z side, axis +X). Mount the LEFT wing (catalog wing-butterfly-200-left or create_part wing with side:1) {onto:"body",connector:"wing_L0",via:"hinge",joint:"revolute",spin_deg:0,motor:{controlId:"flapL",stiffness:0.5,damping:0.05}} and the RIGHT wing (wing-butterfly-200, side:0) the same way on wing_R0 with controlId flapR. Give both the same drive {kind:"sine",amplitude:0.7,frequency_hz:2,phase:0} and both wings rise together. Measured: 200 mm film wings on a 0.3 N·m body flap ≈1.1 rad at 2 Hz with stiffness 0.3–1 / damping 0.03–0.05 and < 0.2 N·m demand; stiffness ≥ 2 saturates the 0.3 N·m rating (demand 1 N·m). Put the body on an anchored perch (rod or plate) via "perch" so only the wings move; test motion with minJointAmplitude_rad 0.5, clearancePairs wingL↔wingR and torqueWithinRating. If you design your own body, its wing connectors must run along the body axis (left −X, right +X), not sideways — a sideways (±Z) hinge makes the wing twist about its span instead of flapping.
• Wheel on a tower: place tower anchored at the origin; mount the spoked wheel {onto:"tower",connector:"axle",via:"hub",joint:"revolute",motor:{controlId:"spin",stiffness:0.5,damping:0.2}}; gondolas {onto:"wheel",connector:"rim_0",via:"hanger",joint:"revolute"} then {op:"pattern",instances:["cab"],kind:"polar",axis:"z",center:[0,<axle height>,0],count:8}; drive spin with {mode:"velocity", profile:{kind:"constant", value:1.5}, rampIn_s:1}; test motion with minRevolutions and clearancePairs gondola↔tower.
• Catapult: anchored base plate; servo on the plate; arm (leg_segment via pivot, spin_deg ≈ 195 so it stands up leaning back) with a tray on its tip; projectile placed free on the tray; drive {kind:"step", before:0, after:-1.4, at_s:0.5}; launch test on the projectile.
${parent ? `\nThis is a remix of an existing design. Rebuild it from its recorded operations, apply the change request, keep what worked.
Parent parts: ${JSON.stringify(parent.assembly.parts.map((p) => p.id))}
Parent assembly ops (last successful build, in order): ${JSON.stringify(parentOps(parent)).slice(0, 6000)}
Parent drives: ${JSON.stringify(parent.assembly.controller.drives).slice(0, 2000)}
Parent tests: ${JSON.stringify(parent.tests.map((t) => ({ id: t.testId, kind: t.kind, passed: t.passed, metrics: t.metrics })))}
Custom parts the parent created must be re-created with create_part/design_part before use (their definitions: ${JSON.stringify(parent.assembly.parts.filter((p) => p.kind === 'designed' || p.id.startsWith('custom-')).map((p) => ({ id: p.id, kind: p.kind, name: p.name, params: p.params, category: p.category, material: p.material, pieces: p.kind === 'designed' ? p.geometry.map((g) => ({ shape: g.shape, offset: g.offset, color: g.color, role: g.role })) : undefined, connectors: p.kind === 'designed' ? p.connectors : undefined }))).slice(0, 5000)}).` : ''}`;
}

async function runModelLoop(model: ModelConfig, specialist: { model: ModelConfig; after: number } | null, rt: ToolRuntime, input: AgentInput, emit: (e: AgentEvent) => void, maxIterations: number, setActive: (id: string) => void): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(input.parent) },
    { role: 'user', content: input.changeRequest ? `${input.prompt}\n\nChange request: ${input.changeRequest}` : input.prompt },
  ];
  const maxRounds = 24 + maxIterations * 6;
  let consults = 0, specialistRoundsLeft = 0, failsAtLastConsult = 0;
  const fails = () => { let n = 0; for (const t of [...rt.tests].reverse()) { if (t.passed) break; n++; } return n; };
  for (let round = 0; round < maxRounds && !rt.finalized; round++) {
    if (specialist && specialistRoundsLeft === 0 && consults < 2 && fails() >= specialist.after && fails() > failsAtLastConsult) {
      consults++; failsAtLastConsult = fails(); specialistRoundsLeft = 6;
      const msg = `This design needs a little more engineering. Bringing in ${prettyModelName(specialist.model.model)} to help.`;
      emit({ type: 'handoff', from: model.model, to: specialist.model.model, message: msg });
      messages.push({ role: 'user', content: `[Engineering specialist ${prettyModelName(specialist.model.model)} takes over for a few steps.] The last ${fails()} tests failed. Read the history: diagnose the mechanical cause (support polygon, torque vs mass, stride vs slip, clearance, joint axis orientation, drive sign), state it in one or two sentences, then act: sweep_drive if the drive space is unmeasured, redesign or move parts with assemble, change drives, and run_test once. Hand back after one test.` });
    }
    const driver = specialistRoundsLeft > 0 && specialist ? specialist.model : model;
    setActive(driver.model);
    const testsBefore = rt.tests.length;
    let res;
    try {
      res = await chat(driver, messages, TOOL_DEFS, { toolChoice: 'auto' });
    } catch (e) {
      // The specialist being unavailable (overloaded / 5xx / timeout) must not sink the build: hand back to the
      // primary Muse model and say so. Any other error, or a primary-model outage, is reported verbatim.
      if (specialistRoundsLeft > 0 && specialist && driver === specialist.model && e instanceof TransientModelError) {
        specialistRoundsLeft = 0;
        const reason = /503|overloaded/i.test(e.message) ? 'is overloaded right now (HTTP 503)' : 'did not respond';
        emit({ type: 'handoff', from: specialist.model.model, to: model.model, message: `${prettyModelName(specialist.model.model)} ${reason}; ${prettyModelName(model.model)} continues the engineering.` });
        messages.push({ role: 'user', content: `[${prettyModelName(specialist.model.model)} was unavailable: ${e.message.slice(0, 200)}] ${prettyModelName(model.model)} continues as the inventor: diagnose the last failed test yourself, change one thing (drive, geometry, or servo class), and run_test.` });
        continue;
      }
      throw e;
    }
    const content = res.content && res.content.trim() ? res.content : res.toolCalls.length ? null : '(no output)';
    messages.push(res.toolCalls.length ? { role: 'assistant', content, tool_calls: res.toolCalls } : { role: 'assistant', content: content ?? '(no output)' });
    if (res.content && res.content.trim()) emit({ type: 'status', message: `${driver === model ? '' : `${prettyModelName(driver.model)}: `}${res.content.trim().slice(0, 300)}` });
    if (!res.toolCalls.length) {
      if (res.finishReason === 'length') { emit({ type: 'status', message: 'The model ran out of output budget before acting; asking it to answer with the tool call only.' }); messages.push({ role: 'user', content: 'Your previous reply was cut off before any tool call. Reply with the tool call(s) only and minimal deliberation: send the complete assemble/set_drives/define_test batch now.' }); continue; }
      messages.push({ role: 'user', content: rt.tests.length ? 'Reply with a tool call: continue revising, or call finalize_design.' : 'Reply with a tool call, not text: write_plan, then search/create parts, then one assemble batch, set_drives, define_test, run_test.' }); continue;
    }
    for (const call of res.toolCalls) {
      let args: unknown = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = { error: 'invalid JSON arguments' }; }
      const result = await rt.call(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 5000) });
      if (rt.finalized) break;
    }
    if (specialistRoundsLeft > 0) {
      specialistRoundsLeft--;
      if (rt.tests.length > testsBefore || specialistRoundsLeft === 0) {
        specialistRoundsLeft = 0; const last = rt.tests[rt.tests.length - 1];
        emit({ type: 'handoff', from: specialist!.model.model, to: model.model, message: `${prettyModelName(model.model)} resumes${last ? ` after ${last.testId} (${last.passed ? 'passed' : 'did not pass'})` : ''}.` });
        messages.push({ role: 'user', content: `[${prettyModelName(model.model)} resumes as the inventor.] Continue from the specialist's result: if the test passed, finish remaining criteria and finalize; otherwise keep iterating.` });
      }
    }
  }
  setActive(model.model);
  if (!rt.finalized) {
    const ok = rt.tests.length > 0 && rt.tests[rt.tests.length - 1].passed;
    await rt.call('finalize_design', { summary: ok ? 'Round budget reached after a passing test.' : 'Round budget reached without a passing test; the last design is shown.', status: ok ? 'passed' : 'failed' });
  }
}

/** One model call: explain a finished version's engineering to a non-engineer, grounded in its recorded decisions and measurements. */
export async function explainDesign(version: VersionRecord, model: ModelConfig | null = modelConfigFromEnv()): Promise<{ text: string; modelId: string }> {
  if (!model) return { text: 'No model configured; explanations need MODEL_API_KEY.', modelId: DETERMINISTIC_MODEL_ID };
  const facts = {
    task: version.prompt, plan: version.spec.plan, parts: version.assembly.parts.map((p) => ({ id: p.id, name: p.name, source: p.source.kind, mass_g: Math.round(p.mass_kg * 1000) })),
    instances: version.assembly.instances.length, joints: version.assembly.joints.map((j) => ({ type: j.type, motor: j.motor?.controlId })).filter((j) => j.type !== 'fixed'),
    drives: version.assembly.controller.drives, decisions: version.decisions, tests: version.tests.map((t) => ({ id: t.testId, kind: t.kind, passed: t.passed, metrics: t.metrics, failureReasons: t.failureReasons, notes: t.notes })),
  };
  const res = await chat(model, [
    { role: 'system', content: 'You are the ProtoLab engineering agent explaining a prototype you built. Write for a curious non-engineer in under 180 words: what the mechanism is, how it moves (which joints and drives), what the simulator measured, what you changed and why, and what remains unverified by rigid-body physics. Only state facts present in the data; no invented numbers; plain language; no markdown headers.' },
    { role: 'user', content: JSON.stringify(facts).slice(0, 12000) },
  ], [], { temperature: 0.3 });
  return { text: (res.content ?? '').trim() || 'The model returned no explanation.', modelId: model.model };
}

import type { Assembly, Decision, Spec, TestResult, ToolLogEntry, VersionRecord } from '@protolab/schema';
import { chat, modelConfigFromEnv, specialistConfigFromEnv, smokeTest, prettyModelName, DEFAULT_MODEL, DEFAULT_BASE_URL, type ChatMessage, type ModelConfig } from './llm.ts';
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
        pending = { assembly, decision: { source: model ? 'model' : 'planner', modelId: activeModelId, summary: rationale, basedOn, changes: {} }, log: currentLog };
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

function systemPrompt(parent?: VersionRecord | null): string {
  return `You are the ProtoLab engineering agent: an autonomous mechanical designer. The user describes an invention; you turn it into a working, recognisable, interactive mechanical prototype using real components, structured assembly operations and a rigid-body physics simulator. You act only through tools. Every decision is yours and must come from catalog data or measured test results; never claim a result you did not measure.

Procedure (follow it, briefly narrating each step in one sentence for the user):
1. Understand the invention and its purpose. 2. Identify its recognisable physical features and required motions. 3. Break it into sub-assemblies and components → write_plan (include honest "unverified" items such as aerodynamic lift, fluid flow, or anything this simulator cannot measure).
4. search_catalog for each sub-assembly (use categories; read connector ids/axes from results). 5. create_part (parametric) or design_part (primitives/extrusions/revolves) for anything missing — custom chassis sizes, wings, shells, curved silhouettes, brackets. 6. assemble with "mount" ops so parts connect at real connectors (axis = parent connector axis; spin_deg orients the child; use pattern for mirrored or polar repeats), set_drives for every motorised joint. 7. define_test with measurable criteria (motion: amplitudes/revolutions/clearances/base tilt; walk: distance & tilt; launch: landing distance; grip: payload retention). 8. run_test. 9. Read failure reasons and metrics; sweep_drive to measure before changing; revise with assemble (move/remove/mount) or set_drives, then re-test. 10. finalize_design with an honest summary and the unverified behaviours.

Rules of thumb:
- Make it look like the thing: use the recognisable silhouette (butterfly = body + 2 or 4 large shaped wings; Ferris wheel = tower + spoked wheel + hanging gondolas; crab = wide body + 6–8 legs; catapult = base + pivot arm + tray + counterweight/spring; windmill = tower + rotor blades; crane = base + boom + winch/line stand-in; drawbridge = deck on a hinge + tower + actuator). Choose colours (create_part color) and shells for appeal, but every motion must come from real joints and drives.
- Coordinates: metres, +Y up, ground at y = 0. Place one anchored base for fixed machines (anchored:true) or a chassis for free-standing machines (feet/wheels must touch y = 0). A walker needs legs mounted so feet sit under the hips and a gait profile (swing on hips, lift on knees, swingDuty ≤ 0.25 for a crawl with 4 legs, 0.5 tripod with 6).
- Mount semantics: {op:"mount", id, part, onto, connector, via, joint}: the child's "via" connector is placed on the parent's "connector", facing it; revolute joints turn about that axis; spin_deg rotates the child about the axis before any motion; offset_m adds clearance. Joint coordinates are 0 at the assembled pose.
- Motors: servos (position drives, rad) for oscillation and holding; gearmotors (velocity drives, rad/s) for continuous rotation; linear actuators / pistons (position drives, m). Keep demand under the rating (metrics report it; saturation is applied physically).
- Tests must be meaningful for the invention: a wheel must turn N revolutions without gondolas hitting the tower (clearancePairs), a wing must reach its stroke amplitude and rate with the body stable, a catapult must land the projectile near the target, a gripper must hold its payload after the support is removed, a walker must travel the distance upright.
- Honesty: if a requested behaviour cannot be verified (flight, lift, airflow, water), build the closest honest mechanical prototype, verify what can be measured (stroke, rate, clearance, torque), and list the rest under "unverified". Never pretend.
- Be economical: one well-formed assemble call with all ops beats many small ones; fix errors by resending the corrected batch. Keep component count under 80 and total mass under the budget.
${parent ? `\nThis is a remix of an existing design. Its assembly summary: ${JSON.stringify({ family: parent.assembly.family, instances: parent.assembly.instances.length, parts: parent.assembly.parts.map((p) => p.id), drives: parent.assembly.controller.drives.length })}. Previous tests: ${JSON.stringify(parent.tests.map((t) => ({ id: t.testId, passed: t.passed, metrics: t.metrics })))}. Rebuild it with ops, apply the change request, keep what worked.` : ''}`;
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
    const res = await chat(driver, messages, TOOL_DEFS, { toolChoice: 'auto' });
    const content = res.content && res.content.trim() ? res.content : res.toolCalls.length ? null : '(no output)';
    messages.push(res.toolCalls.length ? { role: 'assistant', content, tool_calls: res.toolCalls } : { role: 'assistant', content: content ?? '(no output)' });
    if (res.content && res.content.trim()) emit({ type: 'status', message: `${driver === model ? '' : `${prettyModelName(driver.model)}: `}${res.content.trim().slice(0, 300)}` });
    if (!res.toolCalls.length) { messages.push({ role: 'user', content: rt.tests.length ? 'Continue with tools, or call finalize_design.' : 'Use the tools: write_plan, then search/create parts, assemble, set_drives, define_test, run_test.' }); continue; }
    for (const call of res.toolCalls) {
      let args: unknown = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = { error: 'invalid JSON arguments' }; }
      const result = await rt.call(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 7000) });
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

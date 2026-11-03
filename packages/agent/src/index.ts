import type { Assembly, Decision, Spec, TestResult, ToolLogEntry, VersionRecord } from '@protolab/schema';
import { type WalkerParams } from '@protolab/parts';
import { chat, modelConfigFromEnv, specialistConfigFromEnv, smokeTest, prettyModelName, DEFAULT_MODEL, DEFAULT_BASE_URL, type ChatMessage, type ModelConfig } from './llm.ts';
import { heuristicSpec } from './spec.ts';
import { ToolRuntime, TOOL_DEFS, WALKER_PARAM_RANGES, DEFAULT_WALKER } from './tools.ts';
import { runPlanner, applyChangeRequest } from './planner.ts';

export { modelConfigFromEnv, specialistConfigFromEnv, smokeTest, prettyModelName, DEFAULT_MODEL, DEFAULT_BASE_URL, heuristicSpec, ToolRuntime, TOOL_DEFS, applyChangeRequest };
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
  prompt: string;
  inventionId: string;
  parent?: VersionRecord | null;        // remix source
  changeRequest?: string;               // remix / follow-up request
  maxIterations?: number;
  startIteration?: number;              // continue numbering after existing versions (follow-ups)
  model?: ModelConfig | null;           // explicit; undefined = from env
  specialist?: { model: ModelConfig; after: number } | null; // undefined = from env
  newVersionId: () => string;
}

export interface AgentOutput { versions: VersionRecord[]; status: 'passed' | 'failed' | 'error'; summary: string; modelId: string; spec: Spec }

export const DETERMINISTIC_MODEL_ID = 'deterministic-planner';

export async function runAgent(input: AgentInput, emit: (e: AgentEvent) => void): Promise<AgentOutput> {
  const model = input.model === undefined ? modelConfigFromEnv() : input.model;
  const specialist = model ? (input.specialist === undefined ? specialistConfigFromEnv() : input.specialist) : null;
  const modelId = model ? model.model : DETERMINISTIC_MODEL_ID;
  let activeModelId = modelId; // which model is currently deciding (primary or specialist)
  const maxIterations = input.maxIterations ?? 7;
  const fullPrompt = input.changeRequest ? `${input.prompt}\n\nChange request: ${input.changeRequest}` : input.prompt;
  let spec = heuristicSpec(fullPrompt, input.parent?.spec);
  emit({ type: 'status', message: model ? `Model: ${prettyModelName(model.model)} (${model.model}) via ${model.baseUrl}. Every design decision below is the model's; test results are the simulator's.` : 'Deterministic planner (no MODEL_API_KEY configured). Decisions below are fixed rules, not a model.' });
  emit({ type: 'spec', spec });

  const versions: VersionRecord[] = [];
  let iteration = input.startIteration ?? 0;
  let pending: { assembly: Assembly; params: WalkerParams; decision: Decision; log: ToolLogEntry[] } | null = null;
  let currentLog: ToolLogEntry[] = [];
  let parentId: string | null = input.parent?.id ?? null;
  const rt = new ToolRuntime(spec, {
    onLog: (entry) => { currentLog.push(entry); emit({ type: 'tool', entry }); },
    onSpec: (s) => { spec = s; emit({ type: 'spec', spec: s }); },
    onAssembly: (assembly, params, rationale, basedOn, changes) => {
      iteration++;
      pending = { assembly, params, decision: { source: model ? 'model' : 'planner', modelId: activeModelId, summary: rationale, basedOn, changes: changes ?? {} }, log: currentLog };
      currentLog = [];
      emit({ type: 'status', message: iteration === (input.startIteration ?? 0) + 1 ? 'Assembling components' : `Revising design (iteration ${iteration})` });
      emit({ type: 'assembly', iteration, assembly, rationale });
    },
    onTest: (result) => {
      emit({ type: 'status', message: result.kind === 'walk' ? 'Testing walking' : 'Testing dance stability' });
      emit({ type: 'test', iteration, result });
      if (!pending) return;
      const existing = versions.length && versions[versions.length - 1].iteration === iteration ? versions[versions.length - 1] : null;
      if (existing) {
        existing.tests = [...existing.tests, result];
        existing.assembly = rt.assembly!;
        existing.toolLog = [...existing.toolLog, ...currentLog];
        existing.status = existing.tests.every((t) => t.passed) ? 'passed' : 'failed';
        currentLog = [];
        emit({ type: 'version', version: existing });
        return;
      }
      const v: VersionRecord = {
        id: input.newVersionId(), inventionId: input.inventionId, parentVersionId: parentId, iteration,
        prompt: fullPrompt, spec, assembly: pending.assembly, tests: [result],
        decisions: [pending.decision], toolLog: [...pending.log, ...currentLog], modelId: pending.decision.modelId ?? modelId,
        status: result.passed ? 'passed' : 'failed', createdAt: new Date().toISOString(),
      };
      currentLog = [];
      versions.push(v);
      parentId = v.id;
      emit({ type: 'version', version: v });
    },
  }, { maxTests: maxIterations + 2, maxToolCalls: 16 + maxIterations * 6 });

  try {
    if (model) await runModelLoop(model, specialist, rt, spec, input, emit, maxIterations, (id) => { activeModelId = id; });
    else await runPlanner(rt, spec, { startParams: input.parent ? (input.parent.assembly.familyConfig as unknown as WalkerParams) : undefined, changeRequest: input.changeRequest, maxIterations });
  } catch (e) {
    const message = (e as Error).message;
    emit({ type: 'error', message });
    return { versions, status: 'error', summary: message, modelId, spec };
  }

  const walkPassed = rt.tests.some((t) => t.kind === 'walk' && t.passed);
  const danceAsked = spec.followUps.includes('dance');
  const dancePassed = rt.tests.some((t) => t.kind === 'dance' && t.passed);
  const status: 'passed' | 'failed' = walkPassed && (!danceAsked || dancePassed) ? 'passed' : 'failed';
  const summary = rt.finalized?.summary ?? (status === 'passed' ? 'Design passed its tests.' : 'Prototype did not pass the test. The design is inspectable; try a change request.');
  emit({ type: 'done', status, summary, modelId });
  return { versions, status, summary, modelId, spec };
}

function systemPrompt(spec: Spec, parent?: VersionRecord | null): string {
  const ranges = Object.entries(WALKER_PARAM_RANGES).map(([k, r]) => `  ${k}: ${r.min}–${r.max} ${r.unit} (${r.description})`).join('\n');
  return `You are the ProtoLab engineering agent. You design a small legged walking robot from real catalog parts and test it in a rigid-body physics simulator. You can only act through the tools. Every design decision must be yours and based on catalog data or measured test results; never claim results you did not measure.

Workflow: (1) optionally write_spec, (2) search_catalog to pick a chassis (body_frame with legPairs = legs/2), hip and knee servos, upper/lower leg_segment bars and foot_pad; create_parametric_part if nothing fits, (3) build_walker with all part ids and parameters, (4) run_test "walk", (5) if it fails, read the failure reasons and metrics; use sweep_gait to measure a small grid of stride/cadence values on the current parts before changing parts (cheap, does not use the test budget), then revise_walker with a specific, explained change and test again (max ${spec.targets.duration_s}s tests, few iterations), (6) if the spec has a dance follow-up and walking passed, run_test "dance" and fix stability if needed, (7) finalize_design with an honest summary.

Engineering notes (measured in this simulator):
- Legs swing in the sagittal plane. hipOffset_rad ≈ kneeFlex_rad / 2 puts the feet under the hips; feet behind the hips make a crawl tip forward.
- A quadruped crawl needs swingDuty ≤ 0.25 so three feet stay down; hexapods use gaitType "tripod" with swingDuty 0.5.
- Stride per cycle ≈ 2 × hipAmplitude_rad × leg length. Target distance / duration sets the required stride × frequency.
- Measured: above ~1.3 Hz or ~0.45 rad the feet slip on this ground and distance drops; 0.9–1.2 Hz with 0.35–0.42 rad and 60 mm bars is the efficient band. Heavier servos add leg inertia and torque demand; prefer the lightest servo with ≥25 % margin.
- Torque demand is reported against the servo rating; pick a servo with ≥ 25 % margin.
- Stiffness 3–10 N·m/rad and damping 0.1–0.3 work for 0.2–0.4 kg robots.
- The catalog is small. When no preset fits (chassis length/width for your leg layout, a leg bar length between presets, a lighter or stronger servo), create_parametric_part and use its id in build_walker/revise_walker; custom parts count as real parts in the BOM.
- Think like an engineer: state what you measured and why the change should fix it; prefer one targeted change per iteration.

Walker parameter ranges:
${ranges}
Default example: ${JSON.stringify(DEFAULT_WALKER)}
${parent ? `\nThis is a remix of an existing design. Its parameters: ${JSON.stringify(parent.assembly.familyConfig)}. Previous test metrics: ${JSON.stringify(parent.tests.map((t) => ({ id: t.testId, passed: t.passed, metrics: t.metrics })))}. Apply the change request, keep what works.` : ''}

Current spec: ${JSON.stringify(spec)}
Be concise. Rationales are shown to the user; one or two plain sentences each.`;
}

async function runModelLoop(model: ModelConfig, specialist: { model: ModelConfig; after: number } | null, rt: ToolRuntime, spec: Spec, input: AgentInput, emit: (e: AgentEvent) => void, maxIterations: number, setActive: (id: string) => void): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(spec, input.parent) },
    { role: 'user', content: input.changeRequest ? `${input.prompt}\n\nChange request: ${input.changeRequest}` : input.prompt },
  ];
  const maxRounds = 16 + maxIterations * 5;
  let consults = 0;
  let specialistRoundsLeft = 0;      // > 0 while the specialist is driving
  let failsAtLastConsult = 0;
  const walkFails = () => { let n = 0; for (const t of [...rt.tests].reverse()) { if (t.kind !== 'walk') continue; if (t.passed) break; n++; } return n; };

  for (let round = 0; round < maxRounds && !rt.finalized; round++) {
    // Escalate to the engineering specialist after repeated walk failures.
    if (specialist && specialistRoundsLeft === 0 && consults < 2 && walkFails() >= specialist.after && walkFails() > failsAtLastConsult) {
      consults++; failsAtLastConsult = walkFails(); specialistRoundsLeft = 6;
      const msg = `This design needs a little more engineering. Bringing in ${prettyModelName(specialist.model.model)} to help.`;
      emit({ type: 'handoff', from: model.model, to: specialist.model.model, message: msg });
      messages.push({ role: 'user', content: `[Engineering specialist ${prettyModelName(specialist.model.model)} takes over for a few steps.] The last ${walkFails()} walk tests failed. Read the full history above: diagnose the mechanical reason it does not walk (support polygon, torque vs mass, stride vs slip, leg geometry), state the diagnosis in one or two sentences, then act: sweep_gait if the gait space is unmeasured, create_parametric_part if the catalog does not fit, revise_walker with one targeted change, and run_test "walk". Hand back after one test.` });
    }
    const driver = specialistRoundsLeft > 0 && specialist ? specialist.model : model;
    setActive(driver.model);
    const testsBefore = rt.tests.length;
    const res = await chat(driver, messages, TOOL_DEFS, { toolChoice: 'auto' });
    // The Meta Model API rejects an assistant message with neither content nor tool_calls; never append one.
    const content = res.content && res.content.trim() ? res.content : res.toolCalls.length ? null : '(no output)';
    messages.push(res.toolCalls.length ? { role: 'assistant', content, tool_calls: res.toolCalls } : { role: 'assistant', content: content ?? '(no output)' });
    if (res.content && res.content.trim()) emit({ type: 'status', message: `${driver === model ? '' : `${prettyModelName(driver.model)}: `}${res.content.trim().slice(0, 240)}` });
    if (!res.toolCalls.length) {
      if (rt.tests.length) { messages.push({ role: 'user', content: 'Call finalize_design to finish, or continue with tools.' }); continue; }
      messages.push({ role: 'user', content: 'Use the tools to build and test the design.' });
      continue;
    }
    for (const call of res.toolCalls) {
      let args: unknown = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = { error: 'invalid JSON arguments' }; }
      const result = await rt.call(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      if (rt.finalized) break;
    }
    if (specialistRoundsLeft > 0) {
      specialistRoundsLeft--;
      const ranTest = rt.tests.length > testsBefore;
      if (ranTest || specialistRoundsLeft === 0) {
        specialistRoundsLeft = 0;
        const last = rt.tests[rt.tests.length - 1];
        const back = `${prettyModelName(model.model)} resumes${last ? ` after ${last.testId} (${last.passed ? 'passed' : 'did not pass'})` : ''}.`;
        emit({ type: 'handoff', from: specialist!.model.model, to: model.model, message: back });
        messages.push({ role: 'user', content: `[${prettyModelName(model.model)} resumes as the inventor.] Continue from the specialist's result: if the walk passed, run the dance follow-up if the spec asks for it and finalize; otherwise keep iterating.` });
      }
    }
  }
  setActive(model.model);
  if (!rt.finalized) {
    const walkPassed = rt.tests.some((t) => t.kind === 'walk' && t.passed);
    await rt.call('finalize_design', { summary: walkPassed ? 'Model round budget reached after a passing walk test.' : 'Model round budget reached without a passing walk test; the last design is shown.', status: walkPassed ? 'passed' : 'failed' });
  }
}

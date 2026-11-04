/**
 * Chat client for the Meta Model API (https://api.meta.ai/v1, OpenAI-compatible chat completions
 * with tool calling). Serves Muse Spark / Muse Wonder. Any other OpenAI-compatible endpoint also works.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { attachResponseMetadata, buildResponsesBody, parseResponses } from './responses.ts';
export interface ModelConfig {
  baseUrl: string; model: string; apiKey: string; maxTokens: number; timeoutMs: number;
  transport?: 'responses-stored' | 'responses-encrypted';
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
export const DEFAULT_MODEL = 'muse-spark-1.3';

function responseTransport(value: string | undefined): ModelConfig['transport'] {
  return value === 'responses-stored' || value === 'responses-encrypted' ? value : undefined;
}

function responseEffort(value: string | undefined): ModelConfig['reasoningEffort'] {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const apiKey = (env.MODEL_API_KEY ?? env.LLM_API_KEY)?.trim();
  if (!apiKey) return null;
  const transport = responseTransport(env.MODEL_TRANSPORT);
  const reasoningEffort = responseEffort(env.MODEL_RESPONSES_REASONING_EFFORT);
  return {
    apiKey,
    ...(transport ? { transport } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    baseUrl: ((env.MODEL_API_BASE ?? env.LLM_BASE_URL)?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: (env.MODEL_ID ?? env.LLM_MODEL)?.trim() || DEFAULT_MODEL,
    maxTokens: Number(env.MODEL_MAX_TOKENS ?? 16384),
    timeoutMs: Number(env.MODEL_TIMEOUT_MS ?? 300_000),
  };
}

/** Optional engineering specialist (Muse Wonder) consulted after repeated failures. Empty MODEL_SPECIALIST_ID disables it. */
export function specialistConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { model: ModelConfig; after: number } | null {
  const primary = modelConfigFromEnv(env);
  if (!primary) return null;
  const id = env.MODEL_SPECIALIST_ID === undefined ? 'muse-wonder-1.0' : env.MODEL_SPECIALIST_ID.trim();
  if (!id || id === primary.model) return null;
  const transportOverride = env.MODEL_SPECIALIST_TRANSPORT?.trim();
  const transport = transportOverride ? responseTransport(transportOverride) : primary.transport;
  const reasoningEffort = responseEffort(env.MODEL_SPECIALIST_REASONING_EFFORT);
  return { model: { ...primary, model: id, transport, reasoningEffort }, after: Math.max(1, Number(env.MODEL_SPECIALIST_AFTER ?? 3)) };
}

/** Human-readable model name for attribution, e.g. "muse-spark-1.3" → "Muse Spark 1.3". */
export function prettyModelName(id: string): string {
  const m = id.match(/^muse-([a-z]+)-(\d+(?:\.\d+)?)(-contributor)?$/i);
  if (m) return `Muse ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? ' (contributor)' : ''}`;
  return id;
}

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatResult { content: string | null; toolCalls: ToolCall[]; finishReason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } }

export function assistantMessage(result: ChatResult): Extract<ChatMessage, { role: 'assistant' }> {
  const content = result.content?.trim() ? result.content : result.toolCalls.length ? null : '(no output)';
  const message = result.toolCalls.length
    ? { role: 'assistant' as const, content, tool_calls: result.toolCalls }
    : { role: 'assistant' as const, content: content ?? '(no output)' };
  attachResponseMetadata(result, message);
  return message;
}

/** A Meta Model API failure that is about availability (overloaded / 5xx / timeout), not about the request. */
export class TransientModelError extends Error {
  constructor(message: string) { super(message); this.name = 'TransientModelError'; }
}

function isLineageError(status: number, text: string) {
  if (status !== 400 && status !== 404) return false;
  const reference = /\b(?:previous[_ -]response[_ -]id|previous response (?:with )?id|referenced response)\b/i;
  try {
    const { error } = JSON.parse(text) as { error?: { param?: string; code?: string; message?: string } };
    return error?.param === 'previous_response_id' || error?.code === 'previous_response_not_found' ||
      (typeof error?.message === 'string' && reference.test(error.message));
  } catch {
    return reference.test(text);
  }
}

export async function chat(cfg: ModelConfig, messages: ChatMessage[], tools: ToolDef[], opts: { toolChoice?: 'auto' | 'required' | { name: string }; temperature?: number; signal?: AbortSignal; onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void } = {}): Promise<ChatResult> {
  const responses = cfg.transport === 'responses-stored' || cfg.transport === 'responses-encrypted';
  let body: Record<string, unknown> = responses ? buildResponsesBody(cfg, messages, tools, opts) : {
    model: cfg.model,
    messages,
    max_tokens: cfg.maxTokens, // reasoning tokens count against this budget
    temperature: opts.temperature ?? 0.2,
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
  // The Meta Model API accepts only tool_choice "auto" (no "required" / named choices); omit anything else.
  if (!responses && opts.toolChoice === 'auto') body.tool_choice = 'auto';
  // Retry transient failures (network errors, 429, 5xx) with backoff; surface everything else verbatim.
  let res: Response | null = null; let lastErr = ''; let tries = 0;
  const started = Date.now(); const approxChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (process.env.MODEL_DEBUG) console.error(`[llm] → ${cfg.model}: ${messages.length} msgs, ~${Math.round(approxChars / 4)} tokens`);
  const MAX_ATTEMPTS = 6; const DELAYS_MS = [1500, 3000, 6000, 12000, 20000, 30000];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    opts.signal?.throwIfAborted();
    tries = attempt + 1;
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(cfg.timeoutMs)]) : AbortSignal.timeout(cfg.timeoutMs);
      const endpoint = responses ? 'responses' : 'chat/completions';
      const send = (request: Record<string, unknown>) => fetch(`${cfg.baseUrl}/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(request), signal,
      });
      let response = await send(body);
      if (response.ok) { res = response; break; }
      let text = await response.text().catch(() => '');
      if (body.previous_response_id && isLineageError(response.status, text)) {
        // A saved context can expire. Resume from the visible transcript on an explicit lineage error.
        body = buildResponsesBody(cfg, messages, tools, opts, false);
        response = await send(body);
        if (response.ok) { res = response; break; }
        text = await response.text().catch(() => '');
      }
      lastErr = `Meta Model API error from ${cfg.model}: HTTP ${response.status} ${text.slice(0, 400)}`;
      if (response.status !== 429 && response.status < 500) throw new Error(lastErr);
      if (process.env.MODEL_DEBUG) console.error(`[llm] ${lastErr.slice(0, 140)}; retrying (${attempt + 1}/${MAX_ATTEMPTS})`);
    } catch (e) {
      opts.signal?.throwIfAborted();
      if ((e as Error).message.startsWith('Meta Model API error')) throw e;
      lastErr = `Meta Model API request failed (${cfg.model}): ${(e as Error).name === 'TimeoutError' ? `no response within ${cfg.timeoutMs / 1000} s` : (e as Error).message}`;
      if ((e as Error).name === 'TimeoutError' && attempt >= 1) break; // one retry for timeouts, not four
    }
    const delayMs = DELAYS_MS[attempt] ?? 30000;
    if (attempt + 1 === MAX_ATTEMPTS) break;
    opts.onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, delayMs, reason: lastErr });
    await delay(delayMs, undefined, { signal: opts.signal });
  }
  if (!res) throw new TransientModelError(`${lastErr} (after ${tries} attempt${tries === 1 ? '' : 's'})`);
  if (process.env.MODEL_DEBUG) console.error(`[llm] ← ${cfg.model} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (responses) return parseResponses(cfg, await res.json());
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>; usage?: ChatResult['usage'] };
  const choice = json.choices?.[0]; const msg = choice?.message;
  if (!msg) throw new Error('Model returned no choices');
  if (process.env.MODEL_DEBUG) console.error(`[llm]   finish=${choice?.finish_reason} tools=${msg.tool_calls?.length ?? 0} reasoning_tokens=${json.usage?.completion_tokens_details?.reasoning_tokens ?? '?'} completion=${json.usage?.completion_tokens ?? '?'}`);
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [], finishReason: choice?.finish_reason, usage: json.usage };
}

/** One live tool-call round trip to confirm the model id, endpoint and tool-calling support. */
export async function smokeTest(cfg: ModelConfig): Promise<{ ok: boolean; model: string; detail: string }> {
  try {
    const r = await chat(cfg, [{ role: 'system', content: 'You must call the ping tool; do not answer in text.' }, { role: 'user', content: 'Call the ping tool with value 7.' }],
      [{ name: 'ping', description: 'Echo a number', parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } }], { toolChoice: 'auto' });
    const ok = r.toolCalls.some((c) => c.function.name === 'ping');
    return { ok, model: cfg.model, detail: ok ? 'tool call returned' : `no tool call; content=${r.content?.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, model: cfg.model, detail: (e as Error).message };
  }
}

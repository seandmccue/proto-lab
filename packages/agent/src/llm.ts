/**
 * Chat client for the Meta Model API (https://api.meta.ai/v1, OpenAI-compatible chat completions
 * with tool calling). Serves Muse Spark / Muse Wonder. Any other OpenAI-compatible endpoint also works.
 */
export interface ModelConfig { baseUrl: string; model: string; apiKey: string; maxTokens: number }

export const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
export const DEFAULT_MODEL = 'muse-spark-1.3';

export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const apiKey = (env.MODEL_API_KEY ?? env.LLM_API_KEY)?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: ((env.MODEL_API_BASE ?? env.LLM_BASE_URL)?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: (env.MODEL_ID ?? env.LLM_MODEL)?.trim() || DEFAULT_MODEL,
    maxTokens: Number(env.MODEL_MAX_TOKENS ?? 4096),
  };
}

/** Optional engineering specialist (Muse Wonder) consulted after repeated failures. Empty MODEL_SPECIALIST_ID disables it. */
export function specialistConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { model: ModelConfig; after: number } | null {
  const primary = modelConfigFromEnv(env);
  if (!primary) return null;
  const id = env.MODEL_SPECIALIST_ID === undefined ? 'muse-wonder-1.0' : env.MODEL_SPECIALIST_ID.trim();
  if (!id || id === primary.model) return null;
  return { model: { ...primary, model: id }, after: Math.max(1, Number(env.MODEL_SPECIALIST_AFTER ?? 3)) };
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
export interface ChatResult { content: string | null; toolCalls: ToolCall[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }

export async function chat(cfg: ModelConfig, messages: ChatMessage[], tools: ToolDef[], opts: { toolChoice?: 'auto' | 'required' | { name: string }; temperature?: number; signal?: AbortSignal } = {}): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: cfg.maxTokens, // reasoning tokens count against this budget
    temperature: opts.temperature ?? 0.2,
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
  // The Meta Model API accepts only tool_choice "auto" (no "required" / named choices); omit anything else.
  if (opts.toolChoice === 'auto') body.tool_choice = 'auto';
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Meta Model API error from ${cfg.model}: HTTP ${res.status} ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>; usage?: ChatResult['usage'] };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('Model returned no choices');
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [], usage: json.usage };
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

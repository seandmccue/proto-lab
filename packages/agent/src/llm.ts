/** Minimal OpenAI-compatible chat client (works with Meta's Llama API compat endpoint). */
export interface ModelConfig { baseUrl: string; model: string; apiKey: string }

export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || 'https://api.llama.com/compat/v1').replace(/\/$/, ''),
    model: env.LLM_MODEL?.trim() || 'Llama-4-Maverick-17B-128E-Instruct-FP8',
  };
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
    temperature: opts.temperature ?? 0.2,
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
  if (opts.toolChoice) body.tool_choice = typeof opts.toolChoice === 'string' ? opts.toolChoice : { type: 'function', function: { name: opts.toolChoice.name } };
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Model request failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>; usage?: ChatResult['usage'] };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('Model returned no choices');
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [], usage: json.usage };
}

/** One live tool-call round trip to confirm the model id, endpoint and tool-calling support. */
export async function smokeTest(cfg: ModelConfig): Promise<{ ok: boolean; model: string; detail: string }> {
  try {
    const r = await chat(cfg, [{ role: 'user', content: 'Call the ping tool with value 7.' }],
      [{ name: 'ping', description: 'Echo a number', parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } }], { toolChoice: 'required' });
    const ok = r.toolCalls.some((c) => c.function.name === 'ping');
    return { ok, model: cfg.model, detail: ok ? 'tool call returned' : `no tool call; content=${r.content?.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, model: cfg.model, detail: (e as Error).message };
  }
}

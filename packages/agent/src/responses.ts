import { createHash } from 'node:crypto';
import type { ChatMessage, ChatResult, ModelConfig, ToolCall, ToolDef } from './llm.ts';

type InputItem = Record<string, unknown>;
type Assistant = Extract<ChatMessage, { role: 'assistant' }>;
type ResponseMetadata = { modelKey: string; id: string; output: InputItem[] };

// Keep reasoning in the current worker and out of the serialized transcript and logs.
const resultMetadata = new WeakMap<ChatResult, ResponseMetadata>();
const messageMetadata = new WeakMap<Assistant, ResponseMetadata>();
const keyFor = (cfg: ModelConfig) => createHash('sha256')
  .update(JSON.stringify([cfg.baseUrl, cfg.model, cfg.transport, cfg.apiKey])).digest('hex');

export function attachResponseMetadata(result: ChatResult, message: Assistant) {
  const metadata = resultMetadata.get(result);
  if (metadata) messageMetadata.set(message, metadata);
}

function visibleItems(message: ChatMessage): InputItem[] {
  if (message.role === 'tool') {
    return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
  }
  if (message.role === 'assistant') {
    const calls = message.tool_calls ?? [];
    const items: InputItem[] = message.content ? [{
      role: 'assistant', content: [{ type: 'output_text', text: message.content }],
      ...(calls.length ? { phase: 'commentary' } : {}),
    }] : [];
    for (const call of calls) {
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return items;
  }
  return [{ role: message.role === 'system' ? 'developer' : 'user', content: [{ type: 'input_text', text: message.content }] }];
}

export function buildResponsesBody(
  cfg: ModelConfig, messages: ChatMessage[], tools: ToolDef[],
  opts: { temperature?: number; toolChoice?: 'auto' | 'required' | { name: string } },
  usePreviousId = true,
): Record<string, unknown> {
  const modelKey = keyFor(cfg);
  const store = cfg.transport === 'responses-stored';
  let continuationStart = messages.length;
  let previousResponseId: string | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const metadata = messageMetadata.get(message);
    // Rebuild visible history at a model handoff. A provider does not promise that
    // private reasoning or saved response IDs transfer between different models.
    if (metadata?.modelKey !== modelKey) break;
    if (store) {
      if (usePreviousId) previousResponseId = metadata.id;
      continuationStart = index + 1;
      break;
    }
    continuationStart = index;
  }
  const input = previousResponseId
    ? messages.slice(continuationStart).flatMap(visibleItems)
    : messages.flatMap((message, index) => {
      if (!store && index >= continuationStart && message.role === 'assistant') {
        const metadata = messageMetadata.get(message);
        if (metadata) return metadata.output;
      }
      return visibleItems(message);
    });
  return {
    model: cfg.model, input, store, max_output_tokens: cfg.maxTokens,
    ...(cfg.reasoningEffort ? { reasoning: { effort: cfg.reasoningEffort } } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(tools.length ? {
      tools: tools.map(({ name, description, parameters }) => ({ type: 'function', name, description, parameters })),
      ...(opts.toolChoice === 'auto' ? { tool_choice: 'auto' } : {}),
    } : {}),
    ...(store ? {} : { include: ['reasoning.encrypted_content'] }),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };
}

type ResponsesOutput = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  error?: { message?: string };
  output?: InputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
};

export function parseResponses(cfg: ModelConfig, json: ResponsesOutput): ChatResult {
  if (json.status === 'failed') throw new Error(json.error?.message ?? 'Meta Responses generation failed');
  if (!Array.isArray(json.output)) throw new Error('Model returned no response output');
  const toolCalls: ToolCall[] = [];
  const text: string[] = [];
  for (const item of json.output) {
    if (item.type === 'function_call' && (item.status === 'completed' || item.status === undefined) &&
      typeof item.call_id === 'string' && typeof item.name === 'string' && typeof item.arguments === 'string') {
      toolCalls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
    }
    if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === 'output_text' && typeof block.text === 'string') text.push(block.text);
        if (block.type === 'refusal' && typeof block.refusal === 'string') text.push(block.refusal);
      }
    }
  }
  const result: ChatResult = {
    content: text.join('\n') || null, toolCalls,
    finishReason: json.status === 'incomplete' && json.incomplete_details?.reason === 'max_output_tokens'
      ? 'length' : toolCalls.length ? 'tool_calls' : json.status === 'completed' ? 'stop' : json.incomplete_details?.reason,
    usage: json.usage && {
      prompt_tokens: json.usage.input_tokens, completion_tokens: json.usage.output_tokens,
      completion_tokens_details: json.usage.output_tokens_details,
    },
  };
  if (json.status === 'completed' && typeof json.id === 'string') {
    const output = json.output.filter((item) => item.type === 'message' || item.type === 'function_call' ||
      (item.type === 'reasoning' && typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0));
    resultMetadata.set(result, { modelKey: keyFor(cfg), id: json.id, output });
  }
  return result;
}

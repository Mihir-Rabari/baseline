/**
 * Minimal LLM boundary for the Baseline agent.
 *
 * `LlmClient` is the only thing the agent loop knows about the model, so tests can inject a
 * scripted fake. The Anthropic implementation uses plain `fetch` (no SDK dependency).
 *
 * Secrets: the API key lives only inside the client and is sent solely as the `x-api-key`
 * header. Neither the key nor prompt/response bodies are ever logged or placed in errors.
 */

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentBlock[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmResponse {
  /** Concatenated text blocks (may be empty when the model only called tools). */
  text: string;
  toolUses: LlmToolUse[];
}

export interface LlmClient {
  /** False when no API key is configured: the agent then reports itself disabled. */
  readonly enabled: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** A failure talking to the model. The message is safe to log; it never carries bodies or keys. */
export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export class DisabledLlmClient implements LlmClient {
  readonly enabled = false;
  async complete(): Promise<LlmResponse> {
    throw new LlmError('The agent is not configured');
  }
}

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
}

export class AnthropicLlmClient implements LlmClient {
  readonly enabled = true;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 1024;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.url = `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: request.system,
          messages: request.messages,
          ...(request.tools.length > 0 ? { tools: request.tools } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new LlmError(timedOut ? 'LLM request timed out' : 'LLM request failed');
    }

    if (!response.ok) {
      throw new LlmError(`LLM provider returned HTTP ${response.status}`, response.status);
    }

    let body: AnthropicResponseBody;
    try {
      body = (await response.json()) as AnthropicResponseBody;
    } catch {
      throw new LlmError('LLM provider returned an unreadable response');
    }

    const blocks = Array.isArray(body.content) ? body.content : [];
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    const toolUses: LlmToolUse[] = blocks
      .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({
        id: b.id as string,
        name: b.name as string,
        input: b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
      }));
    return { text, toolUses };
  }
}

export interface GroqClientOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GroqToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface GroqResponseBody {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqToolCall[] } }>;
}

/** Groq REST client (OpenAI-compatible chat completions). Translates the Anthropic-shaped agent messages. */
export class GroqLlmClient implements LlmClient {
  readonly enabled = true;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.url = `${options.baseUrl ?? 'https://api.groq.com/openai'}/v1/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private toMessages(system: string, messages: LlmMessage[]) {
    const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
        const toolCalls = m.content
          .filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
          .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
        out.push({ role: 'assistant', content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
        continue;
      }
      // User turn: tool results become `tool` messages, any text stays a user message.
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
    return out;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          messages: this.toMessages(request.system, request.messages),
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.input_schema },
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new LlmError(timedOut ? 'LLM request timed out' : 'LLM request failed');
    }
    if (!response.ok) throw new LlmError(`LLM provider returned HTTP ${response.status}`, response.status);

    let body: GroqResponseBody;
    try {
      body = (await response.json()) as GroqResponseBody;
    } catch {
      throw new LlmError('LLM provider returned an unreadable response');
    }
    const message = body.choices?.[0]?.message;
    const text = typeof message?.content === 'string' ? message.content.trim() : '';
    const stamp = Date.now().toString(36);
    const toolUses: LlmToolUse[] = (message?.tool_calls ?? [])
      .filter((c) => typeof c.function?.name === 'string')
      .map((c, idx) => {
        let input: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(c.function?.arguments || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
        } catch {
          // Malformed arguments: run the tool with no input and let its schema reject it.
        }
        return { id: c.id ?? `groq_${stamp}_${idx}`, name: c.function!.name!, input };
      });
    return { text, toolUses };
  }
}

export function createLlmClient(env: {
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  AGENT_MODEL: string;
  GROQ_MODEL?: string;
}): LlmClient {
  if (env.ANTHROPIC_API_KEY) return new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.AGENT_MODEL });
  if (env.GROQ_API_KEY) return new GroqLlmClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL ?? 'openai/gpt-oss-120b' });
  return new DisabledLlmClient();
}

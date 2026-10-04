import { describe, expect, it } from 'vitest';
import { createLlmClient, GroqLlmClient, LlmError } from '../../../apps/api/src/services/agent/llm.js';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('GroqLlmClient', () => {
  it('sends an OpenAI-shaped request and parses text + tool calls', async () => {
    const { impl, calls } = fakeFetch({
      choices: [{ message: { content: 'ok', tool_calls: [{ id: 'c1', function: { name: 'list_courts', arguments: '{"q":"a"}' } }] } }],
    });
    const client = new GroqLlmClient({ apiKey: 'test-key', model: 'm', fetchImpl: impl });
    const res = await client.complete({
      system: 'sys',
      tools: [{ name: 'list_courts', description: 'd', input_schema: { type: 'object', properties: {} } }],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c0', name: 'list_courts', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c0', content: '[]' }] },
      ],
    });
    expect(res).toEqual({ text: 'ok', toolUses: [{ id: 'c1', name: 'list_courts', input: { q: 'a' } }] });
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(sent.messages[3]).toMatchObject({ tool_call_id: 'c0', content: '[]' });
  });

  it('tolerates malformed tool arguments', async () => {
    const { impl } = fakeFetch({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 't', arguments: '{bad' } }] } }] });
    const res = await new GroqLlmClient({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({ system: '', messages: [], tools: [] });
    expect(res.toolUses).toEqual([{ id: 'c', name: 't', input: {} }]);
  });

  it('throws a body-free LlmError on provider failure', async () => {
    const { impl } = fakeFetch({ error: 'secret detail' }, 401);
    await expect(new GroqLlmClient({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({ system: '', messages: [], tools: [] })).rejects.toThrow(
      new LlmError('LLM provider returned HTTP 401', 401)
    );
  });

  it('is selected when only GROQ_API_KEY is configured', () => {
    expect(createLlmClient({ GROQ_API_KEY: 'k', AGENT_MODEL: 'x' }).enabled).toBe(true);
    expect(createLlmClient({ AGENT_MODEL: 'x' }).enabled).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { agentApi, agentErrorMessage } from './agent-api';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const message = { id: uuid(1), role: 'assistant', content: 'Hi', toolCalls: [], createdAt: '2026-01-01T00:00:00.000Z' };
function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body }) as unknown as typeof fetch;
}
afterEach(() => vi.restoreAllMocks());

describe('agentApi', () => {
  it('posts chat messages with credentials and parses the reply', async () => {
    respond(200, { conversationId: uuid(2), reply: message, pendingActions: [] });
    const result = await agentApi.chat({ message: 'hello' });
    expect(result.reply.content).toBe('Hi');
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/v1/agent/chat');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ message: 'hello' }) });
  });
  it('uses the confirm and reject endpoints', async () => {
    const action = { id: uuid(3), tool: 'bookings.cancel', summary: 'Cancel', input: {}, status: 'CONFIRMED', resultSummary: 'Done', expiresAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };
    respond(200, { action, reply: message });
    await agentApi.confirm(uuid(3));
    await agentApi.reject(uuid(3));
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls[0]).toContain(`/api/v1/agent/actions/${uuid(3)}/confirm`);
    expect(urls[1]).toContain(`/api/v1/agent/actions/${uuid(3)}/reject`);
  });
  it('rejects malformed responses instead of passing them on', async () => {
    respond(200, { enabled: 'yes' });
    await expect(agentApi.status()).rejects.toThrow();
  });
  it('maps disabled and rate limited responses to plain messages', async () => {
    respond(503, { code: 'AGENT_DISABLED', message: 'off' });
    const error = await agentApi.chat({ message: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(agentErrorMessage(error)).toMatch(/unavailable/);
    expect(agentErrorMessage(new ApiError('slow', 429))).toMatch(/too quickly/);
    expect(agentErrorMessage(new ApiError('nope', 403))).toMatch(/permission/);
    expect(agentErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
  it('encodes ids in the path', async () => {
    respond(200, {});
    await agentApi.remove('a/b');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/conversations/a%2Fb');
  });
});

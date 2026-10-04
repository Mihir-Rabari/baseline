import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAgent, useAgentStatus } from './use-agent';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doubles = vi.hoisted(() => ({
  api: { status: vi.fn(), chat: vi.fn(), confirm: vi.fn(), reject: vi.fn(), conversations: vi.fn(), conversation: vi.fn(), remove: vi.fn() },
  permissions: new Set<string>(), userId: 'first-user',
}));
vi.mock('@/lib/agent-api', async (original) => ({ ...(await original<object>()), agentApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: doubles.userId }, hasPermission: (p: string) => doubles.permissions.has(p) }) }));

const reply = { id: uuid(1), role: 'assistant' as const, content: 'You have 2 bookings.', toolCalls: [], createdAt: '2026-01-01T00:00:00.000Z' };
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); doubles.permissions = new Set(['agent:use', 'agent:act']); doubles.userId = 'first-user';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  doubles.api.status.mockResolvedValue({ enabled: true, tools: [] });
  doubles.api.conversations.mockResolvedValue([]);
  doubles.api.conversation.mockResolvedValue({ id: uuid(2), title: 't', messages: [], pendingActions: [], updatedAt: reply.createdAt });
});

describe('useAgent', () => {
  it('shows the user message immediately, then the reply', async () => {
    let resolve!: (value: unknown) => void;
    doubles.api.chat.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useAgent(null), { wrapper });
    act(() => { result.current.send.mutate('How many bookings?'); });
    await waitFor(() => expect(result.current.thinking).toBe(true));
    expect(result.current.conversation.data?.messages.map((m) => m.content)).toEqual(['How many bookings?']);
    await act(async () => { resolve({ conversationId: uuid(2), reply, pendingActions: [] }); });
    await waitFor(() => expect(result.current.thinking).toBe(false));
    expect(doubles.api.chat).toHaveBeenCalledWith({ message: 'How many bookings?' });
    expect(client.getQueryData(['agent', 'first-user', 'conversation', uuid(2)])).toMatchObject({ messages: [{ role: 'user' }, { content: reply.content }] });
  });
  it('rolls the optimistic message back when sending fails', async () => {
    doubles.api.chat.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useAgent(null), { wrapper });
    await act(async () => { await result.current.send.mutateAsync('hi').catch(() => undefined); });
    expect(result.current.conversation.data?.messages ?? []).toEqual([]);
    await waitFor(() => expect(result.current.send.isError).toBe(true));
  });
  it('invalidates every cache after a confirmed action but not after a rejection', async () => {
    const action = { id: uuid(3), tool: 't', summary: 's', input: {}, status: 'CONFIRMED', resultSummary: 'ok', expiresAt: reply.createdAt, createdAt: reply.createdAt };
    doubles.api.confirm.mockResolvedValue({ action, reply }); doubles.api.reject.mockResolvedValue({ action: { ...action, status: 'REJECTED' }, reply });
    const { result } = renderHook(() => useAgent(null), { wrapper });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await act(() => result.current.reject.mutateAsync(uuid(3)));
    expect(spy).toHaveBeenLastCalledWith({ queryKey: ['agent', 'first-user'] });
    await act(() => result.current.confirm.mutateAsync(uuid(3)));
    expect(spy).toHaveBeenLastCalledWith();
    expect(doubles.api.confirm).toHaveBeenCalledWith(uuid(3));
  });
  it('scopes keys by user and does not fetch without agent:use', () => {
    doubles.permissions = new Set();
    const { result } = renderHook(() => useAgent(null), { wrapper });
    expect(result.current.canUse).toBe(false);
    expect(doubles.api.status).not.toHaveBeenCalled();
    expect(doubles.api.conversations).not.toHaveBeenCalled();
  });
  it('reports canAct only with agent:act', () => {
    doubles.permissions = new Set(['agent:use']);
    const { result } = renderHook(() => useAgent(null), { wrapper });
    expect(result.current.canUse).toBe(true);
    expect(result.current.canAct).toBe(false);
  });
  it('keeps each user in a separate cache scope', async () => {
    const { result, rerender } = renderHook(() => useAgentStatus(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    doubles.userId = 'second-user'; rerender();
    await waitFor(() => expect(doubles.api.status).toHaveBeenCalledTimes(2));
    expect(client.getQueryData(['agent', 'second-user', 'status'])).toBeDefined();
  });
});

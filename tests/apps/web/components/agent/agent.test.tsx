import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { AgentLauncher } from '../../../../../apps/web/src/components/agent/agent-launcher';
import { RichText } from '../../../../../apps/web/src/components/agent/rich-text';
import { suggestedPrompts } from '../../../../../apps/web/src/components/agent/prompts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doubles = vi.hoisted(() => ({
  api: { status: vi.fn(), chat: vi.fn(), confirm: vi.fn(), reject: vi.fn(), conversations: vi.fn(), conversation: vi.fn(), remove: vi.fn() },
  permissions: new Set<string>(),
}));
vi.mock('@/lib/agent-api', async (original) => ({ ...(await original<object>()), agentApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' }, hasPermission: (p: string) => doubles.permissions.has(p) }) }));

const now = '2026-01-01T00:00:00.000Z';
const msg = (n: number, role: 'user' | 'assistant', content: string, toolCalls: { tool: string; summary: string; ok: boolean }[] = []) => ({ id: uuid(n), role, content, toolCalls, createdAt: now });
const action = (over = {}) => ({ id: uuid(50), tool: 'bookings.cancel', summary: 'Cancel booking BK-1042', input: { bookingId: 'BK-1042', reason: 'Member request' }, status: 'PENDING' as const,
  resultSummary: null, expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), createdAt: now, ...over });
function renderLauncher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AgentLauncher /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); doubles.permissions = new Set(['agent:use', 'agent:act']);
  doubles.api.status.mockResolvedValue({ enabled: true, tools: [{ name: 'bookings.list', description: 'd', write: false }, { name: 'bookings.cancel', description: 'd', write: true }] });
  doubles.api.conversations.mockResolvedValue([]);
});
const open = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Ask assistant' })); return screen.findByRole('dialog', { name: 'Assistant' }); };

describe('AgentLauncher', () => {
  it('is hidden without agent:use and does not call the API', async () => {
    doubles.permissions = new Set();
    renderLauncher();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Ask assistant' })).toBeNull();
    expect(doubles.api.status).not.toHaveBeenCalled();
  });
  it('is hidden when the agent is disabled', async () => {
    doubles.api.status.mockResolvedValue({ enabled: false, tools: [] });
    renderLauncher();
    await waitFor(() => expect(doubles.api.status).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Ask assistant' })).toBeNull();
  });
  it('offers suggestions based on tools, sends a message and renders the reply with tool chips', async () => {
    doubles.api.chat.mockResolvedValue({ conversationId: uuid(2), reply: msg(3, 'assistant', 'Two bookings today.', [{ tool: 'bookings.list', summary: 'Looked up bookings', ok: true }]), pendingActions: [] });
    doubles.api.conversation.mockResolvedValue({ id: uuid(2), title: 'x', messages: [msg(4, 'user', 'What is booked today?'), msg(3, 'assistant', 'Two bookings today.', [{ tool: 'bookings.list', summary: 'Looked up bookings', ok: true }])], pendingActions: [], updatedAt: now });
    renderLauncher(); await open();
    expect(screen.getByRole('button', { name: 'What is booked today?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /memberships expire/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Message'), 'What is booked today?{Enter}');
    expect(await screen.findByText('Two bookings today.')).toBeInTheDocument();
    expect(screen.getByText('Looked up bookings')).toBeInTheDocument();
    expect(doubles.api.chat).toHaveBeenCalledWith({ message: 'What is booked today?' });
  });
  it('shows a pending action and only confirms on click', async () => {
    doubles.api.chat.mockResolvedValue({ conversationId: uuid(2), reply: msg(3, 'assistant', 'Please confirm.'), pendingActions: [action()] });
    doubles.api.conversation.mockResolvedValue({ id: uuid(2), title: 'x', messages: [msg(4, 'user', 'cancel it'), msg(3, 'assistant', 'Please confirm.')], pendingActions: [action()], updatedAt: now });
    doubles.api.confirm.mockResolvedValue({ action: action({ status: 'CONFIRMED', resultSummary: 'Booking cancelled' }), reply: msg(5, 'assistant', 'Done.') });
    renderLauncher(); await open();
    await userEvent.type(screen.getByLabelText('Message'), 'cancel it{Enter}');
    expect(await screen.findByText('Cancel booking BK-1042')).toBeInTheDocument();
    expect(screen.getByText('Member request')).toBeInTheDocument();
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    expect(doubles.api.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(doubles.api.confirm).toHaveBeenCalledWith(uuid(50)));
  });
  it('disables Confirm and explains why without agent:act', async () => {
    doubles.permissions = new Set(['agent:use']);
    doubles.api.chat.mockResolvedValue({ conversationId: uuid(2), reply: msg(3, 'assistant', 'Please confirm.'), pendingActions: [action()] });
    doubles.api.conversation.mockResolvedValue({ id: uuid(2), title: 'x', messages: [msg(3, 'assistant', 'Please confirm.')], pendingActions: [action()], updatedAt: now });
    renderLauncher(); await open();
    await userEvent.type(screen.getByLabelText('Message'), 'cancel it{Enter}');
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByText(/do not have permission to confirm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
  it('shows a rate limit error and restores the draft', async () => {
    doubles.api.chat.mockRejectedValue(new ApiError('slow down', 429, 'RATE_LIMITED'));
    renderLauncher(); await open();
    await userEvent.type(screen.getByLabelText('Message'), 'hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/too quickly/);
    expect(screen.getByLabelText('Message')).toHaveValue('hello');
  });
  it('shows the disabled state when the service answers 503', async () => {
    doubles.api.chat.mockRejectedValue(new ApiError('off', 503, 'AGENT_DISABLED'));
    renderLauncher(); await open();
    await userEvent.type(screen.getByLabelText('Message'), 'hello{Enter}');
    expect(await screen.findByText('The assistant is off')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });
  it('closes on Escape and returns focus to the launcher', async () => {
    renderLauncher(); await open();
    expect(screen.getByLabelText('Message')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask assistant' })).toHaveFocus());
  });
  it('renders message content as text, never as HTML', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"> <script>alert(1)</script>';
    doubles.api.chat.mockResolvedValue({ conversationId: uuid(2), reply: msg(3, 'assistant', hostile), pendingActions: [] });
    doubles.api.conversation.mockResolvedValue({ id: uuid(2), title: 'x', messages: [msg(3, 'assistant', hostile)], pendingActions: [], updatedAt: now });
    const { container } = renderLauncher(); await open();
    await userEvent.type(screen.getByLabelText('Message'), 'x{Enter}');
    expect(await screen.findByText(/onerror/)).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('img')).toBeNull();
    expect(container.ownerDocument.querySelector('script')).toBeNull();
  });
  it('lets the user switch conversations and start a new chat', async () => {
    doubles.api.conversations.mockResolvedValue([{ id: uuid(9), title: 'Court rota', updatedAt: now }]);
    doubles.api.conversation.mockResolvedValue({ id: uuid(9), title: 'Court rota', messages: [msg(3, 'assistant', 'Earlier answer')], pendingActions: [], updatedAt: now });
    renderLauncher(); await open();
    await userEvent.selectOptions(await screen.findByLabelText('Conversation'), uuid(9));
    expect(await screen.findByText('Earlier answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('Ask about your club')).toBeInTheDocument();
  });
});

describe('RichText', () => {
  it('renders bold, bullets, numbers and line breaks as elements from plain text', () => {
    const { container } = render(<RichText content={'**Hi** there\nsecond\n\n- a\n- b\n1. one\n2. two'} />);
    expect(container.querySelector('strong')).toHaveTextContent('Hi');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });
  it('escapes markup', () => {
    const { container } = render(<RichText content={'<b>x</b> <img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<b>x</b>');
  });
});

describe('suggestedPrompts', () => {
  it('depends on available tools and always returns at least one prompt', () => {
    expect(suggestedPrompts([])).toEqual(['What can you help me with?']);
    expect(suggestedPrompts([{ name: 'members.list', write: false }])).toEqual(['Find a member by name']);
    expect(suggestedPrompts([{ name: 'bookings.list', write: false }, { name: 'bookings.cancel', write: true }])).toContain('Help me cancel a booking');
  });
});

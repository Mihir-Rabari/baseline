import {
  AgentActionResultSchema, AgentChatResponseSchema, AgentConversationListSchema, AgentConversationSchema, AgentStatusSchema,
  type AgentActionResult, type AgentChatBody, type AgentChatResponse, type AgentConversation, type AgentStatus,
} from '@packages/validation';
import { ApiError, fetchApi, USE_MOCKS, mock } from '@/lib/api-client';

export interface AgentConversationSummary { id: string; title: string; updatedAt: string }

/** The agent is switched off, or the service behind it is unreachable. */
export const isAgentUnavailable = (error: unknown) => error instanceof ApiError && error.statusCode === 503;
export const isAgentRateLimited = (error: unknown) => error instanceof ApiError && error.statusCode === 429;

/** A sentence a person can act on, with the raw API message left to the caller. */
export function agentErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isAgentUnavailable(error)) return 'The assistant is unavailable right now. Try again later.';
  if (isAgentRateLimited(error)) return 'You are sending messages too quickly. Wait a moment, then try again.';
  if (error instanceof ApiError && error.statusCode === 403) return 'You do not have permission to do that.';
  if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 410)) return 'This item is no longer available.';
  return fallback;
}

const unavailable = () => new ApiError('The assistant is not available in demo mode.', 503, 'AGENT_DISABLED');
const id = (value: string) => encodeURIComponent(value);

export const agentApi = {
  status: async (): Promise<AgentStatus> => USE_MOCKS
    ? mock({ enabled: false, tools: [] })
    : AgentStatusSchema.parse(await fetchApi('/api/v1/agent/status')),
  chat: async (body: AgentChatBody): Promise<AgentChatResponse> => {
    if (USE_MOCKS) throw unavailable();
    return AgentChatResponseSchema.parse(await fetchApi('/api/v1/agent/chat', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000 }));
  },
  confirm: async (actionId: string): Promise<AgentActionResult> => {
    if (USE_MOCKS) throw unavailable();
    return AgentActionResultSchema.parse(await fetchApi(`/api/v1/agent/actions/${id(actionId)}/confirm`, { method: 'POST', body: '{}', timeoutMs: 60000 }));
  },
  reject: async (actionId: string): Promise<AgentActionResult> => {
    if (USE_MOCKS) throw unavailable();
    return AgentActionResultSchema.parse(await fetchApi(`/api/v1/agent/actions/${id(actionId)}/reject`, { method: 'POST', body: '{}' }));
  },
  conversations: async (): Promise<AgentConversationSummary[]> => {
    if (USE_MOCKS) return [];
    return AgentConversationListSchema.parse(await fetchApi('/api/v1/agent/conversations')).data;
  },
  conversation: async (conversationId: string): Promise<AgentConversation> => {
    if (USE_MOCKS) throw unavailable();
    return AgentConversationSchema.parse(await fetchApi(`/api/v1/agent/conversations/${id(conversationId)}`));
  },
  remove: async (conversationId: string): Promise<void> => {
    if (USE_MOCKS) throw unavailable();
    await fetchApi(`/api/v1/agent/conversations/${id(conversationId)}`, { method: 'DELETE' });
  },
};

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgentConversation, AgentMessage } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { agentApi } from '@/lib/agent-api';
import { shouldRetryQuery } from '@/lib/query-retry';

/** Cache slot for a chat that has no server id yet. */
export const NEW_CONVERSATION = 'new';

const emptyConversation = (id: string): AgentConversation => ({ id, title: '', messages: [], pendingActions: [], updatedAt: new Date().toISOString() });

/** Status only: cheap enough for the launcher to call on every signed-in screen. */
export function useAgentStatus() {
  const { user, hasPermission } = useAuth();
  const scope = user?.id ?? '';
  const canUse = Boolean(user) && hasPermission('agent:use');
  const query = useQuery({ queryKey: ['agent', scope, 'status'], queryFn: () => agentApi.status(), enabled: canUse,
    staleTime: 60000, retry: shouldRetryQuery });
  return { ...query, canUse, enabled: canUse && query.data?.enabled === true };
}

export function useAgent(conversationId: string | null) {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const scope = user?.id ?? '';
  const canUse = Boolean(user) && hasPermission('agent:use');
  const canAct = canUse && hasPermission('agent:act');
  const key = (...rest: unknown[]) => ['agent', scope, ...rest];

  const status = useQuery({ queryKey: key('status'), queryFn: () => agentApi.status(), enabled: canUse, staleTime: 60000, retry: shouldRetryQuery });
  const conversations = useQuery({ queryKey: key('conversations'), queryFn: () => agentApi.conversations(), enabled: canUse, staleTime: 15000, retry: shouldRetryQuery });
  const conversation = useQuery({ queryKey: key('conversation', conversationId ?? NEW_CONVERSATION),
    queryFn: () => agentApi.conversation(conversationId!), enabled: canUse && Boolean(conversationId), staleTime: 5000, retry: shouldRetryQuery });

  const send = useMutation({
    mutationFn: (message: string) => agentApi.chat({ message, ...(conversationId ? { conversationId } : {}) }),
    onMutate: async (message) => {
      const slot = key('conversation', conversationId ?? NEW_CONVERSATION);
      await queryClient.cancelQueries({ queryKey: slot });
      const previous = queryClient.getQueryData<AgentConversation>(slot);
      const optimistic: AgentMessage = { id: `pending-${Date.now()}`, role: 'user', content: message, toolCalls: [], createdAt: new Date().toISOString() };
      const base = previous ?? emptyConversation(conversationId ?? NEW_CONVERSATION);
      queryClient.setQueryData<AgentConversation>(slot, { ...base, messages: [...base.messages, optimistic] });
      return { slot, previous, optimistic };
    },
    onError: (_error, _message, context) => {
      if (context) queryClient.setQueryData(context.slot, context.previous);
    },
    onSuccess: (result, _message, context) => {
      const base = queryClient.getQueryData<AgentConversation>(context.slot) ?? emptyConversation(result.conversationId);
      const merged: AgentConversation = { ...base, id: result.conversationId, messages: [...base.messages, result.reply],
        pendingActions: [...base.pendingActions, ...result.pendingActions], updatedAt: result.reply.createdAt };
      const target = key('conversation', result.conversationId);
      queryClient.setQueryData(target, merged);
      if (context.slot[context.slot.length - 1] === NEW_CONVERSATION) queryClient.removeQueries({ queryKey: context.slot });
      void queryClient.invalidateQueries({ queryKey: target });
      void queryClient.invalidateQueries({ queryKey: key('conversations') });
    },
  });

  const refreshAgent = () => queryClient.invalidateQueries({ queryKey: ['agent', scope] });
  // The agent may have changed bookings, members, stock and so on, so every cache is stale after a confirmed write.
  const confirm = useMutation({ mutationFn: (actionId: string) => agentApi.confirm(actionId),
    onSuccess: () => queryClient.invalidateQueries(), onError: refreshAgent });
  const reject = useMutation({ mutationFn: (actionId: string) => agentApi.reject(actionId), onSuccess: refreshAgent, onError: refreshAgent });
  const remove = useMutation({ mutationFn: (id: string) => agentApi.remove(id), onSuccess: (_void, id) => {
    queryClient.removeQueries({ queryKey: key('conversation', id) });
    return queryClient.invalidateQueries({ queryKey: key('conversations') });
  } });

  return { status, conversations, conversation, send, confirm, reject, remove, canUse, canAct,
    thinking: send.isPending, acting: confirm.isPending || reject.isPending };
}

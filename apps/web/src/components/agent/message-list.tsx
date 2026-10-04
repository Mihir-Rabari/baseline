'use client';

import React, { useEffect, useRef } from 'react';
import type { AgentConversation } from '@packages/validation';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { RichText } from '@/components/agent/rich-text';
import { ToolCallChips } from '@/components/agent/tool-call-chips';
import { PendingActionCard } from '@/components/agent/pending-action-card';

/** The transcript. A polite live region announces new replies and the list follows the newest message. */
export function MessageList({ conversation, thinking, canConfirm, busyActionId, actionError, onConfirm, onReject }: {
  conversation: Pick<AgentConversation, 'messages' | 'pendingActions'>; thinking: boolean; canConfirm: boolean;
  busyActionId?: string | null; actionError?: { id: string; message: string } | null;
  onConfirm: (id: string) => void; onReject: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = conversation.messages.length + conversation.pendingActions.length + (thinking ? 1 : 0);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [size]);
  return <div ref={ref} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {conversation.messages.map((message) => <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
        <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Assistant: '}</span>
        <RichText content={message.content} />
        {message.role === 'assistant' && <ToolCallChips calls={message.toolCalls} />}
      </div>
    </div>)}
    {conversation.pendingActions.map((action) => <PendingActionCard key={action.id} action={action} canConfirm={canConfirm}
      busy={busyActionId === action.id} error={actionError?.id === action.id ? actionError.message : null} onConfirm={onConfirm} onReject={onReject} />)}
    {thinking && <div role="status" aria-label="Assistant is working" className="max-w-[60%] space-y-2 rounded-lg bg-muted px-3 py-3">
      <Skeleton className="h-3 w-40 max-w-full" /><Skeleton className="h-3 w-24" />
    </div>}
  </div>;
}

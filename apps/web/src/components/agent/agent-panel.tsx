'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AGENT_MAX_MESSAGE_LENGTH } from '@packages/validation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/app-shell/empty-state';
import { MessageList } from '@/components/agent/message-list';
import { suggestedPrompts } from '@/components/agent/prompts';
import { useAgent } from '@/hooks/use-agent';
import { agentErrorMessage, isAgentUnavailable } from '@/lib/agent-api';
import { getErrorMessage } from '@/lib/errors';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Slide-over chat drawer; full screen on phones. Closes on Esc and keeps keyboard focus inside while open. */
export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const { status, conversations, conversation, send, confirm, reject, remove, canUse, canAct, thinking } = useAgent(conversationId);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const disabled = status.data?.enabled === false || isAgentUnavailable(send.error);
  const tools = status.data?.tools ?? [];
  const messages = conversation.data?.messages ?? [];
  const actions = conversation.data?.pendingActions ?? [];
  const startedConversation = Boolean(conversationId) || messages.length > 0;
  const list = conversations.data ?? [];

  function submit(text = draft) {
    const message = text.trim();
    if (!message || thinking || disabled || !canUse) return;
    setDraft('');
    send.mutate(message, {
      onSuccess: (result) => setConversationId(result.conversationId),
      onError: () => setDraft((current) => current || message),
    });
  }
  function newChat() { send.reset(); confirm.reset(); reject.reset(); setConversationId(null); setDraft(''); inputRef.current?.focus(); }
  function choose(id: string) { send.reset(); setConversationId(id || null); }
  const busyId = confirm.isPending ? confirm.variables : reject.isPending ? reject.variables : null;
  const actionFailure = confirm.error ?? reject.error;
  const failedId = confirm.error ? confirm.variables : reject.variables;

  return <div className="fixed inset-0 z-[60] flex justify-end" onKeyDown={onKeyDown}>
    <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 hidden bg-foreground/20 sm:block" onClick={onClose} />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="agent-panel-title"
      className="relative flex h-full w-full flex-col border-l bg-background shadow-lg sm:max-w-md">
      <header className="space-y-3 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="agent-panel-title" className="text-lg font-semibold">Assistant</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={newChat}>New chat</Button>
            <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={onClose}><X className="h-4 w-4" aria-hidden /></Button>
          </div>
        </div>
        {list.length > 0 && <div className="flex items-center gap-2">
          <label htmlFor="agent-conversation" className="sr-only">Conversation</label>
          <select id="agent-conversation" value={conversationId ?? ''} onChange={(event) => choose(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <option value="">New chat</option>
            {list.map((item) => <option key={item.id} value={item.id}>{item.title || 'Untitled chat'}</option>)}
          </select>
          {conversationId && <Button variant="ghost" size="sm" disabled={remove.isPending}
            onClick={() => remove.mutate(conversationId, { onSuccess: () => setConversationId(null) })}>Delete chat</Button>}
        </div>}
        {remove.error && <p role="alert" className="text-sm text-destructive">{agentErrorMessage(remove.error, 'Could not delete this chat.')}</p>}
      </header>

      {status.isLoading || (conversationId && conversation.isLoading) ? (
        <div role="status" aria-label="Loading" className="flex-1 space-y-3 p-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="ml-auto h-10 w-1/2" /><Skeleton className="h-16 w-3/4" /></div>
      ) : disabled ? (
        <div className="flex-1 p-4"><EmptyState title="The assistant is off" description="It is unavailable at the moment. You can keep working as usual and check back later." /></div>
      ) : conversationId && conversation.isError ? (
        <div className="flex-1 space-y-2 p-4" role="alert">
          <p className="font-medium">This chat could not be loaded</p>
          <p className="text-sm text-muted-foreground">{agentErrorMessage(conversation.error, 'Try again in a moment.')}</p>
          <p className="font-mono text-xs text-muted-foreground">{getErrorMessage(conversation.error, '')}</p>
          <Button size="sm" variant="outline" onClick={() => { conversation.refetch(); }}>Try again</Button>
        </div>
      ) : !startedConversation ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <EmptyState title="Ask about your club" description="The assistant can look things up and prepare changes for you to approve. It sees only what you can see." />
          <ul className="space-y-2" aria-label="Suggested questions">
            {suggestedPrompts(tools).map((prompt) => <li key={prompt}>
              <Button variant="outline" className="h-auto w-full justify-start whitespace-normal py-2 text-left font-normal" disabled={!canUse || thinking} onClick={() => submit(prompt)}>{prompt}</Button>
            </li>)}
          </ul>
        </div>
      ) : (
        <MessageList conversation={{ messages, pendingActions: actions }} thinking={thinking} canConfirm={canAct}
          busyActionId={busyId} actionError={actionFailure && failedId ? { id: failedId, message: agentErrorMessage(actionFailure, 'Could not complete that change.') } : null}
          onConfirm={(id) => confirm.mutate(id)} onReject={(id) => reject.mutate(id)} />
      )}

      {send.error && !disabled && <div role="alert" className="border-t px-4 py-2 text-sm text-destructive">
        {agentErrorMessage(send.error, 'Your message was not sent. Try again.')}
        <span className="block font-mono text-xs text-muted-foreground">{getErrorMessage(send.error, '')}</span>
      </div>}

      <form className="space-y-2 border-t p-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label htmlFor="agent-message" className="sr-only">Message</label>
        <textarea ref={inputRef} id="agent-message" rows={2} value={draft} maxLength={AGENT_MAX_MESSAGE_LENGTH} disabled={disabled || !canUse}
          placeholder="Ask a question or describe a change" onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line.</p>
          <Button type="submit" size="sm" disabled={disabled || !canUse || thinking || draft.trim() === ''}>{thinking ? 'Sending…' : 'Send'}</Button>
        </div>
      </form>
    </div>
  </div>;
}

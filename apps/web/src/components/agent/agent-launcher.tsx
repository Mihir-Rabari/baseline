'use client';

import React, { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentPanel } from '@/components/agent/agent-panel';
import { useAgentStatus } from '@/hooks/use-agent';

/** Floating entry point. Renders nothing unless the user may use the agent and the server has it switched on. */
export function AgentLauncher() {
  const { enabled } = useAgentStatus();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!enabled) return null;
  const close = () => { setOpen(false); requestAnimationFrame(() => button.current?.focus()); };
  return <>
    {!open && <Button ref={button} className="fixed bottom-4 right-4 z-40 gap-2 rounded-full px-5 shadow-lg transition-transform hover:-translate-y-0.5" aria-haspopup="dialog" onClick={() => setOpen(true)}><Sparkles className="size-4" aria-hidden />Ask assistant</Button>}
    {open && <AgentPanel onClose={close} />}
  </>;
}

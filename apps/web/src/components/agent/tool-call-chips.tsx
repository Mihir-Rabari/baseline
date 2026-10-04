import React from 'react';
import type { AgentToolCall } from '@packages/validation';
import { cn } from '@/lib/utils';

/** What the assistant looked up to answer, as short chips. Failed lookups say so in words. */
export function ToolCallChips({ calls }: { calls: AgentToolCall[] }) {
  if (calls.length === 0) return null;
  return <ul aria-label="Looked up" className="mt-2 flex flex-wrap gap-1.5">
    {calls.map((call, index) => <li key={`${call.tool}-${index}`}
      className={cn('rounded-md border px-2 py-0.5 text-xs', call.ok ? 'bg-muted text-muted-foreground' : 'border-destructive/25 bg-destructive/10 text-destructive')}>
      {call.ok ? call.summary : `Failed: ${call.summary}`}
    </li>)}
  </ul>;
}

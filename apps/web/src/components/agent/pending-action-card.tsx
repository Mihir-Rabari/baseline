'use client';

import React from 'react';
import type { AgentPendingAction } from '@packages/validation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function expiryLabel(expiresAt: string, now = Date.now()): string {
  const minutes = Math.ceil((new Date(expiresAt).getTime() - now) / 60000);
  if (minutes <= 0) return 'Expired';
  if (minutes < 60) return `Expires in ${minutes} min`;
  return `Expires in ${Math.ceil(minutes / 60)} h`;
}
const STATUS = { CONFIRMED: ['success', 'Done'], REJECTED: ['secondary', 'Cancelled'], EXPIRED: ['warning', 'Expired'], FAILED: ['error', 'Failed'] } as const;

/** A staged change. Nothing runs until the person presses Confirm. */
export function PendingActionCard({ action, canConfirm, busy, error, onConfirm, onReject }: {
  action: AgentPendingAction; canConfirm: boolean; busy?: boolean; error?: string | null;
  onConfirm: (id: string) => void; onReject: (id: string) => void;
}) {
  const entries = Object.entries(action.input);
  const expired = new Date(action.expiresAt).getTime() <= Date.now();
  const pending = action.status === 'PENDING';
  const closed = STATUS[action.status as keyof typeof STATUS];
  return <section aria-label={`Proposed change: ${action.summary}`} className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground">Proposed change</p>
        <p className="font-medium">{action.summary}</p>
      </div>
      {closed && <Badge variant={closed[0]}>{closed[1]}</Badge>}
    </div>
    {entries.length > 0 && <dl className="divide-y rounded-md border text-sm">
      {entries.map(([key, value]) => <div key={key} className="flex justify-between gap-4 px-3 py-1.5">
        <dt className="text-muted-foreground">{humanize(key)}</dt>
        <dd className="min-w-0 break-words text-right">{display(value)}</dd>
      </div>)}
    </dl>}
    {!pending && action.resultSummary && <p className="text-sm text-muted-foreground">{action.resultSummary}</p>}
    {pending && <>
      <p className="text-xs text-muted-foreground">{expired ? 'Expired' : expiryLabel(action.expiresAt)}. Nothing changes until you confirm.</p>
      {!canConfirm && <p className="text-xs text-muted-foreground">You do not have permission to confirm changes. Ask an administrator to confirm this for you.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!canConfirm || expired || busy} onClick={() => onConfirm(action.id)}>{busy ? 'Confirming…' : 'Confirm'}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(action.id)}>Cancel</Button>
      </div>
    </>}
  </section>;
}

'use client';

import React, { useState } from 'react';
import type { Colleague, Shift, ShiftSwap, ShiftSwapStatus } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownSelect } from '@/components/ui/dropdown-select';
import { PageError } from '@/components/club/page-error';
import { errorText } from '@/components/club/form-dialog';

const KEYS = ['shift-swaps'];
const STATUS_LABEL: Record<ShiftSwapStatus, string> = {
  PENDING: 'Waiting for colleague', ACCEPTED: 'Waiting for owner', DECLINED: 'Declined', CANCELLED: 'Withdrawn', APPROVED: 'Approved', REJECTED: 'Rejected',
};
const statusTone = (status: ShiftSwapStatus) => (status === 'APPROVED' ? 'success' : status === 'REJECTED' || status === 'DECLINED' ? 'warning' : status === 'CANCELLED' ? 'outline' : 'default') as 'success' | 'warning' | 'outline' | 'default';
const range = (shift: { startsAt: string; endsAt: string }) => `${formatDateTime(shift.startsAt)} – ${formatDateTime(shift.endsAt)}`;
const roleName = (label: string) => label.replaceAll('_', ' ').toLowerCase();

function SwapSummary({ swap }: { swap: ShiftSwap }) {
  return (
    <div className="space-y-1 text-sm">
      <p><strong>{swap.proposer.fullName}</strong> offers {roleName(swap.shift.roleLabel)} · {range(swap.shift)} to <strong>{swap.target.fullName}</strong></p>
      {swap.requestedShift && <p className="text-muted-foreground">In exchange for {roleName(swap.requestedShift.roleLabel)} · {range(swap.requestedShift)}</p>}
      {swap.note && <p className="text-muted-foreground">“{swap.note}”</p>}
      {swap.decisionNote && <p className="text-muted-foreground">Owner: {swap.decisionNote}</p>}
    </div>
  );
}

function OfferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const upcoming = useOpsQuery<Shift[]>(['shift-swaps', 'upcoming'], '/me/shifts/upcoming', { enabled: open });
  const colleagues = useOpsQuery<Colleague[]>(['shift-swaps', 'colleagues'], '/me/colleagues', { enabled: open });
  const offer = useOpsMutation<ShiftSwap, { shiftId: string; targetEmployeeId: string; note?: string }>('post', KEYS, () => '/me/shift-swaps');
  const [shiftId, setShiftId] = useState('');
  const [colleagueId, setColleagueId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loading = upcoming.isPending || colleagues.isPending;
  const failed = upcoming.error ?? colleagues.error;
  const reset = () => { setShiftId(''); setColleagueId(''); setNote(''); setError(null); };
  const close = () => { if (!offer.isPending) { reset(); onClose(); } };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (offer.isPending) return;
    if (!shiftId) { setError('Choose the shift you want to offer.'); return; }
    if (!colleagueId) { setError('Choose who to offer it to.'); return; }
    setError(null);
    try { await offer.mutateAsync({ shiftId, targetEmployeeId: colleagueId, ...(note.trim() ? { note: note.trim() } : {}) }); reset(); onClose(); }
    catch (caught) { setError(errorText(caught, 'Could not send the offer.')); }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Offer a shift</DialogTitle><DialogDescription>Your colleague answers first, then the owner confirms the change.</DialogDescription></DialogHeader>
        {loading ? <Skeleton className="h-40" /> : failed ? <PageError error={failed} onRetry={() => { void upcoming.refetch(); void colleagues.refetch(); }} /> :
          !upcoming.data?.length ? <p className="text-sm text-muted-foreground">You have no upcoming shifts that can be offered.</p> :
          !colleagues.data?.length ? <p className="text-sm text-muted-foreground">There is nobody else to offer a shift to.</p> :
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="swap-shift">Shift to offer</Label><DropdownSelect id="swap-shift" value={shiftId} onValueChange={setShiftId} disabled={offer.isPending} placeholder="Choose a shift" options={upcoming.data.map((s) => ({ value: s.id, label: `${roleName(s.roleLabel)} · ${range(s)}` }))} /></div>
            <div className="space-y-2"><Label htmlFor="swap-colleague">Offer to</Label><DropdownSelect id="swap-colleague" value={colleagueId} onValueChange={setColleagueId} disabled={offer.isPending} placeholder="Choose a colleague" options={colleagues.data.map((c) => ({ value: c.id, label: `${c.fullName} (${c.position})` }))} /></div>
            <div className="space-y-2"><Label htmlFor="swap-note">Note (optional)</Label><Input id="swap-note" value={note} maxLength={500} disabled={offer.isPending} onChange={(e) => setNote(e.target.value)} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={offer.isPending}>{offer.isPending ? 'Sending…' : 'Send offer'}</Button>
          </form>}
      </DialogContent>
    </Dialog>
  );
}

/** Staff side: offer a shift, answer offers made to you, withdraw your own open offers. */
function MySwaps() {
  const swaps = useOpsQuery<ShiftSwap[]>(['shift-swaps', 'mine'], '/me/shift-swaps', { refetchMs: 15000 });
  const respond = useOpsMutation<ShiftSwap, { id: string; response: 'ACCEPT' | 'DECLINE' }>('post', KEYS, (v) => `/me/shift-swaps/${encodeURIComponent(v.id)}/respond`);
  const cancel = useOpsMutation<ShiftSwap, { id: string }>('post', KEYS, (v) => `/me/shift-swaps/${encodeURIComponent(v.id)}/cancel`);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = respond.isPending || cancel.isPending;
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return; setError(null);
    try { await action(); } catch (caught) { setError(errorText(caught, 'Could not update the swap.')); }
  };
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="My shift swaps">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Shift swaps</h2><Button variant="outline" onClick={() => setDialog(true)}>Offer a shift</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {swaps.isPending ? <Skeleton className="h-16" /> : swaps.isError ? <PageError error={swaps.error} onRetry={() => swaps.refetch()} /> : !swaps.data.length ? <p className="text-sm text-muted-foreground">No swaps yet. Offer a shift if you cannot make it.</p> :
        <ul className="divide-y">{swaps.data.map((swap) => (
          <li key={swap.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="space-y-1"><SwapSummary swap={swap} /><Badge variant={statusTone(swap.status)}>{STATUS_LABEL[swap.status]}</Badge></div>
            <div className="flex gap-2">
              {swap.role === 'TARGET' && swap.status === 'PENDING' && <>
                <Button size="sm" disabled={busy} aria-label={`Accept shift from ${swap.proposer.fullName}`} onClick={() => run(() => respond.mutateAsync({ id: swap.id, response: 'ACCEPT' }))}>Accept</Button>
                <Button size="sm" variant="outline" disabled={busy} aria-label={`Decline shift from ${swap.proposer.fullName}`} onClick={() => run(() => respond.mutateAsync({ id: swap.id, response: 'DECLINE' }))}>Decline</Button>
              </>}
              {swap.role === 'PROPOSER' && (swap.status === 'PENDING' || swap.status === 'ACCEPTED') &&
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`Withdraw offer to ${swap.target.fullName}`} onClick={() => run(() => cancel.mutateAsync({ id: swap.id }))}>Withdraw</Button>}
            </div>
          </li>))}</ul>}
      <OfferDialog open={dialog} onClose={() => setDialog(false)} />
    </section>
  );
}

/** Owner side: swaps the colleague accepted wait here for approval; open ones can be overridden. */
function SwapApprovals() {
  const swaps = useOpsQuery<ShiftSwap[]>(['shift-swaps', 'all'], '/shift-swaps', { refetchMs: 15000 });
  const decide = useOpsMutation<ShiftSwap, { id: string; decision: 'APPROVED' | 'REJECTED' }>('post', KEYS, (v) => `/shift-swaps/${encodeURIComponent(v.id)}/decision`);
  const [error, setError] = useState<string | null>(null);
  const run = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    if (decide.isPending) return; setError(null);
    try { await decide.mutateAsync({ id, decision }); } catch (caught) { setError(errorText(caught, 'Could not record the decision.')); }
  };
  const open = swaps.data?.filter((swap) => swap.status === 'PENDING' || swap.status === 'ACCEPTED') ?? [];
  const settled = swaps.data?.filter((swap) => swap.status !== 'PENDING' && swap.status !== 'ACCEPTED').slice(0, 5) ?? [];
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Shift swap approvals">
      <h2 className="text-lg font-semibold">Shift swap approvals</h2>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {swaps.isPending ? <Skeleton className="h-16" /> : swaps.isError ? <PageError error={swaps.error} onRetry={() => swaps.refetch()} /> : !open.length ? <p className="text-sm text-muted-foreground">No swaps are waiting for you.</p> :
        <ul className="divide-y">{open.map((swap) => (
          <li key={swap.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="space-y-1"><SwapSummary swap={swap} /><Badge variant={statusTone(swap.status)}>{STATUS_LABEL[swap.status]}</Badge></div>
            <div className="flex gap-2">
              {swap.status === 'ACCEPTED' && <Button size="sm" disabled={decide.isPending} aria-label={`Approve swap from ${swap.proposer.fullName}`} onClick={() => run(swap.id, 'APPROVED')}>Approve</Button>}
              <Button size="sm" variant="outline" disabled={decide.isPending} aria-label={`Reject swap from ${swap.proposer.fullName}`} onClick={() => run(swap.id, 'REJECTED')}>{swap.status === 'PENDING' ? 'Override' : 'Reject'}</Button>
            </div>
          </li>))}</ul>}
      {settled.length > 0 && <div className="space-y-2"><h3 className="text-sm font-medium text-muted-foreground">Recently settled</h3><ul className="space-y-2">{settled.map((swap) => <li key={swap.id} className="flex flex-wrap items-center justify-between gap-2"><SwapSummary swap={swap} /><Badge variant={statusTone(swap.status)}>{STATUS_LABEL[swap.status]}</Badge></li>)}</ul></div>}
    </section>
  );
}

export function ShiftSwaps() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('shifts:manage');
  const canStaff = hasPermission('shifts:clock:self');
  if (!canManage && !canStaff) return null;
  return <>{canStaff && <MySwaps />}{canManage && <SwapApprovals />}</>;
}

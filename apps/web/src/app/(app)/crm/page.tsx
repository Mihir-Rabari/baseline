'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { CrmSummary, LeadListItem } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { usePlans } from '@/hooks/use-plans';
import { qs, type Page } from '@/lib/ops';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { NoAccess, Pager, QueryState, SelectBox, Stat, humanize } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const variant: Record<string, BadgeProps['variant']> = { NEW: 'warning', CONTACTED: 'secondary', QUOTED: 'warning', WON: 'success', LOST: 'outline' };
const stages = ['', 'NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'];

function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>{children}</DialogContent>
    </Dialog>
  );
}

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'WALK_IN', message: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<unknown, object>('post', ['crm'], () => '/crm/leads');
  async function submit() {
    setError(null);
    if (!form.name.trim()) return setError('Enter a name.');
    if (!form.phone.trim() && !form.email.trim()) return setError('Add a phone number or an email.');
    try {
      await create.mutateAsync({ name: form.name.trim(), source: form.source, ...(form.phone.trim() ? { phone: form.phone.trim() } : {}), ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.message.trim() ? { message: form.message.trim() } : {}) });
      toast.success('Lead added'); setForm({ name: '', phone: '', email: '', source: 'WALK_IN', message: '' }); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add the lead.'); }
  }
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <Modal open={open} title="New lead" onClose={onClose}>
      <div className="space-y-2"><Label htmlFor="lead-name">Name</Label><Input id="lead-name" value={form.name} onChange={set('name')} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="lead-phone">Phone</Label><Input id="lead-phone" type="tel" value={form.phone} onChange={set('phone')} /></div>
        <div className="space-y-2"><Label htmlFor="lead-email">Email</Label><Input id="lead-email" type="email" value={form.email} onChange={set('email')} /></div>
      </div>
      <SelectBox id="lead-source" label="How did they get in touch?" value={form.source} onChange={(value) => setForm({ ...form, source: value })} options={['WALK_IN', 'PHONE', 'REFERRAL'].map((s) => ({ value: s, label: humanize(s) }))} />
      <div className="space-y-2"><Label htmlFor="lead-message">Notes</Label><Input id="lead-message" value={form.message} onChange={set('message')} /></div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => { void submit(); }}>{create.isPending ? 'Adding…' : 'Add lead'}</Button></DialogFooter>
    </Modal>
  );
}

function UpdateDialog({ lead, onClose }: { lead: LeadListItem | null; onClose: () => void }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useOpsMutation<unknown, { id: string; status?: string; lostReason?: string }>('patch', ['crm'], (v) => `/crm/leads/${v.id}`);
  const addNote = useOpsMutation<unknown, { id: string; type: string; body: string }>('post', ['crm'], (v) => `/crm/leads/${v.id}/activities`);
  async function submit() {
    if (!lead) return;
    setError(null);
    if (status === 'LOST' && !reason.trim()) return setError('Say why the lead was lost.');
    if (!status && !note.trim()) return setError('Choose a new status or write a note.');
    try {
      if (status) await update.mutateAsync({ id: lead.id, status, ...(status === 'LOST' ? { lostReason: reason.trim() } : {}) });
      if (note.trim()) await addNote.mutateAsync({ id: lead.id, type: 'NOTE', body: note.trim() });
      toast.success('Lead updated'); setStatus(''); setReason(''); setNote(''); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the lead.'); }
  }
  return (
    <Modal open={Boolean(lead)} title={`Update ${lead?.name ?? ''}`} description={lead ? `Currently ${humanize(lead.status).toLowerCase()}.` : undefined} onClose={onClose}>
      <SelectBox id="lead-status" label="Move to" value={status} onChange={setStatus} options={[{ value: '', label: 'Keep current status' }, ...['CONTACTED', 'QUOTED', 'LOST'].filter((s) => s !== lead?.status).map((s) => ({ value: s, label: humanize(s) }))]} />
      {status === 'LOST' && <div className="space-y-2"><Label htmlFor="lead-reason">Why was it lost?</Label><Input id="lead-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>}
      <div className="space-y-2"><Label htmlFor="lead-note">Add a note</Label><Input id="lead-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={update.isPending || addNote.isPending} onClick={() => { void submit(); }}>Save</Button></DialogFooter>
    </Modal>
  );
}

function ConvertDialog({ lead, onClose }: { lead: LeadListItem | null; onClose: () => void }) {
  const plans = usePlans();
  const [planId, setPlanId] = useState('');
  const [method, setMethod] = useState('UPI');
  const [error, setError] = useState<string | null>(null);
  const convert = useOpsMutation<unknown, { id: string; planId: string; paymentMethod: string }>('post', ['crm', 'members', 'invoices', 'reports'], (v) => `/crm/leads/${v.id}/convert`);
  const chosen = planId || lead?.interestedPlan?.id || plans.data?.[0]?.id || '';
  async function submit() {
    if (!lead) return;
    setError(null);
    try { await convert.mutateAsync({ id: lead.id, planId: chosen, paymentMethod: method }); toast.success(`${lead.name} is now a member`); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not convert the lead.'); }
  }
  return (
    <Modal open={Boolean(lead)} title={`Convert ${lead?.name ?? ''} to a member`} description="Registers the member, takes the first payment and creates the paid invoice." onClose={onClose}>
      <SelectBox id="convert-plan" label="Plan" value={chosen} onChange={setPlanId} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
      <SelectBox id="convert-method" label="Paid by" value={method} onChange={setMethod} options={[{ value: 'UPI', label: 'UPI' }, { value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }]} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={convert.isPending || !chosen} onClick={() => { void submit(); }}>{convert.isPending ? 'Converting…' : 'Convert'}</Button></DialogFooter>
    </Modal>
  );
}

export default function CrmPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('crm:read');
  const canManage = hasPermission('crm:manage');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LeadListItem | null>(null);
  const [converting, setConverting] = useState<LeadListItem | null>(null);
  const summary = useOpsQuery<CrmSummary>(['crm', 'summary'], '/crm/summary', { enabled: allowed, refetchMs: 30000 });
  const leads = useOpsQuery<Page<LeadListItem>>(['crm', 'leads', status, page], `/crm/leads${qs({ status, page, limit: 20 })}`, { enabled: allowed });
  if (!user) return null;
  if (!allowed) return <NoAccess what="the leads pipeline" />;
  const rows = leads.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Enquiries, walk-ins and trials, from first contact to member." actions={canManage ? <Button onClick={() => setCreating(true)}>New lead</Button> : undefined} />
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="New" value={summary.data.byStatus.NEW} />
          <Stat label="Follow-ups due" value={summary.data.dueToday} hint={`${summary.data.overdue} overdue`} />
          <Stat label="Quoted" value={summary.data.byStatus.QUOTED} />
          <Stat label="Won" value={summary.data.byStatus.WON} />
          <Stat label="Conversion" value={`${Math.round(summary.data.conversionRatePct * 10) / 10}%`} />
        </div>
      )}
      <SelectBox id="lead-filter" label="Show" className="max-w-xs" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={stages.map((s) => ({ value: s, label: s ? humanize(s) : 'All leads' }))} />
      <QueryState query={{ ...leads, isEmpty: rows.length === 0 }} empty={{ title: 'No leads here', description: 'New enquiries and trial bookings from the website land here automatically.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead><TableHead>Interested in</TableHead><TableHead>Status</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{lead.name}{lead.message && <div className="max-w-56 truncate text-xs font-normal text-muted-foreground">{lead.message}</div>}</TableCell>
                <TableCell className="text-sm">{lead.phone ?? '—'}<div className="text-xs text-muted-foreground">{lead.email}</div></TableCell>
                <TableCell>{humanize(lead.source)}</TableCell>
                <TableCell>{lead.interestedPlan?.name ?? '—'}</TableCell>
                <TableCell><Badge variant={variant[lead.status]}>{humanize(lead.status)}</Badge></TableCell>
                <TableCell className="tabular">{formatDate(lead.createdAt)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {canManage && !['WON', 'LOST'].includes(lead.status) && <><Button size="sm" variant="outline" onClick={() => setEditing(lead)}>Update</Button><Button size="sm" onClick={() => setConverting(lead)}>Convert</Button></>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager meta={leads.data?.meta} onPage={setPage} />
      </QueryState>
      <NewLeadDialog open={creating} onClose={() => setCreating(false)} />
      <UpdateDialog key={`u-${editing?.id}`} lead={editing} onClose={() => setEditing(null)} />
      <ConvertDialog key={`c-${converting?.id}`} lead={converting} onClose={() => setConverting(null)} />
    </div>
  );
}

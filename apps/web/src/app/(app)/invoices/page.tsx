'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Invoice, InvoiceDetail, MemberLookupItem , BusinessClient } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs, type Page } from '@/lib/ops';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { MemberSearch } from '@/components/club/member-search';
import { Money } from '@/components/club/money';
import { NoAccess, Pager, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { StatusBadge } from '@/components/club/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEYS = ['invoices', 'reports', 'payments'];

function DetailDialog({ id, onClose, canPay, canVoid }: { id: string | null; onClose: () => void; canPay: boolean; canVoid: boolean }) {
  const detail = useOpsQuery<InvoiceDetail>(['invoices', 'detail', id], `/invoices/${id}`, { enabled: Boolean(id) });
  const [method, setMethod] = useState('UPI');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useOpsMutation<Invoice, { id: string }>('post', KEYS, (v) => `/invoices/${v.id}/send`);
  const pay = useOpsMutation<unknown, { id: string; method: string; amountPaise?: number }>('post', KEYS, (v) => `/invoices/${v.id}/pay`);
  const voidIt = useOpsMutation<Invoice, { id: string; reason: string }>('post', KEYS, (v) => `/invoices/${v.id}/void`);
  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    try { await action(); toast.success(done); setAmount(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'That did not work.'); }
  }
  const invoice = detail.data;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => { if (!open) { setError(null); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{invoice?.invoiceNumber ?? 'Invoice'}</DialogTitle><DialogDescription>{invoice ? `${invoice.billTo.name} · issued ${formatDate(`${invoice.issueDate}T12:00:00+05:30`)} · due ${formatDate(`${invoice.dueDate}T12:00:00+05:30`)}` : 'Loading…'}</DialogDescription></DialogHeader>
        <QueryState query={detail}>
          {invoice && <>
            <Table>
              <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>{invoice.lines.map((line, i) => <TableRow key={i}><TableCell>{line.description}</TableCell><TableCell className="text-right tabular">{line.qty}</TableCell><TableCell className="text-right"><Money paise={line.unitPricePaise} /></TableCell><TableCell className="text-right"><Money paise={line.lineTotalPaise} /></TableCell></TableRow>)}</TableBody>
            </Table>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Includes tax</dt><dd><Money paise={invoice.taxPaise} /></dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd><Money paise={invoice.totalPaise} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd><Money paise={invoice.paidPaise} /></dd></div>
              <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd><Money paise={invoice.balancePaise} /></dd></div>
            </dl>
            {invoice.payments.length > 0 && <ul className="divide-y text-sm">{invoice.payments.map((p) => <li key={p.id} className="flex justify-between py-1"><span>{humanize(p.method)} · {formatDateTime(p.paidAt)}</span><Money paise={p.amountPaise} /></li>)}</ul>}
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {invoice.status === 'DRAFT' && <Button onClick={() => { void run(() => send.mutateAsync({ id: invoice.id }), 'Invoice sent'); }} disabled={send.isPending}>Mark as sent</Button>}
            {invoice.status === 'SENT' && canPay && (
              <div className="flex flex-wrap items-end gap-3 border-t pt-3">
                <SelectBox id="inv-method" label="Method" className="w-32" value={method} onChange={setMethod} options={[{ value: 'UPI', label: 'UPI' }, { value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }]} />
                <div className="space-y-2"><Label htmlFor="inv-amount">Amount in ₹ (blank = full balance)</Label><Input id="inv-amount" className="w-40" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
                <Button disabled={pay.isPending} onClick={() => { const rupees = Number(amount); void run(() => pay.mutateAsync({ id: invoice.id, method, ...(amount.trim() && Number.isFinite(rupees) && rupees > 0 ? { amountPaise: Math.round(rupees * 100) } : {}) }), 'Payment recorded'); }}>Take payment</Button>
              </div>
            )}
          </>}
        </QueryState>
        <DialogFooter>
          {invoice && canVoid && ['DRAFT', 'SENT'].includes(invoice.status) && invoice.paidPaise === 0 && <Button variant="ghost" onClick={() => { const reason = window.prompt('Why is this invoice being voided?'); if (reason?.trim()) void run(() => voidIt.mutateAsync({ id: invoice.id, reason: reason.trim() }), 'Invoice voided'); }}>Void invoice</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientDialog({ client, open, onClose }: { client: BusinessClient | null; open: boolean; onClose: () => void }) {
  const editing = Boolean(client);
  const [form, setForm] = useState({ companyName: client?.companyName ?? '', contactName: client?.contactName ?? '', email: client?.email ?? '', phone: client?.phone ?? '', gstin: client?.gstin ?? '', billingAddress: client?.billingAddress ?? '' });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<BusinessClient, object>('post', ['invoices'], () => '/business-clients');
  const update = useOpsMutation<BusinessClient, { id: string; [key: string]: unknown }>('put', ['invoices'], (v) => `/business-clients/${v.id}`);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit() {
    setError(null);
    if (!form.companyName.trim()) return setError('Enter the company name.');
    const body = Object.fromEntries(Object.entries({ companyName: form.companyName, contactName: form.contactName, email: form.email, phone: form.phone, gstin: form.gstin, billingAddress: form.billingAddress }).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => k === 'companyName' || v !== ''));
    try {
      if (client) await update.mutateAsync({ id: client.id, ...body }); else await create.mutateAsync(body);
      toast.success(editing ? 'Client updated' : 'Client added'); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the client.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={editing ? `Edit ${client?.companyName}` : 'New business client'} description="Companies you invoice instead of individual members." onSubmit={submit} submitLabel={editing ? 'Save changes' : 'Add client'} pending={create.isPending || update.isPending} error={error}>
      <Field id="client-company" label="Company name" value={form.companyName} onChange={set('companyName')} autoComplete="organization" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="client-contact" label="Contact person" value={form.contactName} onChange={set('contactName')} />
        <Field id="client-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="client-email" label="Email" type="email" value={form.email} onChange={set('email')} />
        <Field id="client-gstin" label="GSTIN" value={form.gstin} onChange={set('gstin')} />
      </div>
      <Field id="client-address" label="Billing address" value={form.billingAddress} onChange={set('billingAddress')} />
    </FormDialog>
  );
}

function ClientsDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const clients = useOpsQuery<Page<BusinessClient>>(['invoices', 'clients', 'manage'], '/business-clients?limit=100', { enabled: open });
  const [editing, setEditing] = useState<BusinessClient | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = clients.data?.data ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Business clients</DialogTitle><DialogDescription>Companies you bill. The balance is what they still owe on sent invoices.</DialogDescription></DialogHeader>
        {canEdit && <div><Button size="sm" onClick={() => setCreating(true)}>New client</Button></div>}
        <QueryState query={{ ...clients, isEmpty: rows.length === 0 }} empty={{ title: 'No business clients yet', description: 'Add a company to invoice it.' }}>
          <ul className="divide-y text-sm">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0"><span className="block truncate font-medium">{c.companyName}</span><span className="block truncate text-xs text-muted-foreground">{[c.contactName, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
                <span className="flex items-center gap-3"><span className="tabular text-right"><Money paise={c.openBalancePaise} /></span>{canEdit && <Button size="sm" variant="outline" aria-label={`Edit ${c.companyName}`} onClick={() => setEditing(c)}>Edit</Button>}</span>
              </li>
            ))}
          </ul>
        </QueryState>
        <ClientDialog key={`n-${creating}`} client={null} open={creating} onClose={() => setCreating(false)} />
        <ClientDialog key={`e-${editing?.id ?? 'none'}`} client={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clients = useOpsQuery<Page<BusinessClient>>(['invoices', 'clients'], '/business-clients?limit=100', { enabled: open });
  const [kind, setKind] = useState<'MEMBER' | 'CLIENT'>('MEMBER');
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [clientId, setClientId] = useState('');
  const [lines, setLines] = useState([{ description: '', qty: '1', price: '' }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Invoice, object>('post', KEYS, () => '/invoices');
  const client = clientId || clients.data?.data[0]?.id || '';
  const setLine = (i: number, key: 'description' | 'qty' | 'price', value: string) => setLines(lines.map((line, index) => (index === i ? { ...line, [key]: value } : line)));
  async function submit() {
    setError(null);
    const parsed = lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unitPricePaise: Math.round(Number(l.price) * 100) }));
    if (kind === 'MEMBER' && !member) return setError('Choose a member.');
    if (kind === 'CLIENT' && !client) return setError('Add a business client first.');
    if (parsed.some((l) => !l.description || !Number.isInteger(l.qty) || l.qty < 1 || !Number.isFinite(l.unitPricePaise) || l.unitPricePaise < 0)) return setError('Each line needs a description, a whole quantity and a price.');
    try {
      await create.mutateAsync({ ...(kind === 'MEMBER' ? { memberId: member!.id } : { businessClientId: client }), lines: parsed, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      toast.success('Draft invoice created'); setLines([{ description: '', qty: '1', price: '' }]); setNotes(''); setMember(null); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create the invoice.'); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New invoice</DialogTitle><DialogDescription>Prices include tax. The invoice starts as a draft.</DialogDescription></DialogHeader>
        <SelectBox id="inv-kind" label="Bill to" value={kind} onChange={(v) => setKind(v as 'MEMBER' | 'CLIENT')} options={[{ value: 'MEMBER', label: 'A member' }, { value: 'CLIENT', label: 'A business client' }]} />
        {kind === 'MEMBER' ? <MemberSearch value={member} onChange={setMember} /> : <SelectBox id="inv-client" label="Business client" value={client} onChange={setClientId} options={(clients.data?.data ?? []).map((c) => ({ value: c.id, label: c.companyName }))} />}
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_110px_auto] items-end gap-2">
              <div className="space-y-1"><Label htmlFor={`l-d-${i}`}>Description</Label><Input id={`l-d-${i}`} value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor={`l-q-${i}`}>Qty</Label><Input id={`l-q-${i}`} inputMode="numeric" value={line.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor={`l-p-${i}`}>Price ₹</Label><Input id={`l-p-${i}`} inputMode="decimal" value={line.price} onChange={(e) => setLine(i, 'price', e.target.value)} /></div>
              <Button variant="ghost" size="sm" disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, index) => index !== i))}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={lines.length >= 50} onClick={() => setLines([...lines, { description: '', qty: '1', price: '' }])}>Add line</Button>
        </div>
        <div className="space-y-2"><Label htmlFor="inv-notes">Notes</Label><Input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.isPending} onClick={() => { void submit(); }}>{create.isPending ? 'Creating…' : 'Create draft'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoicesPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('invoices:read');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const query = useOpsQuery<Page<Invoice>>(['invoices', 'list', status, overdue, page], `/invoices${qs({ status, overdue: overdue ? 'true' : undefined, page, limit: 20 })}`, { enabled: allowed });
  if (!user) return null;
  if (!allowed) return <NoAccess what="invoices" />;
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Bills for members and business clients." actions={<><Button variant="outline" onClick={() => setClientsOpen(true)}>Clients</Button>{hasPermission('invoices:create') && <Button onClick={() => setCreating(true)}>New invoice</Button>}</>} />
      <div className="flex flex-wrap items-end gap-4">
        <SelectBox id="inv-status" label="Status" className="w-44" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All statuses' }, ...['DRAFT', 'SENT', 'PAID', 'VOID'].map((s) => ({ value: s, label: humanize(s) }))]} />
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} /> Overdue only</label>
      </div>
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No invoices', description: 'Create an invoice to bill a member or a company.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Bill to</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell><button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setOpen(invoice.id)}>{invoice.invoiceNumber}</button></TableCell>
                <TableCell>{invoice.billTo.name}<div className="text-xs text-muted-foreground">{humanize(invoice.billTo.type)}</div></TableCell>
                <TableCell className="tabular">{formatDate(`${invoice.dueDate}T12:00:00+05:30`)}</TableCell>
                <TableCell className="text-right"><Money paise={invoice.totalPaise} /></TableCell>
                <TableCell className="text-right"><Money paise={invoice.balancePaise} /></TableCell>
                <TableCell><StatusBadge kind="invoice" value={invoice.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager meta={query.data?.meta} onPage={setPage} />
      </QueryState>
      <DetailDialog key={open ?? 'none'} id={open} onClose={() => setOpen(null)} canPay={hasPermission('payments:create')} canVoid={hasPermission('invoices:update')} />
      <ClientsDialog key={`k-${clientsOpen}`} open={clientsOpen} onClose={() => setClientsOpen(false)} canEdit={hasPermission('invoices:create')} />
      <CreateDialog key={`c-${creating}`} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

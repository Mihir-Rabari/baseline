'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { BusinessClient } from '@packages/validation';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import type { Page } from '@/lib/ops';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { Money } from '@/components/club/money';
import { QueryState } from '@/components/club/ops-bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

/** A button that opens the list of business clients, with add and edit for staff who can invoice. */
export function ClientsButton({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Clients</Button>
      <ClientsDialog key={String(open)} open={open} onClose={() => setOpen(false)} canEdit={canEdit} />
    </>
  );
}

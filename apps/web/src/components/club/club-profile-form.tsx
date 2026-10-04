'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { ClubProfile, PublicClub } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { slugify } from '@/lib/club-site';
import { Field, errorText } from '@/components/club/form-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

function ClubProfileFields({ club, canEdit }: { club: PublicClub; canEdit: boolean }) {
  const [form, setForm] = useState({ name: club.name, tagline: club.tagline, phone: club.phone, address: club.address });
  const [error, setError] = useState<string | null>(null);
  const save = useOpsMutation<ClubProfile, object>('put', ['club', 'public'], () => '/club/profile');
  const dirty = form.name !== club.name || form.tagline !== club.tagline || form.phone !== club.phone || form.address !== club.address;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError('The club needs a name.');
    try { await save.mutateAsync({ name: form.name.trim(), tagline: form.tagline.trim(), phone: form.phone.trim(), address: form.address.trim() }); toast.success('Club details saved'); }
    catch (caught) { setError(errorText(caught, 'Could not save the club details.')); }
  }
  return (
    <form onSubmit={(event) => { void submit(event); }} noValidate className="space-y-4 rounded-lg border p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="club-name" label="Club name" value={form.name} onChange={set('name')} disabled={!canEdit} hint={`The website address is /site/${slugify(form.name) || '…'}`} />
        <Field id="club-tagline" label="Tagline" value={form.tagline} onChange={set('tagline')} disabled={!canEdit} hint="The headline on the website." />
        <Field id="club-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} disabled={!canEdit} />
        <Field id="club-address" label="Address" value={form.address} onChange={set('address')} disabled={!canEdit} />
      </div>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {canEdit && <div className="flex items-center gap-3"><Button type="submit" disabled={!dirty} loading={save.isPending}>{save.isPending ? 'Saving…' : 'Save details'}</Button>{club.name && <a className="text-sm underline-offset-4 hover:underline" href={`/site/${slugify(club.name)}`} target="_blank" rel="noreferrer">View the website</a>}</div>}
    </form>
  );
}

/** The club's public name, tagline, phone and address; the owner can edit them. */
export function ClubProfileSection() {
  const { hasPermission, isRoot } = useAuth();
  const club = useOpsQuery<PublicClub>(['club', 'info'], '/public/club');
  if (!club.data) return null;
  return (
    <section className="space-y-3" aria-label="Club details">
      <h2 className="text-lg font-semibold">The club</h2>
      <ClubProfileFields key={`${club.data.name}|${club.data.tagline}|${club.data.phone}|${club.data.address}`} club={club.data} canEdit={isRoot || hasPermission('courts:update')} />
    </section>
  );
}

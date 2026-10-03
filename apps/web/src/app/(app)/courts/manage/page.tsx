'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { Court, CourtType, DeleteCourtResponse } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { SportsManager } from '@/components/club/sports-manager';
import { ConfirmRemoveDialog } from '@/components/club/confirm-remove-dialog';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { NoAccess, QueryState, SelectBox } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEYS = ['courts', 'availability'];

function CourtDialog({ court, types, open, onClose }: { court: Court | null; types: CourtType[]; open: boolean; onClose: () => void }) {
  const usable = types.filter((type) => type.isActive || type.id === court?.courtTypeId);
  const [name, setName] = useState(court?.name ?? '');
  const [typeId, setTypeId] = useState(court?.courtTypeId ?? usable[0]?.id ?? '');
  const [order, setOrder] = useState(String(court?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Court, object>('post', KEYS, () => '/courts');
  const update = useOpsMutation<Court, { id: string; [key: string]: unknown }>('put', KEYS, (v) => `/courts/${v.id}`);
  async function submit() {
    setError(null);
    const sortOrder = Number(order);
    if (!name.trim()) return setError('Enter the court name.');
    if (!typeId) return setError('Choose the sport.');
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) return setError('Display order must be a whole number from 0 to 1000.');
    try {
      const body = { name: name.trim(), courtTypeId: typeId, sortOrder };
      if (court) await update.mutateAsync({ id: court.id, ...body });
      else await create.mutateAsync(body);
      toast.success(court ? `${name.trim()} updated` : `${name.trim()} added`); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the court.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={court ? `Edit ${court.name}` : 'New court'} description="Courts are booked by sport, so the sport sets the price. Courts show in the booking grid in display order." onSubmit={submit} submitLabel={court ? 'Save changes' : 'Add court'} pending={create.isPending || update.isPending} error={error}>
      <Field id="court-name" label="Name" value={name} maxLength={64} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectBox id="court-sport" label="Sport" value={typeId} onChange={setTypeId} options={usable.map((type) => ({ value: type.id, label: type.name }))} />
        <Field id="court-order" label="Display order" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} hint="Lower numbers come first." />
      </div>
    </FormDialog>
  );
}

export default function ManageCourtsPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('courts:update');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Court | null>(null);
  const [removing, setRemoving] = useState<Court | null>(null);
  const courts = useOpsQuery<Court[]>(['courts', 'manage'], '/courts', { enabled: allowed });
  const types = useOpsQuery<CourtType[]>(['courts', 'types'], '/court-types', { enabled: allowed });
  const toggle = useOpsMutation<Court, { id: string; isActive: boolean }>('put', KEYS, (v) => `/courts/${v.id}`);
  const remove = useOpsMutation<DeleteCourtResponse, { id: string }>('delete', KEYS, (v) => `/courts/${v.id}`);
  if (!user) return null;
  if (!allowed) return <NoAccess what="court management" />;
  const list = courts.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Manage courts" description="Add, rename, reorder, switch off or remove the courts members can book."
        actions={<><Button asChild variant="outline"><Link href="/courts">Back to booking</Link></Button><Button disabled={!types.data?.length} onClick={() => setCreating(true)}>New court</Button></>} />
      <QueryState query={{ ...courts, isEmpty: list.length === 0 }} empty={{ title: 'No courts yet', description: 'Add the first court so members can book it.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Court</TableHead><TableHead>Sport</TableHead><TableHead className="text-right">Hourly rate</TableHead><TableHead>Order</TableHead><TableHead>Bookable</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((court) => (
              <TableRow key={court.id}>
                <TableCell className="font-medium">{court.name}</TableCell>
                <TableCell>{court.typeName}</TableCell>
                <TableCell className="text-right"><Money paise={court.baseRatePaise} /></TableCell>
                <TableCell className="tabular">{court.sortOrder ?? 0}</TableCell>
                <TableCell>
                  <Switch checked={court.isActive} aria-label={`${court.name} bookable`} disabled={toggle.isPending}
                    onCheckedChange={(isActive) => { void toggle.mutateAsync({ id: court.id, isActive }).then(() => toast.success(`${court.name} ${isActive ? 'is bookable again' : 'switched off'}`)).catch((e: Error) => toast.error(e.message)); }} />
                  {!court.isActive && <Badge variant="outline" className="ml-2">Off</Badge>}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" aria-label={`Edit ${court.name}`} onClick={() => setEditing(court)}>Edit</Button>
                  <Button size="sm" variant="outline" aria-label={`Remove ${court.name}`} onClick={() => setRemoving(court)}>Remove</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      {types.data && <SportsManager sports={types.data} />}
      <CourtDialog key={`n-${creating}`} court={null} types={types.data ?? []} open={creating} onClose={() => setCreating(false)} />
      <CourtDialog key={`e-${editing?.id ?? 'none'}`} court={editing} types={types.data ?? []} open={Boolean(editing)} onClose={() => setEditing(null)} />
      <ConfirmRemoveDialog open={Boolean(removing)} title={`Remove ${removing?.name ?? 'court'}?`}
        description="A court that has never been booked is deleted. One with booking history is switched off instead, so past bookings and reports stay intact. Courts with upcoming bookings cannot be removed."
        onConfirm={async () => {
          if (!removing) return;
          const result = await remove.mutateAsync({ id: removing.id });
          toast.success(result.deactivated ? `${removing.name} has booking history, so it was switched off` : `${removing.name} removed`);
        }}
        onClose={() => setRemoving(null)} />
    </div>
  );
}

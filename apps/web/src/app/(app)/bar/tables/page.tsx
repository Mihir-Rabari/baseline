'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { BarTable, DeleteBarTableResponse } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { ConfirmRemoveDialog } from '@/components/club/confirm-remove-dialog';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { NoAccess, QueryState } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KEYS = ['bar'];

function TableDialog({ table, open, onClose }: { table: BarTable | null; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(table?.name ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<BarTable, object>('post', KEYS, () => '/bar/tables');
  const update = useOpsMutation<BarTable, { id: string; [key: string]: unknown }>('put', KEYS, (v) => `/bar/tables/${v.id}`);
  async function submit() {
    setError(null);
    const count = Number(seats);
    if (!name.trim()) return setError('Enter the table name, for example T7.');
    if (!Number.isInteger(count) || count < 1 || count > 50) return setError('Seats must be a whole number from 1 to 50.');
    try {
      const body = { name: name.trim(), seats: count };
      if (table) await update.mutateAsync({ id: table.id, ...body });
      else await create.mutateAsync(body);
      toast.success(table ? `${name.trim()} updated` : `${name.trim()} added to the floor`); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the table.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={table ? `Edit ${table.name}` : 'New table'} description="Staff open tabs against tables on the bar floor." onSubmit={submit} submitLabel={table ? 'Save changes' : 'Add table'} pending={create.isPending || update.isPending} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="table-name" label="Name" value={name} maxLength={32} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        <Field id="table-seats" label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
      </div>
    </FormDialog>
  );
}

export default function BarTablesPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('bar:manage') && hasPermission('reports:read');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BarTable | null>(null);
  const [removing, setRemoving] = useState<BarTable | null>(null);
  const tables = useOpsQuery<BarTable[]>(['bar', 'tables', 'all'], '/bar/tables?includeInactive=true', { enabled: allowed });
  const toggle = useOpsMutation<BarTable, { id: string; isActive: boolean }>('put', KEYS, (v) => `/bar/tables/${v.id}`);
  const remove = useOpsMutation<DeleteBarTableResponse, { id: string }>('delete', KEYS, (v) => `/bar/tables/${v.id}`);
  if (!user) return null;
  if (!allowed) return <NoAccess what="bar table management" />;
  const list = tables.data ?? [];
  return (
    <div className="space-y-8">
      <PageHeader title="Manage tables" description="Add, rename, resize, switch off or remove the tables on the bar floor."
        actions={<><Button asChild variant="outline"><Link href="/bar">Back to floor</Link></Button><Button onClick={() => setCreating(true)}>New table</Button></>} />
      <QueryState query={{ ...tables, isEmpty: list.length === 0 }} empty={{ title: 'No tables yet', description: 'Add the first table to start opening tabs.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Table</TableHead><TableHead>Seats</TableHead><TableHead>Status</TableHead><TableHead>In use</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {list.map((table) => (
              <TableRow key={table.id}>
                <TableCell className="font-medium">{table.name}</TableCell>
                <TableCell className="tabular">{table.seats}</TableCell>
                <TableCell>{table.status === 'OCCUPIED' ? <Badge variant="warning">Occupied · #{table.openTab?.tabNumber}</Badge> : <Badge variant="outline">Free</Badge>}</TableCell>
                <TableCell>
                  <Switch checked={table.isActive ?? true} aria-label={`${table.name} in use`} disabled={toggle.isPending}
                    onCheckedChange={(isActive) => { void toggle.mutateAsync({ id: table.id, isActive }).then(() => toast.success(`${table.name} ${isActive ? 'is back on the floor' : 'taken off the floor'}`)).catch((e: Error) => toast.error(e.message)); }} />
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" aria-label={`Edit ${table.name}`} onClick={() => setEditing(table)}>Edit</Button>
                  <Button size="sm" variant="outline" aria-label={`Remove ${table.name}`} onClick={() => setRemoving(table)}>Remove</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      <TableDialog key={`n-${creating}`} table={null} open={creating} onClose={() => setCreating(false)} />
      <TableDialog key={`e-${editing?.id ?? 'none'}`} table={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
      <ConfirmRemoveDialog open={Boolean(removing)} title={`Remove ${removing?.name ?? 'table'}?`}
        description="A table that has never hosted a tab is deleted. One with past tabs is taken off the floor instead, so old bills keep their table. A table with an open tab cannot be removed."
        onConfirm={async () => {
          if (!removing) return;
          const result = await remove.mutateAsync({ id: removing.id });
          toast.success(result.deactivated ? `${removing.name} has past tabs, so it was taken off the floor` : `${removing.name} removed`);
        }}
        onClose={() => setRemoving(null)} />
    </div>
  );
}

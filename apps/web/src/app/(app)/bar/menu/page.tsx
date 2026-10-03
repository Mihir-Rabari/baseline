'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { MenuItem } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { CheckField, Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { ImageUploader } from '@/components/club/image-uploader';
import { NoAccess, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { categoryName, categoryOptions, useCategories } from '@/hooks/use-categories';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATIONS = ['BAR', 'KITCHEN'];

function MenuItemDialog({ item, open, onClose }: { item: MenuItem | null; open: boolean; onClose: () => void }) {
  const editing = Boolean(item);
  const categories = useCategories('MENU');
  const [form, setForm] = useState({ name: item?.name ?? '', category: item?.category ?? '', station: item?.station ?? 'BAR', price: item ? fromPaise(item.pricePaise) : '', discountable: item?.discountable ?? true, isAvailable: item?.isAvailable ?? true, imageUrl: (item?.imageUrl ?? null) as string | null });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<MenuItem, object>('post', ['bar'], () => '/bar/menu');
  const update = useOpsMutation<MenuItem, { id: string; [key: string]: unknown }>('put', ['bar'], (v) => `/bar/menu/${v.id}`);
  async function submit() {
    setError(null);
    const pricePaise = toPaise(form.price);
    if (!form.name.trim()) return setError('Enter the item name.');
    if (!form.category) return setError('Choose a category.');
    if (!Number.isFinite(pricePaise) || pricePaise <= 0) return setError('Enter a price above zero, in rupees.');
    try {
      const base = { name: form.name.trim(), category: form.category, station: form.station, pricePaise, discountable: form.discountable, ...(editing || form.imageUrl ? { imageUrl: form.imageUrl } : {}) };
      if (item) await update.mutateAsync({ id: item.id, ...base, isAvailable: form.isAvailable });
      else await create.mutateAsync(base);
      toast.success(editing ? `${form.name.trim()} updated` : `${form.name.trim()} added to the menu`); onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the menu item.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={editing ? `Edit ${item?.name}` : 'New menu item'} description="Prices are what the guest pays. The station decides whether it goes to the bar or the kitchen." onSubmit={submit} submitLabel={editing ? 'Save changes' : 'Add to menu'} pending={create.isPending || update.isPending} error={error}>
      <ImageUploader kind="menu" label="Item photo" value={form.imageUrl} onChange={(imageUrl) => setForm({ ...form, imageUrl })} />
      <Field id="menu-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectBox id="menu-category" label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categoryOptions(categories.data, form.category)} />
        <SelectBox id="menu-station" label="Made at" value={form.station} onChange={(v) => setForm({ ...form, station: v })} options={STATIONS.map((s) => ({ value: s, label: humanize(s) }))} />
        <Field id="menu-price" label="Price (₹)" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      </div>
      <CheckField id="menu-discountable" label="Members get their bar discount on this" checked={form.discountable} onChange={(v) => setForm({ ...form, discountable: v })} />
      {editing && <CheckField id="menu-available" label="Available to order" checked={form.isAvailable} onChange={(v) => setForm({ ...form, isAvailable: v })} hint="Switch off when it has run out." />}
    </FormDialog>
  );
}

export default function BarMenuPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('bar:read');
  const canEdit = hasPermission('bar:manage') && hasPermission('reports:read');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const categories = useCategories('MENU', { enabled: allowed });
  const menu = useOpsQuery<MenuItem[]>(['bar', 'menu', 'all'], '/bar/menu', { enabled: allowed });
  const toggle = useOpsMutation<MenuItem, { id: string; isAvailable: boolean }>('put', ['bar'], (v) => `/bar/menu/${v.id}`);
  if (!user) return null;
  if (!allowed) return <NoAccess what="the bar menu" />;
  const rows = (menu.data ?? []).filter((m) => !category || m.category === category);
  return (
    <div className="space-y-8">
      <PageHeader title="Bar menu" description={canEdit ? 'What the bar and kitchen sell. Switch an item off when it runs out.' : 'What the bar and kitchen sell. Only the owner can change the menu.'} actions={canEdit ? <Button onClick={() => setCreating(true)}>New item</Button> : undefined} />
      <SelectBox id="menu-filter" label="Category" className="max-w-xs" value={category} onChange={setCategory} options={[{ value: '', label: 'All categories' }, ...categoryOptions(categories.data, category)]} />
      <QueryState query={{ ...menu, isEmpty: rows.length === 0 }} empty={{ title: 'Nothing on the menu', description: canEdit ? 'Add the first item.' : 'The owner has not added items yet.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Made at</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Available</TableHead>{canEdit && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}{!item.discountable && <Badge variant="outline" className="ml-2">No discount</Badge>}</TableCell>
                <TableCell>{categoryName(categories.data, item.category)}</TableCell>
                <TableCell>{humanize(item.station)}</TableCell>
                <TableCell className="text-right"><Money paise={item.pricePaise} /></TableCell>
                <TableCell>{canEdit ? <Switch checked={item.isAvailable} aria-label={`${item.name} available`} onCheckedChange={(next) => { void toggle.mutateAsync({ id: item.id, isAvailable: next }).then(() => toast.success(`${item.name} ${next ? 'back on the menu' : 'switched off'}`)).catch((e: Error) => toast.error(e.message)); }} /> : <Badge variant={item.isAvailable ? 'success' : 'outline'}>{item.isAvailable ? 'Available' : 'Off'}</Badge>}</TableCell>
                {canEdit && <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}>Edit</Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      <MenuItemDialog key={`n-${creating}`} item={null} open={creating} onClose={() => setCreating(false)} />
      <MenuItemDialog key={`e-${editing?.id ?? 'none'}`} item={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
    </div>
  );
}

'use client';

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Category, CategoryScope } from '@packages/validation';
import { useCategories, CATEGORY_PATHS } from '@/hooks/use-categories';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { QueryState } from '@/components/club/ops-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SCOPE_COPY: Record<CategoryScope, { noun: string; plural: string; used: string }> = {
  PRODUCT: { noun: 'product category', plural: 'product categories', used: 'products' },
  MENU: { noun: 'menu category', plural: 'menu categories', used: 'menu items' },
};

/** Lets the code be typed as a name: "Pro shop" becomes PRO_SHOP. */
const codeFromName = (name: string) =>
  name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+|_+$/g, '').slice(0, 16);

function CategoryDialog({ scope, category, open, onClose }: { scope: CategoryScope; category: Category | null; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [code, setCode] = useState(category?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(false);
  const [order, setOrder] = useState(String(category?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Category, object>('post', ['categories'], () => CATEGORY_PATHS[scope]);
  const update = useOpsMutation<Category, { id: string; [key: string]: unknown }>('put', ['categories'], (v) => `${CATEGORY_PATHS[scope]}/${v.id}`);
  async function submit() {
    setError(null);
    const sortOrder = Number(order);
    if (!name.trim()) return setError('Enter a name.');
    if (!category && !/^[A-Z][A-Z0-9_]{1,15}$/.test(code)) return setError('The code needs 2 to 16 capital letters, digits or underscores, starting with a letter.');
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) return setError('Display order must be a whole number from 0 to 1000.');
    try {
      if (category) await update.mutateAsync({ id: category.id, name: name.trim(), sortOrder });
      else await create.mutateAsync({ code, name: name.trim(), sortOrder });
      toast.success(category ? `${name.trim()} updated` : `${name.trim()} added`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the category.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={category ? `Edit ${category.name}` : `New ${SCOPE_COPY[scope].noun}`} description="The name is what people see. The code is stored on each item and cannot change later." onSubmit={submit} submitLabel={category ? 'Save changes' : 'Add category'} pending={create.isPending || update.isPending} error={error}>
      <Field id="category-name" label="Name" value={name} maxLength={48} autoComplete="off" onChange={(e) => { setName(e.target.value); if (!category && !codeTouched) setCode(codeFromName(e.target.value)); }} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="category-code" label="Code" value={code} maxLength={16} disabled={Boolean(category)} autoComplete="off" onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toUpperCase()); }} hint={category ? 'Fixed once created.' : 'Capital letters, digits and underscores.'} />
        <Field id="category-order" label="Display order" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} hint="Lower numbers come first." />
      </div>
    </FormDialog>
  );
}

/** List, search, add, edit and switch off the categories of one list. Callers decide who may see it. */
export function CategoryManager({ scope }: { scope: CategoryScope }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const list = useCategories(scope, { includeInactive: true });
  const usage = useOpsQuery<Record<string, number>>(['categories', scope, 'usage'], `${CATEGORY_PATHS[scope]}/usage`);
  const toggle = useOpsMutation<Category, { id: string; isActive: boolean }>('put', ['categories'], (v) => `${CATEGORY_PATHS[scope]}/${v.id}`);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle));
  }, [list.data, q]);
  const copy = SCOPE_COPY[scope];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs space-y-2">
          <label htmlFor={`category-search-${scope}`} className="text-sm font-medium">Search {copy.plural}</label>
          <Input id={`category-search-${scope}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or code" autoComplete="off" />
        </div>
        <Button onClick={() => setCreating(true)}>New {copy.noun}</Button>
      </div>
      <QueryState query={{ ...list, isEmpty: rows.length === 0 }} empty={{ title: q ? 'No categories match' : `No ${copy.plural} yet`, description: q ? 'Try another name or code.' : 'Add the first one.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead className="text-right">In use</TableHead><TableHead>Order</TableHead><TableHead>Active</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}{!c.isActive && <Badge variant="outline" className="ml-2">Off</Badge>}</TableCell>
                <TableCell className="font-mono text-xs">{c.code}</TableCell>
                <TableCell className="tabular text-right">{usage.data?.[c.code] ?? 0} {copy.used}</TableCell>
                <TableCell className="tabular">{c.sortOrder}</TableCell>
                <TableCell><Switch checked={c.isActive} aria-label={`${c.name} active`} onCheckedChange={(next) => { void toggle.mutateAsync({ id: c.id, isActive: next }).then(() => toast.success(`${c.name} ${next ? 'switched on' : 'switched off'}`)).catch((e: Error) => toast.error(e.message)); }} /></TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>Edit</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
      <p className="text-xs text-muted-foreground">Switching a category off hides it from new items. Existing {copy.used} keep it.</p>
      <CategoryDialog key={`n-${creating}`} scope={scope} category={null} open={creating} onClose={() => setCreating(false)} />
      <CategoryDialog key={`e-${editing?.id ?? 'none'}`} scope={scope} category={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
    </div>
  );
}

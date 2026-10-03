'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { qs, type Page } from '@/lib/ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { Money } from '@/components/club/money';
import { NoAccess, Pager, QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { CheckField, Field, FormDialog, errorText, fromPaise, toPaise } from '@/components/club/form-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const categories = ['', 'RACKET', 'BALL', 'SHOE', 'ACCESSORY', 'APPAREL'];

function StockDialog({ product, canAdjust, onClose }: { product: Product | null; canAdjust: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'restock' | 'adjust'>('restock');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const restock = useOpsMutation<unknown, { id: string; qty: number; note?: string }>('post', ['products'], (v) => `/products/${v.id}/restock`);
  const adjust = useOpsMutation<unknown, { id: string; qtyDelta: number; note: string }>('post', ['products'], (v) => `/products/${v.id}/adjust`);
  const pending = restock.isPending || adjust.isPending;
  function close() { if (pending) return; setQty(''); setNote(''); setError(null); onClose(); }
  async function submit() {
    if (!product) return;
    setError(null);
    const amount = Number(qty);
    if (!Number.isInteger(amount) || amount === 0 || (mode === 'restock' && amount < 0)) { setError(mode === 'restock' ? 'Enter a whole number above zero.' : 'Enter a whole number that is not zero.'); return; }
    if (mode === 'adjust' && !note.trim()) { setError('Say why the count changed.'); return; }
    try {
      if (mode === 'restock') await restock.mutateAsync({ id: product.id, qty: amount, note: note.trim() || undefined });
      else await adjust.mutateAsync({ id: product.id, qtyDelta: amount, note: note.trim() });
      toast.success(`${product.name} stock updated`);
      close();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the stock.'); }
  }
  return (
    <Dialog open={Boolean(product)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Stock for {product?.name}</DialogTitle><DialogDescription>Currently {product?.stockQty} in stock.</DialogDescription></DialogHeader>
        {canAdjust && <SelectBox id="stock-mode" label="Action" value={mode} onChange={(value) => setMode(value as 'restock' | 'adjust')} options={[{ value: 'restock', label: 'Restock (add units)' }, { value: 'adjust', label: 'Correct the count (+ or −)' }]} />}
        <div className="space-y-2"><Label htmlFor="stock-qty">{mode === 'restock' ? 'Units received' : 'Change (use a minus for a loss)'}</Label><Input id="stock-qty" inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="stock-note">{mode === 'restock' ? 'Note (optional)' : 'Reason'}</Label><Input id="stock-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={close}>Cancel</Button><Button disabled={pending} onClick={() => { void submit(); }}>{pending ? 'Saving…' : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ product, open, onClose }: { product: Product | null; open: boolean; onClose: () => void }) {
  const editing = Boolean(product);
  const [form, setForm] = useState({
    sku: product?.sku ?? '', name: product?.name ?? '', category: product?.category ?? 'ACCESSORY', price: product ? fromPaise(product.pricePaise) : '',
    stock: '0', reorder: String(product?.reorderLevel ?? 5), discountable: true,
  });
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<Product, object>('post', ['products', 'reports'], () => '/products');
  const update = useOpsMutation<Product, { id: string; [key: string]: unknown }>('put', ['products', 'reports'], (v) => `/products/${v.id}`);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  async function submit() {
    setError(null);
    const pricePaise = toPaise(form.price);
    const reorderLevel = Number(form.reorder);
    const stockQty = Number(form.stock);
    if (!form.name.trim()) return setError('Enter a product name.');
    if (!form.sku.trim()) return setError('Enter a SKU, the short code used on the shelf label.');
    if (!Number.isFinite(pricePaise)) return setError('Enter the price in rupees, for example 1499 or 1499.50.');
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return setError('The reorder level must be a whole number, zero or more.');
    if (!editing && (!Number.isInteger(stockQty) || stockQty < 0)) return setError('Opening stock must be a whole number, zero or more.');
    try {
      const base = { sku: form.sku.trim(), name: form.name.trim(), category: form.category, pricePaise, reorderLevel };
      if (product) await update.mutateAsync({ id: product.id, ...base });
      else await create.mutateAsync({ ...base, stockQty, discountable: form.discountable });
      toast.success(editing ? `${form.name.trim()} updated` : `${form.name.trim()} added`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the product.')); }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={editing ? `Edit ${product?.name}` : 'New product'} description={editing ? 'Stock changes go through Update stock, so there is a record of each one.' : 'Add something to sell at the counter and online.'} onSubmit={submit} submitLabel={editing ? 'Save changes' : 'Add product'} pending={create.isPending || update.isPending} error={error}>
      <Field id="prod-name" label="Name" value={form.name} onChange={set('name')} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="prod-sku" label="SKU" value={form.sku} onChange={set('sku')} autoComplete="off" />
        <SelectBox id="prod-category" label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value as typeof form.category })} options={categories.slice(1).map((c) => ({ value: c, label: humanize(c) }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="prod-price" label="Price (₹)" inputMode="decimal" value={form.price} onChange={set('price')} />
        {!editing && <Field id="prod-stock" label="Opening stock" inputMode="numeric" value={form.stock} onChange={set('stock')} />}
        <Field id="prod-reorder" label="Reorder level" inputMode="numeric" value={form.reorder} onChange={set('reorder')} hint="Flagged as low at or below this." />
      </div>
      {!editing && <CheckField id="prod-discountable" label="Members get their discount on this" checked={form.discountable} onChange={(value) => setForm({ ...form, discountable: value })} />}
    </FormDialog>
  );
}

export default function InventoryPage() {
  const { user, hasPermission } = useAuth();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useDebounce(search.trim(), 250);
  const allowed = hasPermission('inventory:read');
  const query = useOpsQuery<Page<Product>>(['products', category, q, lowOnly, page], `/products${qs({ category, q: q.length >= 1 ? q : undefined, lowStock: lowOnly ? 'true' : undefined, page, limit: 20 })}`, { enabled: allowed });
  if (!user) return null;
  if (!allowed) return <NoAccess what="inventory" />;
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Shop stock levels. Low stock is at or below the reorder level." actions={hasPermission('products:create') ? <Button onClick={() => setCreating(true)}>New product</Button> : undefined} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2"><Label htmlFor="inv-search">Search</Label><Input id="inv-search" className="w-56" placeholder="Name or SKU" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
        <SelectBox id="inv-category" label="Category" className="w-44" value={category} onChange={(value) => { setCategory(value); setPage(1); }} options={categories.map((c) => ({ value: c, label: c ? humanize(c) : 'All categories' }))} />
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(event) => { setLowOnly(event.target.checked); setPage(1); }} /> Low stock only</label>
      </div>
      <QueryState query={{ ...query, isEmpty: rows.length === 0 }} empty={{ title: 'No products match', description: 'Clear the filters to see everything.' }}>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">In stock</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="tabular text-muted-foreground">{product.sku}</TableCell>
                <TableCell>{humanize(product.category)}</TableCell>
                <TableCell className="text-right"><Money paise={product.pricePaise} /></TableCell>
                <TableCell className="text-right tabular">{product.stockQty}</TableCell>
                <TableCell>{product.stockQty === 0 ? <Badge variant="destructive">Sold out</Badge> : product.lowStock ? <Badge variant="warning">Low</Badge> : <Badge variant="success">In stock</Badge>}</TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" aria-label={`Update stock for ${product.name}`} onClick={() => setTarget(product)}>Update stock</Button>
                  {hasPermission('products:update') && <Button size="sm" variant="ghost" aria-label={`Edit ${product.name}`} onClick={() => setEditing(product)}>Edit</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager meta={query.data?.meta} onPage={setPage} />
      </QueryState>
      <ProductDialog key={`n-${creating}`} product={null} open={creating} onClose={() => setCreating(false)} />
      <ProductDialog key={`e-${editing?.id ?? 'none'}`} product={editing} open={Boolean(editing)} onClose={() => setEditing(null)} />
      <StockDialog key={target?.id ?? 'none'} product={target} canAdjust={hasPermission('inventory:adjust')} onClose={() => setTarget(null)} />
    </div>
  );
}

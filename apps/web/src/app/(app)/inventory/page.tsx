'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useShopProducts, useRestock } from '@/hooks/use-shop';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export default function InventoryPage() {
  const { user, hasPermission } = useAuth(); const allowed = hasPermission('products:read') && hasPermission('inventory:read');
  const [low, setLow] = useState(false); const [selected, setSelected] = useState<Product | null>(null); const [qty, setQty] = useState(''); const [note, setNote] = useState(''); const [formError, setFormError] = useState('');
  const query = useShopProducts({ limit: 100, lowStock: low ? 'true' : undefined }, 'staff', allowed); const restock = useRestock();
  if (!user) return null;
  return <div className="space-y-6"><PageHeader title="Inventory" description="Track the club shop stock and restock products." />{!allowed ? <EmptyState title="Inventory is unavailable" description="Ask the front desk for stock information." /> : <><div className="flex items-center gap-2"><Switch id="low-stock" checked={low} onCheckedChange={setLow} /><Label htmlFor="low-stock">Low stock only</Label></div>{query.error ? <PageError error={query.error} onRetry={() => { query.refetch(); }} /> : query.isPending ? <div role="status" aria-label="Loading inventory"><Skeleton className="h-80" /></div> : !query.data?.data.length ? <EmptyState title="No products match" description="Turn off the low stock filter to see all products." /> : <Table><TableHeader><TableRow>{['SKU', 'Name', 'Category', 'Stock', 'Reorder level', 'Status', ''].map((name) => <TableHead key={name} className={name === 'Stock' ? 'text-right' : undefined}>{name}</TableHead>)}</TableRow></TableHeader><TableBody>{query.data.data.map((entry) => { const p = entry as Product; return <TableRow key={p.id}><TableCell className="font-mono text-xs">{p.sku}</TableCell><TableCell>{p.name}</TableCell><TableCell>{p.category.toLowerCase()}</TableCell><TableCell className="text-right tabular">{p.stockQty}</TableCell><TableCell className="tabular">{p.reorderLevel}</TableCell><TableCell>{p.stockQty === 0 ? <Badge variant="destructive">Out of stock</Badge> : p.lowStock ? <Badge variant="warning">Low</Badge> : null}</TableCell><TableCell>{hasPermission('inventory:adjust') && <Button size="sm" variant="outline" onClick={() => { setSelected(p); setQty(''); setNote(''); setFormError(''); restock.reset(); }}>Restock {p.name}</Button>}</TableCell></TableRow>; })}</TableBody></Table>}</>}
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Restock {selected?.name}</DialogTitle><DialogDescription>Record the quantity received into the shop.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); if (!selected || !hasPermission('inventory:adjust')) return; if (!Number.isInteger(Number(qty)) || Number(qty) <= 0) { setFormError('Enter a whole quantity greater than zero.'); return; } try { await restock.mutateAsync({ id: selected.id, data: { qty: Number(qty), note: note || undefined } }); toast.success('Stock updated'); setSelected(null); } catch { /* Mutation error stays visible for retry. */ } }}><Label htmlFor="restock-qty">Quantity</Label><Input id="restock-qty" type="number" min="1" step="1" value={qty} onChange={(event) => setQty(event.target.value)} /><Label htmlFor="restock-note">Note</Label><Input id="restock-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />{(formError || restock.error) && <p role="alert" className="text-destructive">{formError || restock.error?.message}</p>}<Button disabled={restock.isPending}>Save restock</Button></form></DialogContent></Dialog>
  </div>;
}


'use client';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberLookupItem, PaymentMethod } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useShopProducts, useShopQuote } from '@/hooks/use-shop';
import { useShopCart } from '@/hooks/use-shop-cart';
import { shopApi } from '@/lib/shop-api';
import { MemberSearch } from '@/components/club/member-search';
import { Cart } from '@/components/club/cart';
import { Money } from '@/components/club/money';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
export default function PosPage() {
  const { user, hasPermission } = useAuth(); const allowed = hasPermission('orders:create') && hasPermission('products:read'); const [q, setQ] = useState(''); const [member, setMember] = useState<MemberLookupItem | null>(null);
  const products = useShopProducts({ limit: 100, q }, 'staff', allowed); const cart = useShopCart(); const items = cart.lines.map((line) => ({ productId: line.product.id, qty: line.qty })); const quote = useShopQuote({ items, memberId: member?.id }, allowed); const client = useQueryClient();
  const pay = useMutation({ mutationFn: (paymentMethod: PaymentMethod) => shopApi.pos({ items, memberId: member?.id, paymentMethod }), onSuccess: (order) => { toast.success(`Order ${order.orderNumber} paid`); cart.clear(); setMember(null); client.invalidateQueries({ queryKey: ['products'] }); client.invalidateQueries({ queryKey: ['orders'] }); }, onError: (error) => toast.error(error.message) });
  if (!user) return null;
  return <div className="space-y-6"><PageHeader title="Counter sale" description="Take a shop payment and apply the member discount." />{!allowed ? <EmptyState title="Counter sales are unavailable" description="Ask the front desk to take this payment." /> : <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><section className="space-y-4"><Label htmlFor="pos-search">Search products</Label><Input id="pos-search" value={q} onChange={(event) => setQ(event.target.value)} />{products.error ? <PageError error={products.error} onRetry={() => { products.refetch(); }} /> : products.isPending ? <div role="status" aria-label="Loading products"><Skeleton className="h-64" /></div> : !products.data?.data.length ? <EmptyState title="No products match" /> : <div className="grid gap-3 sm:grid-cols-2">{products.data.data.map((p) => <button key={p.id} className="space-y-2 rounded-md border p-4 text-left disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!p.inStock || pay.isPending} onClick={() => cart.add(p)}><p className="font-medium">{p.name}</p><Money paise={p.pricePaise} />{!p.inStock && <p className="text-sm text-destructive">Sold out</p>}</button>)}</div>}</section><section className="space-y-4 rounded-md border p-4">{hasPermission('members:read') && <MemberSearch value={member} onChange={setMember} disabled={pay.isPending} />}<Cart lines={cart.lines} onQuantity={cart.quantity} quote={quote.data} error={quote.error || pay.error} disabled={pay.isPending} /><div className="flex flex-wrap gap-2">{(['CASH','CARD','UPI'] as const).map((method) => <Button key={method} variant="outline" disabled={!items.length || pay.isPending || quote.isPending || quote.isFetching || Boolean(quote.error) || quote.data?.items.some((line) => !line.inStock)} onClick={() => pay.mutate(method)}>Pay {method === 'CASH' ? 'cash' : method === 'CARD' ? 'card' : 'UPI'}</Button>)}</div></section></div>}</div>;
}

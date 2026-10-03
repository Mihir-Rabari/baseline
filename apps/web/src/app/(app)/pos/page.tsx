'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberLookupItem, Order, QuoteOrderResponse , Product } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { ops, qs, type Page } from '@/lib/ops';
import { PageHeader } from '@/components/app-shell/page-header';
import { MemberSearch } from '@/components/club/member-search';
import { Money } from '@/components/club/money';
import { NoAccess, QueryState } from '@/components/club/ops-bits';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Method = 'CASH' | 'CARD' | 'UPI';

export default function PosPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('orders:create');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [customer, setCustomer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useDebounce(search.trim(), 250);
  const products = useOpsQuery<Page<Product>>(['products', 'pos', q], `/products${qs({ q: q || undefined, inStock: 'true', limit: 60 })}`, { enabled: allowed, refetchMs: 15000 });
  const lines = Object.entries(cart).map(([productId, qty]) => ({ productId, qty }));
  const quote = useQuery({
    queryKey: ['pos-quote', lines, member?.id],
    queryFn: () => ops.post<QuoteOrderResponse>('/orders/quote', { items: lines, ...(member ? { memberId: member.id } : {}) }),
    enabled: allowed && lines.length > 0,
  });
  const sale = useOpsMutation<Order, { items: typeof lines; paymentMethod: Method; memberId?: string; customerName?: string }>('post', ['orders', 'products', 'reports', 'payments'], () => '/orders/pos');
  if (!user) return null;
  if (!allowed) return <NoAccess what="the counter sale screen" />;

  const change = (productId: string, delta: number) => setCart((current) => {
    const next = (current[productId] ?? 0) + delta;
    const copy = { ...current };
    if (next <= 0) delete copy[productId]; else copy[productId] = next;
    return copy;
  });
  const badLine = (productId: string) => quote.data?.items.find((item) => item.productId === productId && !item.inStock);

  async function pay(paymentMethod: Method) {
    setError(null);
    try {
      const order = await sale.mutateAsync({ items: lines, paymentMethod, ...(member ? { memberId: member.id } : {}), ...(customer.trim() ? { customerName: customer.trim() } : {}) });
      toast.success(`Order ${order.orderNumber} paid`);
      setCart({}); setMember(null); setCustomer('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The sale did not go through.');
    }
  }

  const items = products.data?.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Counter sale" description="Tap products to add them, optionally pick a member for their discount, then take payment." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="pos-search">Search products</Label><Input id="pos-search" className="max-w-sm" placeholder="Name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <QueryState query={{ ...products, isEmpty: items.length === 0 }} empty={{ title: 'No products match', description: 'Try a different search.' }}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((product) => (
                <button key={product.id} type="button" onClick={() => change(product.id, 1)} className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block text-sm font-medium">{product.name}</span>
                  <span className="mt-1 block text-sm tabular"><Money paise={member ? product.pricePaise - Math.round((product.pricePaise * (quote.data?.discountPct ?? 0)) / 100) : product.pricePaise} /></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{product.stockQty} in stock</span>
                </button>
              ))}
            </div>
          </QueryState>
        </div>
        <section aria-label="Cart" className="space-y-4 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Cart</h2>
          <MemberSearch value={member} onChange={setMember} disabled={sale.isPending} />
          {!member && <div className="space-y-2"><Label htmlFor="pos-customer">Customer name (optional)</Label><Input id="pos-customer" value={customer} onChange={(event) => setCustomer(event.target.value)} /></div>}
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">The cart is empty.</p> : (
            <ul className="divide-y text-sm">
              {(quote.data?.items ?? lines.map((line) => ({ ...line, name: products.data?.data.find((p) => p.id === line.productId)?.name ?? 'Item', lineTotalPaise: 0, unitPricePaise: 0, discountPct: 0, inStock: true }))).map((line) => (
                <li key={line.productId} className={`flex items-center justify-between gap-2 py-2 ${badLine(line.productId) ? 'text-destructive' : ''}`}>
                  <span className="min-w-0 flex-1 truncate">{line.name}{badLine(line.productId) && <span className="block text-xs">Not enough stock</span>}</span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="outline" aria-label={`Remove one ${line.name}`} onClick={() => change(line.productId, -1)}>−</Button>
                    <span className="w-6 text-center tabular">{cart[line.productId]}</span>
                    <Button size="sm" variant="outline" aria-label={`Add one ${line.name}`} onClick={() => change(line.productId, 1)}>+</Button>
                  </span>
                  <span className="w-20 text-right tabular"><Money paise={line.lineTotalPaise} /></span>
                </li>
              ))}
            </ul>
          )}
          {quote.data && lines.length > 0 && (
            <dl className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd><Money paise={quote.data.subtotalPaise} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Member discount ({quote.data.discountPct}%)</dt><dd>−<Money paise={quote.data.discountPaise} /></dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd><Money paise={quote.data.totalPaise} /></dd></div>
            </dl>
          )}
          {quote.error && <Alert variant="destructive"><AlertDescription>{quote.error.message}</AlertDescription></Alert>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="grid grid-cols-3 gap-2">
            {(['CASH', 'CARD', 'UPI'] as const).map((method) => <Button key={method} disabled={lines.length === 0 || sale.isPending || quote.isFetching || Boolean(quote.error)} onClick={() => { void pay(method); }}>{method === 'CASH' ? 'Cash' : method === 'CARD' ? 'Card' : 'UPI'}</Button>)}
          </div>
          {lines.length > 0 && <Button variant="ghost" className="w-full" disabled={sale.isPending} onClick={() => setCart({})}>Clear cart</Button>}
        </section>
      </div>
    </div>
  );
}

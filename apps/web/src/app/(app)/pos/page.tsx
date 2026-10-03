'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ArrowRight, Receipt } from 'lucide-react';
import type { MemberLookupItem, PaymentMethod, Order } from '@packages/validation';
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
import { OrderDetailDialog } from '@/components/club/order-detail-dialog';

export default function PosPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('orders:create') && hasPermission('products:read');
  const [q, setQ] = useState('');
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const products = useShopProducts({ limit: 100, q }, 'staff', allowed);
  const cart = useShopCart();
  const items = cart.lines.map((line) => ({ productId: line.product.id, qty: line.qty }));
  const quote = useShopQuote({ items, memberId: member?.id }, allowed);
  const client = useQueryClient();

  const pay = useMutation({
    mutationFn: (paymentMethod: PaymentMethod) =>
      shopApi.pos({ items, memberId: member?.id, paymentMethod }),
    onSuccess: (order) => {
      toast.success(`Order ${order.orderNumber} paid`);
      cart.clear();
      setMember(null);
      setLastOrder(order);
      if (order.items && order.items.length > 0) {
        setShowReceipt(true);
      }
      void client.invalidateQueries({ queryKey: ['products'] });
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counter sale"
        description="Take a shop payment and apply the member discount."
      />

      {/* Completed Sale Notification Banner */}
      {lastOrder && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">
                Order <span className="font-mono">{lastOrder.orderNumber}</span> completed successfully
              </p>
              <p className="text-xs text-muted-foreground">
                {lastOrder.totalPaise !== undefined && <Money paise={lastOrder.totalPaise} />}
                {lastOrder.member?.fullName || lastOrder.customerName
                  ? ` · ${lastOrder.member?.fullName ?? lastOrder.customerName}`
                  : ' · Walk-in customer'}{' '}
                · Recorded in Orders
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastOrder.items && lastOrder.items.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setShowReceipt(true)}
              >
                <Receipt className="h-3.5 w-3.5" />
                Receipt
              </Button>
            )}
            <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs">
              <Link href={`/orders?channel=POS&q=${encodeURIComponent(lastOrder.orderNumber)}`}>
                View in orders
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setLastOrder(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {!allowed ? (
        <EmptyState
          title="Counter sales are unavailable"
          description="Ask the front desk to take this payment."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-4">
            <Label htmlFor="pos-search">Search products</Label>
            <Input
              id="pos-search"
              placeholder="Search products by name or SKU..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            {products.error ? (
              <PageError
                error={products.error}
                onRetry={() => {
                  void products.refetch();
                }}
              />
            ) : products.isPending ? (
              <div role="status" aria-label="Loading products">
                <Skeleton className="h-64" />
              </div>
            ) : !products.data?.data.length ? (
              <EmptyState title="No products match" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {products.data.data.map((p) => (
                  <button
                    key={p.id}
                    className="space-y-2 rounded-md border p-4 text-left disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40 transition-colors"
                    disabled={!p.inStock || pay.isPending}
                    onClick={() => cart.add(p)}
                  >
                    <p className="font-medium">{p.name}</p>
                    <Money paise={p.pricePaise} />
                    {!p.inStock && <p className="text-sm text-destructive">Sold out</p>}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-md border p-4">
            {hasPermission('members:read') && (
              <MemberSearch value={member} onChange={setMember} disabled={pay.isPending} />
            )}
            <Cart
              lines={cart.lines}
              onQuantity={cart.quantity}
              quote={quote.data}
              error={quote.error || pay.error}
              disabled={pay.isPending}
            />
            <div className="flex flex-wrap gap-2">
              {(['CASH', 'CARD', 'UPI'] as const).map((method) => (
                <Button
                  key={method}
                  variant="outline"
                  disabled={
                    !items.length ||
                    pay.isPending ||
                    quote.isPending ||
                    quote.isFetching ||
                    Boolean(quote.error) ||
                    quote.data?.items.some((line) => !line.inStock)
                  }
                  onClick={() => pay.mutate(method)}
                >
                  Pay {method === 'CASH' ? 'cash' : method === 'CARD' ? 'card' : 'UPI'}
                </Button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Receipt Dialog */}
      {lastOrder && lastOrder.items && (
        <OrderDetailDialog
          order={lastOrder}
          open={showReceipt}
          onOpenChange={setShowReceipt}
        />
      )}
    </div>
  );
}

'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Receipt } from 'lucide-react';
import type { Order, OrderStatus, UpdateOrderStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { shopApi } from '@/lib/shop-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatusBadge } from '@/components/club/status-badge';
import { Money } from '@/components/club/money';
import { formatDateTime } from '@/lib/format';
import { humanize } from '@/components/club/ops-bits';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { OrdersBoard, type NextStatus } from '@/components/club/orders-board';
import { OrderDetailDialog } from '@/components/club/order-detail-dialog';
import { ViewSwitcher, CardGrid, useViewPreference, type ViewKind } from '@/components/club/views';

const ORDER_VIEWS: ViewKind[] = ['list', 'cards', 'board'];

export default function OrdersPage() {
  const { user, hasPermission } = useAuth();
  const staff = hasPermission('orders:read');
  const allowed = staff || hasPermission('orders:read:self');

  const [status, setStatus] = useState<string>('ALL');
  const [channel, setChannel] = useState<'ALL' | 'POS' | 'ONLINE'>('ALL');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const client = useQueryClient();
  const [view, setView] = useViewPreference('orders', ORDER_VIEWS, 'list');

  const query = useQuery({
    queryKey: ['orders', staff, view === 'board' ? 'board' : status, channel, view === 'board' ? 1 : page, view],
    queryFn: () =>
      shopApi.orders(
        {
          page: view === 'board' ? 1 : page,
          limit: view === 'board' ? 100 : 20,
          status: view === 'board' || status === 'ALL' ? undefined : (status as OrderStatus),
          channel: channel === 'ALL' ? undefined : channel,
        },
        !staff
      ),
    enabled: allowed,
    refetchInterval: 10000,
  });

  const handleChannelChange = (newChannel: 'ALL' | 'POS' | 'ONLINE') => {
    setChannel(newChannel);
    setPage(1);
    if (newChannel === 'POS' && status !== 'ALL' && status !== 'COMPLETED') {
      setStatus('ALL');
    }
  };

  const statusTabs = useMemo(() => {
    if (channel === 'POS') {
      return [
        ['ALL', 'All counter sales'],
        ['COMPLETED', 'Completed'],
      ];
    }
    if (channel === 'ONLINE') {
      return [
        ['ALL', 'All online'],
        ['PLACED', 'Placed'],
        ['READY', 'Ready'],
        ['OUT_FOR_DELIVERY', 'Out for delivery'],
        ['COLLECTED', 'Collected'],
        ['DELIVERED', 'Delivered'],
      ];
    }
    return [
      ['ALL', 'All'],
      ['PLACED', 'Placed'],
      ['READY', 'Ready'],
      ['OUT_FOR_DELIVERY', 'Out for delivery'],
      ['COLLECTED', 'Collected'],
      ['DELIVERED', 'Delivered'],
      ['COMPLETED', 'Completed'],
    ];
  }, [channel]);

  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: UpdateOrderStatusRequest['status'] }) =>
      shopApi.status(id, { status: next }),
    onSuccess: () => {
      toast.success('Order status updated');
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const allOrders = query.data?.data ?? [];

  // Filter client-side by search query and channel filter
  const filteredOrders = useMemo(() => {
    return allOrders.filter((o) => {
      if (channel !== 'ALL' && o.channel !== channel) return false;
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const numMatch = o.orderNumber.toLowerCase().includes(term);
      const custMatch = (o.member?.fullName ?? o.customerName ?? '').toLowerCase().includes(term);
      const itemMatch = o.items.some((i) => i.name.toLowerCase().includes(term));
      return numMatch || custMatch || itemMatch;
    });
  }, [allOrders, channel, search]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff ? 'Orders' : 'My orders'}
        description="Track counter sales, pickup packages, and online order fulfilment."
        actions={
          allowed ? (
            <ViewSwitcher views={ORDER_VIEWS} value={view} onChange={setView} />
          ) : undefined
        }
      />

      {!allowed ? (
        <EmptyState
          title="Orders are unavailable"
          description="Ask the front desk for order information."
        />
      ) : (
        <>
          {/* Channel and Search Toolbar for Staff */}
          {staff && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Status Tabs */}
              <Tabs
                value={status}
                onValueChange={(val) => {
                  setStatus(val);
                  setPage(1);
                }}
              >
                <TabsList className="h-auto flex-wrap justify-start">
                  {statusTabs.map(([val, label]) => (
                    <TabsTrigger key={val} value={val}>
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {/* Channel Filter & Search */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleChannelChange('ALL')}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      channel === 'ALL'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All Channels
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChannelChange('POS')}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      channel === 'POS'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Counter (POS)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChannelChange('ONLINE')}
                    className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                      channel === 'ONLINE'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Online
                  </button>
                </div>

                <div className="relative min-w-[180px] max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search orders..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Loading / Error States */}
          {query.error ? (
            <PageError
              error={query.error}
              onRetry={() => {
                query.refetch();
              }}
            />
          ) : query.isPending ? (
            <div role="status" aria-label="Loading orders" className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !filteredOrders.length ? (
            <EmptyState
              title="No orders match"
              description={
                channel === 'POS'
                  ? 'No counter sales match the selected filters. Placed POS sales are marked as completed.'
                  : 'Placed counter sales and online orders will appear here.'
              }
              action={
                search || channel !== 'ALL' || status !== 'ALL' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setChannel('ALL');
                      setStatus('ALL');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : view === 'board' ? (
            /* Board View */
            <OrdersBoard
              orders={filteredOrders}
              canMove={staff}
              onAdvance={(order, next: NextStatus) => update.mutate({ id: order.id, next })}
              onSelect={setSelectedOrder}
            />
          ) : view === 'cards' ? (
            /* Cards View */
            <CardGrid>
              {filteredOrders.map((order) => {
                const isPos = order.channel === 'POS';
                const next =
                  order.status === 'PLACED'
                    ? order.fulfilment === 'DELIVERY'
                      ? 'OUT_FOR_DELIVERY'
                      : 'READY'
                    : order.status === 'READY'
                    ? 'COLLECTED'
                    : order.status === 'OUT_FOR_DELIVERY'
                    ? 'DELIVERED'
                    : undefined;

                return (
                  <div
                    key={order.id}
                    className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm space-y-3 transition hover:border-primary/40 hover:shadow-md"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold tabular-nums">
                            {order.orderNumber}
                          </span>
                          <Badge
                            variant={isPos ? 'default' : 'outline'}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {isPos
                              ? 'Counter POS'
                              : order.fulfilment === 'DELIVERY'
                              ? 'Delivery'
                              : 'Pickup'}
                          </Badge>
                        </div>
                        <StatusBadge kind="order" value={order.status} />
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {humanize(order.fulfilment)} &middot; {formatDateTime(order.createdAt)}
                      </div>

                      <div className="text-sm font-medium">
                        {order.member?.fullName ?? order.customerName ?? 'Walk-in customer'}
                      </div>

                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {order.items.map((item) => `${item.qty}\u00D7 ${item.name}`).join(', ')}
                      </p>
                    </div>

                    <div className="border-t pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          <Money paise={order.totalPaise} />
                        </span>
                        <Badge
                          variant={order.paymentStatus === 'PAID' ? 'outline' : 'destructive'}
                          className="text-[10px]"
                        >
                          {order.paymentStatus}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs gap-1"
                          onClick={() => setSelectedOrder(order)}
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          Receipt
                        </Button>

                        {next && hasPermission('orders:update') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: order.id, next })}
                          >
                            {next === 'READY'
                              ? 'Mark ready'
                              : next === 'COLLECTED'
                              ? 'Mark collected'
                              : next === 'OUT_FOR_DELIVERY'
                              ? 'Dispatch'
                              : 'Mark delivered'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardGrid>
          ) : (
            /* List View */
            <ul className="divide-y rounded-xl border bg-card">
              {filteredOrders.map((order) => {
                const isPos = order.channel === 'POS';
                const next =
                  order.status === 'PLACED'
                    ? order.fulfilment === 'DELIVERY'
                      ? 'OUT_FOR_DELIVERY'
                      : 'READY'
                    : order.status === 'READY'
                    ? 'COLLECTED'
                    : order.status === 'OUT_FOR_DELIVERY'
                    ? 'DELIVERED'
                    : undefined;

                return (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-4 transition hover:bg-muted/30"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold tabular-nums">
                          {order.orderNumber}
                        </span>
                        <Badge
                          variant={isPos ? 'default' : 'outline'}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {isPos
                            ? 'Counter POS'
                            : order.fulfilment === 'DELIVERY'
                            ? 'Delivery'
                            : 'Pickup'}
                        </Badge>
                        <StatusBadge kind="order" value={order.status} />
                        <Badge
                          variant={order.paymentStatus === 'PAID' ? 'outline' : 'destructive'}
                          className="text-[10px]"
                        >
                          {order.paymentStatus}
                        </Badge>
                      </div>

                      <p className="text-sm">
                        <span className="font-medium">
                          {order.member?.fullName ?? order.customerName ?? 'Counter customer'}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          &middot; {formatDateTime(order.createdAt)}
                        </span>
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {order.items.map((item) => `${item.qty}\u00D7 ${item.name}`).join(', ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold tabular-nums">
                          <Money paise={order.totalPaise} />
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        Receipt
                      </Button>

                      {next && hasPermission('orders:update') && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: order.id, next })}
                        >
                          {next === 'READY'
                            ? 'Mark ready'
                            : next === 'COLLECTED'
                            ? 'Mark collected'
                            : next === 'OUT_FOR_DELIVERY'
                            ? 'Dispatch'
                            : 'Mark delivered'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination */}
          {query.data && view !== 'board' && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                {query.data.meta.totalItems} orders
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!query.data.meta.hasPrevPage}
                  onClick={() => setPage((c) => c - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!query.data.meta.hasNextPage}
                  onClick={() => setPage((c) => c + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Order Receipt Modal */}
      <OrderDetailDialog
        order={selectedOrder}
        open={Boolean(selectedOrder)}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      />
    </div>
  );
}

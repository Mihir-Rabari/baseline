'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Order, OrderStatus, UpdateOrderStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { shopApi } from '@/lib/shop-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatusBadge } from '@/components/club/status-badge';
import { Money } from '@/components/club/money';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { OrdersBoard } from '@/components/club/orders-board';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';

import { filterOrders, type OrderChannelFilter } from '@/lib/orders-filter';

const ORDER_VIEWS: ViewKind[] = ['list', 'board'];

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'READY', label: 'Ready' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'COMPLETED', label: 'Completed' },
];

export default function OrdersPage() {
  const { user, hasPermission } = useAuth();
  const staff = hasPermission('orders:read');
  const allowed = staff || hasPermission('orders:read:self');

  const [status, setStatus] = useState('ALL');
  const [channel, setChannel] = useState<OrderChannelFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const client = useQueryClient();
  const [view, setView] = useViewPreference('orders', ORDER_VIEWS, 'list');
  const board = view === 'board';

  const query = useQuery({
    queryKey: ['orders', staff, board ? 'board' : status, board ? 1 : page, board],
    queryFn: () =>
      shopApi.orders(
        {
          page: board ? 1 : page,
          limit: board ? 100 : 20,
          status: board || status === 'ALL' ? undefined : (status as OrderStatus),
        },
        !staff
      ),
    enabled: allowed,
    refetchInterval: 10000,
  });

  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: UpdateOrderStatusRequest['status'] }) =>
      shopApi.status(id, { status: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['orders'] }),
    onError: (error) => toast.error(error.message),
  });

  const rawOrders = query.data?.data ?? [];
  const filteredOrders = useMemo(() => filterOrders(rawOrders, search, channel), [rawOrders, search, channel]);

  const isFiltered = search.trim() !== '' || channel !== 'ALL' || status !== 'ALL';

  const resetFilters = () => {
    setSearch('');
    setChannel('ALL');
    setStatus('ALL');
    setPage(1);
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff ? 'Orders & Shop Fulfilment' : 'My orders'}
        description={
          board
            ? 'Drag orders to advance fulfilment stage, or use button actions.'
            : 'Track shop orders, deliveries, pickups and counter sales.'
        }
        actions={<ViewSwitcher views={ORDER_VIEWS} value={view} onChange={setView} />}
      />

      {!allowed ? (
        <EmptyState title="Orders are unavailable" description="Ask the front desk for order information." />
      ) : (
        <>
          {/* Filter Bar */}
          <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search input */}
              <div className="relative min-w-60 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="orders-search"
                  aria-label="Search orders"
                  placeholder="Search by order #, customer, or items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-8 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Channel filter pills */}
              {staff && (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Channel:</span>
                  <div
                    role="group"
                    aria-label="Channel filter"
                    className="inline-flex rounded-md border bg-background p-0.5 shadow-sm"
                  >
                    {(
                      [
                        { value: 'ALL', label: 'All' },
                        { value: 'ONLINE', label: 'Online' },
                        { value: 'POS', label: 'POS / Counter' },
                      ] as const
                    ).map((opt) => {
                      const active = channel === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setChannel(opt.value)}
                          className={`inline-flex h-8 items-center rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            active
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Reset Filters */}
              {isFiltered && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetFilters}
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Reset all filters"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Reset
                </Button>
              )}
            </div>

            {/* List View Status Tabs */}
            {!board && staff && (
              <div className="border-t pt-3">
                <Tabs
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value);
                    setPage(1);
                  }}
                >
                  <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
                    {STATUS_TABS.map((tab) => (
                      <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}

            {/* Summary Bar */}
            <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>
                Showing {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}
                {query.data ? ` (Page total: ${query.data.meta.totalItems})` : ''}
              </span>
              {isFiltered && <span className="font-medium text-foreground">Filtered</span>}
            </div>
          </div>

          {/* Data Content */}
          {query.error ? (
            <PageError
              error={query.error}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : query.isPending ? (
            <div role="status" aria-label="Loading orders">
              <Skeleton className="h-72 w-full" />
            </div>
          ) : !rawOrders.length ? (
            <EmptyState title="No orders yet" description="Placed shop orders will appear here." />
          ) : !filteredOrders.length ? (
            <EmptyState
              title="No matching orders"
              description="No orders match your search and filter criteria."
              action={
                <Button variant="outline" onClick={resetFilters}>
                  Clear all filters
                </Button>
              }
            />
          ) : board ? (
            <OrdersBoard
              orders={filteredOrders}
              canMove={staff}
              onAdvance={(order, next) => update.mutate({ id: order.id, next })}
            />
          ) : (
            <>
              <ul className="divide-y rounded-lg border bg-card px-4">
                {filteredOrders.map((order) => {
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
                    <li key={order.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs font-semibold">{order.orderNumber}</p>
                          <Badge
                            variant={order.channel === 'POS' ? 'secondary' : 'outline'}
                            className="text-[10px]"
                          >
                            {order.channel === 'POS'
                              ? 'POS Counter'
                              : order.fulfilment === 'DELIVERY'
                              ? 'Delivery'
                              : 'Pickup'}
                          </Badge>
                          <StatusBadge kind="order" value={order.status} />
                        </div>
                        <p className="text-sm font-medium">
                          {order.member?.fullName ?? order.customerName ?? 'Counter customer'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        <Money paise={order.totalPaise} className="font-semibold text-sm" />
                        {next && hasPermission('orders:update') && (
                          <Button
                            size="sm"
                            variant="outline"
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

              {query.data && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Page {query.data.meta.page} of {query.data.meta.totalPages || 1}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!query.data.meta.hasPrevPage}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!query.data.meta.hasNextPage}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

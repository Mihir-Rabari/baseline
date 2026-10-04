'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, RotateCcw, X, SlidersHorizontal, Utensils, Wine, Clock } from 'lucide-react';
import type { UpdateTicketStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useKitchen } from '@/hooks/use-bar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { KitchenCards } from '@/components/club/kitchen-views';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';

const KITCHEN_VIEWS: ViewKind[] = ['board', 'cards'];
import {
  type KitchenFilters,
  type StationFilter,
  type StatusFilter,
  type TimeFilter,
  type ChannelFilter,
  DEFAULT_KITCHEN_FILTERS,
  KITCHEN_STORAGE_KEY,
  filterTickets,
} from '@/lib/kitchen-filter';

const columns: Array<{ status: 'NEW' | 'PREPARING' | 'READY'; label: string; action: string; next: UpdateTicketStatusRequest['status'] }> = [
  { status: 'NEW', label: 'New', action: 'Start', next: 'PREPARING' },
  { status: 'PREPARING', label: 'Preparing', action: 'Mark ready', next: 'READY' },
  { status: 'READY', label: 'Ready', action: 'Mark served', next: 'SERVED' },
];

export default function KitchenPage() {
  const { user, hasPermission } = useAuth();
  const { tickets, advance, canRead } = useKitchen();
  const [view, setView] = useViewPreference('kitchen', KITCHEN_VIEWS, 'board');
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<KitchenFilters>(() => {
    if (typeof window === 'undefined') return DEFAULT_KITCHEN_FILTERS;
    try {
      const saved = window.localStorage.getItem(KITCHEN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<KitchenFilters>;
        return {
          query: typeof parsed.query === 'string' ? parsed.query : '',
          station: ['ALL', 'KITCHEN', 'BAR'].includes(parsed.station as string) ? (parsed.station as StationFilter) : 'ALL',
          status: ['ALL', 'NEW', 'PREPARING', 'READY'].includes(parsed.status as string) ? (parsed.status as StatusFilter) : 'ALL',
          time: ['ALL', 'UNDER_5', '5_TO_10', 'OVER_10'].includes(parsed.time as string) ? (parsed.time as TimeFilter) : 'ALL',
          channel: ['ALL', 'TABLE', 'WALK_IN'].includes(parsed.channel as string) ? (parsed.channel as ChannelFilter) : 'ALL',
        };
      }
    } catch {
      // Storage unavailable or invalid
    }
    return DEFAULT_KITCHEN_FILTERS;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KITCHEN_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Ignore write errors
    }
  }, [filters]);

  const isFiltered = useMemo(() => {
    return (
      filters.query.trim() !== '' ||
      filters.station !== 'ALL' ||
      filters.status !== 'ALL' ||
      filters.time !== 'ALL' ||
      filters.channel !== 'ALL'
    );
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.query.trim()) count += 1;
    if (filters.station !== 'ALL') count += 1;
    if (filters.status !== 'ALL') count += 1;
    if (filters.time !== 'ALL') count += 1;
    if (filters.channel !== 'ALL') count += 1;
    return count;
  }, [filters]);

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (filters.query) {
          setFilters((prev) => ({ ...prev, query: '' }));
        } else {
          searchInputRef.current?.blur();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filters.query]);

  const resetFilters = () => {
    setFilters(DEFAULT_KITCHEN_FILTERS);
  };

  const rawTickets = tickets.data ?? [];
  const filteredTickets = useMemo(() => filterTickets(rawTickets, filters), [rawTickets, filters]);

  const visibleColumns = useMemo(() => {
    if (filters.status === 'ALL') return columns;
    return columns.filter((col) => col.status === filters.status);
  }, [filters.status]);

  if (!user) return null;

  const move = async (id: string, status: UpdateTicketStatusRequest['status']) => {
    if (advance.isPending || !canRead) return;
    setError(null);
    try {
      await advance.mutateAsync({ id, status });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The ticket could not be updated. Try again.');
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Kitchen & Bar Tickets"
        description="Live order display with station routing, time warnings, and service tracking."
        actions={
          <>
            <ViewSwitcher views={KITCHEN_VIEWS} value={view} onChange={setView} />
            {hasPermission('bar:read') && (
              <Button asChild variant="outline">
                <Link href="/bar">Bar floor</Link>
              </Button>
            )}
          </>
        }
      />

      {!canRead ? (
        <EmptyState title="Kitchen access required" description="Ask the owner for access to kitchen tickets." />
      ) : tickets.isPending ? (
        <div className="space-y-6">
          <Skeleton className="h-12 w-full" />
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        </div>
      ) : tickets.isError ? (
        <PageError error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Search & Filter Controls */}
          <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Bar */}
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  id="kitchen-search"
                  aria-label="Search tickets"
                  placeholder="Search by ticket #, tab, table, or item... (Press / to focus)"
                  value={filters.query}
                  onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
                  className="pl-9 pr-8"
                />
                {filters.query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setFilters((prev) => ({ ...prev, query: '' }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Station Filter */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Station:</span>
                <div role="group" aria-label="Station filter" className="inline-flex rounded-md border bg-background p-0.5 shadow-sm">
                  {(
                    [
                      { value: 'ALL', label: 'All' },
                      { value: 'KITCHEN', label: 'Kitchen', icon: Utensils },
                      { value: 'BAR', label: 'Bar', icon: Wine },
                    ] as const
                  ).map((opt) => {
                    const active = filters.station === opt.value;
                    const Icon = 'icon' in opt ? opt.icon : null;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilters((prev) => ({ ...prev, station: opt.value }))}
                        className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Filter */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Wait time:</span>
                <select
                  id="time-filter"
                  aria-label="Filter by wait time"
                  className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.time}
                  onChange={(e) => setFilters((prev) => ({ ...prev, time: e.target.value as TimeFilter }))}
                >
                  <option value="ALL">Any wait time</option>
                  <option value="UNDER_5">&lt; 5 min</option>
                  <option value="5_TO_10">5–10 min</option>
                  <option value="OVER_10">10+ min (Urgent)</option>
                </select>
              </div>

              {/* Channel / Seating Filter */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Order type:</span>
                <select
                  id="channel-filter"
                  aria-label="Filter by order type"
                  className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.channel}
                  onChange={(e) => setFilters((prev) => ({ ...prev, channel: e.target.value as ChannelFilter }))}
                >
                  <option value="ALL">All types</option>
                  <option value="TABLE">Table seated</option>
                  <option value="WALK_IN">Walk-in / Counter</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Status:</span>
                <select
                  id="status-filter"
                  aria-label="Filter by status"
                  className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={filters.status}
                  onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as StatusFilter }))}
                >
                  <option value="ALL">All stages</option>
                  <option value="NEW">New</option>
                  <option value="PREPARING">Preparing</option>
                  <option value="READY">Ready</option>
                </select>
              </div>

              {/* Reset Filters Button */}
              {isFiltered && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetFilters}
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Reset all filters"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reset filters
                  <Badge variant="secondary" className="ml-0.5 px-1 py-0 text-[10px]">
                    {activeFilterCount}
                  </Badge>
                </Button>
              )}
            </div>

            {/* Results Summary Bar */}
            <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>
                Showing {filteredTickets.length} of {rawTickets.length} active ticket{rawTickets.length === 1 ? '' : 's'}
              </span>
              {isFiltered && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Filters applied
                </span>
              )}
            </div>
          </div>

          {/* Board / Columns */}
          {!rawTickets.length ? (
            <EmptyState title="No tickets" description="Sent bar items will appear here." />
          ) : !filteredTickets.length ? (
            <EmptyState
              title="No matching tickets"
              description="No tickets match your search or filter criteria. Try adjusting your filters or resetting them."
              action={
                <Button variant="outline" onClick={resetFilters}>
                  Clear all filters
                </Button>
              }
            />
          ) : view === 'cards' ? (
            <KitchenCards tickets={filteredTickets} isPending={advance.isPending} activePendingId={advance.variables?.id} onMove={move} />
          ) : (
            <div
              className={`grid gap-4 ${
                visibleColumns.length === 1 ? 'grid-cols-1 max-w-xl mx-auto' : 'md:grid-cols-3'
              }`}
            >
              {visibleColumns.map((column) => {
                const columnTickets = filteredTickets.filter((ticket) => ticket.status === column.status);
                return (
                  <section key={column.status} className="space-y-4" aria-label={column.label}>
                    <div className="flex items-center justify-between border-b pb-2">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        {column.label}
                        <Badge variant="secondary" className="tabular">
                          {columnTickets.length}
                        </Badge>
                      </h2>
                    </div>

                    {columnTickets.length === 0 ? (
                      <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-6 text-center">
                        Nothing here
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {columnTickets.map((ticket) => {
                          const isUrgent = ticket.minutesWaiting >= 10;
                          return (
                            <article
                              key={ticket.id}
                              className="space-y-4 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h3 className="font-semibold text-base">
                                    {ticket.table?.name ?? 'Walk-in'} · #{ticket.ticketNumber}
                                  </h3>
                                  <p className="text-sm text-muted-foreground">
                                    Tab #{ticket.tab.tabNumber} · {ticket.tab.label}
                                  </p>
                                </div>
                                <Badge variant={ticket.station === 'BAR' ? 'secondary' : 'outline'}>
                                  {ticket.station === 'BAR' ? 'Bar' : 'Kitchen'}
                                </Badge>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <Clock
                                  className={`h-4 w-4 ${isUrgent ? 'text-warning animate-pulse' : 'text-muted-foreground'}`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={`tabular text-xs font-medium ${
                                    isUrgent ? 'text-warning font-semibold' : 'text-muted-foreground'
                                  }`}
                                >
                                  Waiting {ticket.minutesWaiting} min {isUrgent && '(Priority)'}
                                </span>
                              </div>

                              <ul className="space-y-2 border-t pt-3">
                                {ticket.items.map((item, index) => (
                                  <li key={index} className="text-sm">
                                    <p>
                                      <span className="tabular font-semibold">{item.qty} × </span>
                                      {item.name}
                                    </p>
                                    {item.note && (
                                      <p className="text-xs italic text-muted-foreground pl-4">Note: {item.note}</p>
                                    )}
                                  </li>
                                ))}
                              </ul>

                              <Button
                                className="h-11 w-full font-medium"
                                disabled={advance.isPending}
                                onClick={() => move(ticket.id, column.next)}
                                aria-label={`${column.action} ticket ${ticket.ticketNumber}`}
                              >
                                {advance.isPending && advance.variables?.id === ticket.id ? 'Updating…' : column.action}
                              </Button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

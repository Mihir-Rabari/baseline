'use client';

import React, { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
  LayoutGrid,
  List,
  CalendarDays,
  UtensilsCrossed,
} from 'lucide-react';
import type {
  BarTable,
  BarTableBooking,
  BarTableBookingStatus,
  CreateBarTableBookingRequest,
  MemberLookupItem,
} from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useBarTableBookings } from '@/hooks/use-bar';
import { MemberSearch } from '@/components/club/member-search';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  calculateTimelinePosition,
  findBookingConflict,
  formatTimeRange,
  getTimelineHourSlots,
  resizeBookingDuration,
  shiftBookingTime,
} from '@/lib/booking-timeline';

interface BarTableBookingsSectionProps {
  tables: BarTable[];
  onOpenTabForBooking?: (table: BarTable, guestName: string, memberId?: string) => void;
}

type BookingViewMode = 'timeline' | 'day' | 'list';

export function BarTableBookingsSection({ tables, onOpenTabForBooking }: BarTableBookingsSectionProps) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('bar:manage');

  // Date selection state (default today: 2026-10-04)
  const [selectedDate, setSelectedDate] = useState('2026-10-04');
  const [viewMode, setViewMode] = useState<BookingViewMode>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableFilter, setSelectedTableFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BarTableBookingStatus>('ALL');

  // Selected booking for detail/edit
  const [activeBooking, setActiveBooking] = useState<BarTableBooking | null>(null);
  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // Hook for bookings
  const { bookings, create, update, cancel, seat } = useBarTableBookings({
    date: selectedDate,
  });

  // Filtered bookings list
  const filteredBookings = useMemo(() => {
    if (!bookings.data) return [];
    return bookings.data.filter((b) => {
      if (selectedTableFilter !== 'ALL' && b.tableId !== selectedTableFilter) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = b.guestName.toLowerCase().includes(q);
        const matchPhone = b.guestPhone?.toLowerCase().includes(q) ?? false;
        const matchNotes = b.notes?.toLowerCase().includes(q) ?? false;
        const matchTable = b.tableName.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchNotes && !matchTable) return false;
      }
      return true;
    });
  }, [bookings.data, selectedTableFilter, statusFilter, searchQuery]);

  // Navigate date
  const changeDateByDays = (delta: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + delta);
    setSelectedDate(current.toISOString().slice(0, 10));
  };

  // Quick Move / Shift booking time
  const handleShiftTime = async (booking: BarTableBooking, deltaMinutes: number) => {
    if (!canManage) return;
    setConflictWarning(null);
    const shifted = shiftBookingTime(booking.startsAt, booking.endsAt, deltaMinutes);
    const conflict = findBookingConflict(
      bookings.data ?? [],
      booking.tableId,
      shifted.startsAt,
      shifted.endsAt,
      booking.id
    );

    if (conflict) {
      setConflictWarning(
        `Cannot move: overlaps with ${conflict.guestName} (${formatTimeRange(conflict.startsAt, conflict.endsAt)}) on ${booking.tableName}`
      );
      return;
    }

    try {
      await update.mutateAsync({
        id: booking.id,
        data: {
          startsAt: shifted.startsAt,
          endsAt: shifted.endsAt,
        },
      });
    } catch {
      // Error handled by query/mutation state
    }
  };

  // Quick Resize / Extend duration
  const handleResizeDuration = async (booking: BarTableBooking, deltaMinutes: number) => {
    if (!canManage) return;
    setConflictWarning(null);
    const resized = resizeBookingDuration(booking.startsAt, booking.endsAt, deltaMinutes);
    const conflict = findBookingConflict(
      bookings.data ?? [],
      booking.tableId,
      resized.startsAt,
      resized.endsAt,
      booking.id
    );

    if (conflict) {
      setConflictWarning(
        `Cannot extend: overlaps with ${conflict.guestName} (${formatTimeRange(conflict.startsAt, conflict.endsAt)}) on ${booking.tableName}`
      );
      return;
    }

    try {
      await update.mutateAsync({
        id: booking.id,
        data: {
          endsAt: resized.endsAt,
        },
      });
    } catch {
      // Error handled by mutation
    }
  };

  // Quick Move Table
  const handleMoveTable = async (booking: BarTableBooking, targetTableId: string) => {
    if (!canManage || booking.tableId === targetTableId) return;
    setConflictWarning(null);
    const targetTable = tables.find((t) => t.id === targetTableId);
    if (!targetTable) return;

    const conflict = findBookingConflict(
      bookings.data ?? [],
      targetTableId,
      booking.startsAt,
      booking.endsAt,
      booking.id
    );

    if (conflict) {
      setConflictWarning(
        `Cannot move to ${targetTable.name}: overlaps with ${conflict.guestName} (${formatTimeRange(conflict.startsAt, conflict.endsAt)})`
      );
      return;
    }

    try {
      await update.mutateAsync({
        id: booking.id,
        data: {
          tableId: targetTableId,
        },
      });
    } catch {
      // Error handled
    }
  };

  // Seat booking & optionally open tab
  const handleSeatBooking = async (booking: BarTableBooking) => {
    if (!canManage) return;
    try {
      await seat.mutateAsync(booking.id);
      setActiveBooking(null);
      if (onOpenTabForBooking) {
        const table = tables.find((t) => t.id === booking.tableId);
        if (table) {
          onOpenTabForBooking(table, booking.guestName, booking.memberId ?? undefined);
        }
      }
    } catch {
      // Error handled
    }
  };

  // Cancel booking
  const handleCancelBooking = async (booking: BarTableBooking) => {
    if (!canManage) return;
    try {
      await cancel.mutateAsync({ id: booking.id, reason: 'Staff cancelled' });
      setActiveBooking(null);
    } catch {
      // Error handled
    }
  };

  // Hour slots for Gantt timeline
  const hourSlots = useMemo(() => getTimelineHourSlots(), []);

  return (
    <div className="space-y-4 pt-4 border-t" data-testid="bar-table-bookings-section">
      {/* SECTION HEADER & CONTROLS */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Table Reservations & Timeline</h2>
          <p className="text-sm text-muted-foreground">
            Track, move, and extend table bookings with real-time overlap validation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* DATE PICKER & NAVIGATION */}
          <div className="flex items-center rounded-lg border bg-card p-1 shadow-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeDateByDays(-1)}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="flex items-center gap-1.5 px-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-medium focus-visible:outline-none"
                aria-label="Select date"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeDateByDays(1)}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedDate('2026-10-04')}
            >
              Today
            </Button>
          </div>

          {/* VIEW SWITCHER */}
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="View switcher">
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Gantt timeline view"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              <span>Timeline</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'day'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Day schedule view"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              <span>Day</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="List view"
            >
              <List className="h-4 w-4" aria-hidden="true" />
              <span>List</span>
            </button>
          </div>

          {/* NEW BOOKING BUTTON */}
          {canManage && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setConflictWarning(null);
                setIsNewBookingOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Book Table</span>
            </Button>
          )}
        </div>
      </div>

      {/* CONFLICT WARNING ALERT */}
      {conflictWarning && (
        <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{conflictWarning}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setConflictWarning(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* FILTER & SEARCH BAR */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bookings by guest or phone…"
            className="h-8 pl-8 pr-7 text-xs"
            aria-label="Search bookings"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Table filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Table:</span>
          <select
            value={selectedTableFilter}
            onChange={(e) => setSelectedTableFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Filter by table"
          >
            <option value="ALL">All Tables</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.seats} seats)
              </option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1">
          {(['ALL', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED'] as const).map((st) => (
            <Button
              key={st}
              variant={statusFilter === st ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'All statuses' : st.charAt(0) + st.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* MAIN VIEW CONTENT AREA */}
      {bookings.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : bookings.isError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
          <p>Failed to load table bookings.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => bookings.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : filteredBookings.length === 0 && viewMode === 'list' ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          <CalendarIcon className="mx-auto h-4 w-4 opacity-40 mb-2" aria-hidden="true" />
          <p className="text-sm font-medium">No bookings found for {selectedDate}</p>
          <p className="text-xs mt-1">Book a table or adjust your filters above.</p>
        </div>
      ) : viewMode === 'timeline' ? (
        /* ================= 1. GANTT / TIMELINE VIEW ================= */
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden" data-testid="timeline-view">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* TIMELINE TIME HEADER */}
              <div className="flex border-b bg-muted/30 text-xs font-medium text-muted-foreground sticky top-0 z-10">
                <div className="w-36 shrink-0 border-r p-2.5 font-semibold text-foreground">
                  Bar Table
                </div>
                <div className="relative flex-1 h-9">
                  {hourSlots.map((slot) => (
                    <div
                      key={slot.hour}
                      className="absolute top-0 bottom-0 border-l border-border/40 pl-1 pt-2 text-[11px] tabular select-none"
                      style={{ left: `${slot.leftPct}%` }}
                    >
                      {slot.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* TIMELINE ROWS PER TABLE */}
              <div className="divide-y divide-border/60">
                {tables
                  .filter((t) => selectedTableFilter === 'ALL' || t.id === selectedTableFilter)
                  .map((table) => {
                    const tableBookings = filteredBookings.filter((b) => b.tableId === table.id);

                    return (
                      <div key={table.id} className="flex min-h-[64px] items-center hover:bg-muted/10 transition-colors">
                        {/* Table Name & Seats info */}
                        <div className="w-36 shrink-0 border-r p-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{table.name}</span>
                            <Badge variant={table.openTab ? 'warning' : 'outline'} className="text-[10px] px-1 py-0">
                              {table.openTab ? 'Occupied' : 'Free'}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Users className="h-4 w-4" aria-hidden="true" />
                            <span>{table.seats} seats</span>
                          </p>
                        </div>

                        {/* Timeline Grid & Bookings track */}
                        <div
                          className="relative flex-1 h-14 bg-muted/5 select-none"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const bookingId = e.dataTransfer.getData('text/plain');
                            const booking = bookings.data?.find((b) => b.id === bookingId);
                            if (booking) {
                              handleMoveTable(booking, table.id);
                            }
                          }}
                        >
                          {/* Hour vertical gridlines */}
                          {hourSlots.map((slot) => (
                            <div
                              key={slot.hour}
                              className="absolute top-0 bottom-0 border-l border-border/30 pointer-events-none"
                              style={{ left: `${slot.leftPct}%` }}
                            />
                          ))}

                          {/* Render booking bars */}
                          {tableBookings.map((b) => {
                            const pos = calculateTimelinePosition(b.startsAt, b.endsAt);
                            const isCancelled = b.status === 'CANCELLED';
                            const isSeated = b.status === 'SEATED';

                            const statusColorClass = isCancelled
                              ? 'bg-muted text-muted-foreground line-through opacity-60 border-muted'
                              : isSeated
                              ? 'bg-success/15 border-success/60 text-foreground font-medium'
                              : 'bg-primary/15 border-primary/50 text-foreground';

                            return (
                              <div
                                key={b.id}
                                draggable={canManage && !isCancelled}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('text/plain', b.id);
                                }}
                                className={`absolute top-1 bottom-1 rounded-md border p-1 text-xs shadow-xs transition-all flex flex-col justify-between overflow-hidden cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary ${statusColorClass}`}
                                style={{
                                  left: `${pos.leftPct}%`,
                                  width: `${pos.widthPct}%`,
                                }}
                                onClick={() => setActiveBooking(b)}
                                title={`${b.guestName} (${formatTimeRange(b.startsAt, b.endsAt)}) · ${b.partySize} guests · Click for details`}
                              >
                                <div className="flex items-center justify-between gap-1 leading-tight">
                                  <span className="font-semibold truncate text-[11px]">{b.guestName}</span>
                                  <span className="text-[10px] tabular opacity-80 shrink-0">
                                    {b.partySize}p
                                  </span>
                                </div>

                                <div className="flex items-center justify-between gap-1 text-[10px] opacity-75">
                                  <span className="tabular truncate">
                                    {formatTimeRange(b.startsAt, b.endsAt)}
                                  </span>
                                  {canManage && !isCancelled && (
                                    <div className="flex items-center gap-0.5 opacity-90 hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        aria-label={`Shift ${b.guestName} earlier`}
                                        onClick={() => handleShiftTime(b, -30)}
                                        className="h-4 w-4 rounded hover:bg-background/80 flex items-center justify-center"
                                        title="-30 min"
                                      >
                                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`Shift ${b.guestName} later`}
                                        onClick={() => handleShiftTime(b, 30)}
                                        className="h-4 w-4 rounded hover:bg-background/80 flex items-center justify-center"
                                        title="+30 min"
                                      >
                                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      ) : viewMode === 'day' ? (
        /* ================= 2. DAY / HOURLY VIEW ================= */
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="day-view">
          {hourSlots.slice(0, -1).map((slot) => {
            const slotHourStart = slot.hour;
            const slotBookings = filteredBookings.filter((b) => {
              const startH = new Date(b.startsAt).getHours();
              const endH = new Date(b.endsAt).getHours();
              return startH <= slotHourStart && endH > slotHourStart && b.status !== 'CANCELLED';
            });

            return (
              <div key={slot.hour} className="rounded-xl border bg-card p-3 shadow-xs space-y-2">
                <div className="flex items-center justify-between border-b pb-1.5">
                  <span className="font-semibold text-xs tabular">{slot.label} – {String(slot.hour + 1).padStart(2, '0')}:00</span>
                  <Badge variant={slotBookings.length > 0 ? 'secondary' : 'outline'} className="text-[10px]">
                    {slotBookings.length} booked
                  </Badge>
                </div>
                {slotBookings.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic py-1">All tables available</p>
                ) : (
                  <div className="space-y-1.5">
                    {slotBookings.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => setActiveBooking(b)}
                        className="rounded border p-1.5 text-xs hover:bg-muted/40 cursor-pointer transition-colors space-y-0.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-xs">{b.tableName}</span>
                          <span className="text-[10px] text-muted-foreground tabular">{formatTimeRange(b.startsAt, b.endsAt)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{b.guestName}</span>
                          <span>{b.partySize} guests</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= 3. LIST VIEW ================= */
        <div className="rounded-xl border bg-card shadow-sm divide-y" data-testid="list-view">
          {filteredBookings.map((b) => (
            <div
              key={b.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/20 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{b.guestName}</span>
                  <Badge variant="outline" className="text-xs font-semibold">
                    {b.tableName}
                  </Badge>
                  <Badge
                    variant={
                      b.status === 'SEATED'
                        ? 'default'
                        : b.status === 'CONFIRMED'
                        ? 'secondary'
                        : b.status === 'CANCELLED'
                        ? 'destructive'
                        : 'outline'
                    }
                    className="text-[10px]"
                  >
                    {b.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    <span className="tabular">{formatTimeRange(b.startsAt, b.endsAt)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    <span>{b.partySize} guests</span>
                  </span>
                  {b.guestPhone && <span>{b.guestPhone}</span>}
                  {b.notes && <span className="italic">“{b.notes}”</span>}
                </div>
              </div>

              {canManage && (
                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  {b.status === 'CONFIRMED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      onClick={() => handleSeatBooking(b)}
                    >
                      <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
                      <span>Seat</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setActiveBooking(b)}
                  >
                    Details
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ================= DETAIL / ACTIONS DIALOG ================= */}
      <Dialog open={Boolean(activeBooking)} onOpenChange={(open) => !open && setActiveBooking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Table Reservation · {activeBooking?.tableName}</DialogTitle>
            <DialogDescription>
              {activeBooking?.bookingDate} · {activeBooking && formatTimeRange(activeBooking.startsAt, activeBooking.endsAt)}
            </DialogDescription>
          </DialogHeader>

          {activeBooking && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guest:</span>
                  <span className="font-semibold">{activeBooking.guestName}</span>
                </div>
                {activeBooking.guestPhone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone:</span>
                    <span>{activeBooking.guestPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Party size:</span>
                  <span className="tabular">{activeBooking.partySize} guests</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant="outline">{activeBooking.status}</Badge>
                </div>
                {activeBooking.notes && (
                  <div className="border-t pt-1.5">
                    <span className="text-muted-foreground">Notes:</span>
                    <p className="mt-0.5 italic">{activeBooking.notes}</p>
                  </div>
                )}
              </div>

              {canManage && activeBooking.status !== 'CANCELLED' && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Adjustments
                  </h4>

                  {/* Move time earlier / later */}
                  <div className="flex items-center justify-between gap-2 border rounded-md p-2">
                    <span className="text-xs">Shift start/end time:</span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => {
                          handleShiftTime(activeBooking, -30);
                          setActiveBooking((prev) => prev ? { ...prev, ...shiftBookingTime(prev.startsAt, prev.endsAt, -30) } : null);
                        }}
                      >
                        -30 min
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => {
                          handleShiftTime(activeBooking, 30);
                          setActiveBooking((prev) => prev ? { ...prev, ...shiftBookingTime(prev.startsAt, prev.endsAt, 30) } : null);
                        }}
                      >
                        +30 min
                      </Button>
                    </div>
                  </div>

                  {/* Extend / shrink duration */}
                  <div className="flex items-center justify-between gap-2 border rounded-md p-2">
                    <span className="text-xs">Resize duration:</span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => {
                          handleResizeDuration(activeBooking, -30);
                          setActiveBooking((prev) => prev ? { ...prev, ...resizeBookingDuration(prev.startsAt, prev.endsAt, -30) } : null);
                        }}
                      >
                        -30m
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => {
                          handleResizeDuration(activeBooking, 30);
                          setActiveBooking((prev) => prev ? { ...prev, ...resizeBookingDuration(prev.startsAt, prev.endsAt, 30) } : null);
                        }}
                      >
                        +30m
                      </Button>
                    </div>
                  </div>

                  {/* Move table */}
                  <div className="flex items-center justify-between gap-2 border rounded-md p-2">
                    <span className="text-xs">Change Table:</span>
                    <select
                      value={activeBooking.tableId}
                      onChange={(e) => {
                        handleMoveTable(activeBooking, e.target.value);
                        const newTable = tables.find((t) => t.id === e.target.value);
                        setActiveBooking((prev) => prev ? { ...prev, tableId: e.target.value, tableName: newTable?.name ?? prev.tableName } : null);
                      }}
                      className="h-7 rounded border bg-background px-2 text-xs"
                    >
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.seats} seats)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Primary actions */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    {activeBooking.status === 'CONFIRMED' && (
                      <Button
                        className="flex-1"
                        onClick={() => handleSeatBooking(activeBooking)}
                      >
                        Seat & Open Tab
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => handleCancelBooking(activeBooking)}
                    >
                      Cancel Reservation
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ================= NEW BOOKING MODAL ================= */}
      <NewBookingDialog
        open={isNewBookingOpen}
        onOpenChange={setIsNewBookingOpen}
        tables={tables}
        selectedDate={selectedDate}
        existingBookings={bookings.data ?? []}
        onSubmit={async (data) => {
          await create.mutateAsync(data);
          setIsNewBookingOpen(false);
        }}
      />
    </div>
  );
}

// ----------------- SUBCOMPONENT: NEW BOOKING DIALOG -----------------

interface NewBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: BarTable[];
  selectedDate: string;
  existingBookings: BarTableBooking[];
  onSubmit: (data: CreateBarTableBookingRequest) => Promise<void>;
}

function NewBookingDialog({
  open,
  onOpenChange,
  tables,
  selectedDate,
  existingBookings,
  onSubmit,
}: NewBookingDialogProps) {
  const { hasPermission } = useAuth();
  const [tableId, setTableId] = useState(tables[0]?.id ?? '');
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('21:00');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [notes, setNotes] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberLookupItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Compute ISO timestamps
  const startsAtIso = `${selectedDate}T${startTime}:00.000Z`;
  const endsAtIso = `${selectedDate}T${endTime}:00.000Z`;

  // Real-time conflict detection
  const detectedConflict = useMemo(() => {
    if (!tableId || !startTime || !endTime) return null;
    return findBookingConflict(existingBookings, tableId, startsAtIso, endsAtIso);
  }, [existingBookings, tableId, startsAtIso, endsAtIso]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = selectedMember ? selectedMember.fullName : guestName.trim();
    if (!name) {
      setFormError('Please provide a guest name or select a member.');
      return;
    }

    if (new Date(startsAtIso).getTime() >= new Date(endsAtIso).getTime()) {
      setFormError('End time must be after start time.');
      return;
    }

    if (detectedConflict) {
      setFormError(
        `Table already booked by ${detectedConflict.guestName} between ${formatTimeRange(
          detectedConflict.startsAt,
          detectedConflict.endsAt
        )}`
      );
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        tableId,
        bookingDate: selectedDate,
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        guestName: name,
        guestPhone: guestPhone.trim() || undefined,
        memberId: selectedMember?.id,
        partySize,
        notes: notes.trim() || undefined,
      });
      // Reset form
      setGuestName('');
      setGuestPhone('');
      setSelectedMember(null);
      setNotes('');
      setPartySize(2);
      onOpenChange(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create reservation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Table Reservation</DialogTitle>
          <DialogDescription>
            Reserve a table for a guest or member on {selectedDate}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {formError && (
            <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
              {formError}
            </div>
          )}

          {detectedConflict && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Conflict detected: Already booked by <strong>{detectedConflict.guestName}</strong> ({formatTimeRange(detectedConflict.startsAt, detectedConflict.endsAt)}).
              </span>
            </div>
          )}

          {/* Table Select */}
          <div className="space-y-1.5">
            <Label htmlFor="res-table">Bar Table</Label>
            <select
              id="res-table"
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              required
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.seats} seats)
                </option>
              ))}
            </select>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-start">Start Time</Label>
              <Input
                id="res-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-end">End Time</Label>
              <Input
                id="res-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Member lookup option */}
          {hasPermission('members:read') && (
            <div className="space-y-1.5">
              <Label>Club Member (optional)</Label>
              <MemberSearch value={selectedMember} onChange={setSelectedMember} />
              {selectedMember && (
                <p className="text-xs text-muted-foreground">
                  Member discount {selectedMember.barDiscountPct}% will apply at checkout.
                </p>
              )}
            </div>
          )}

          {/* Guest details if no member */}
          {!selectedMember && (
            <div className="space-y-1.5">
              <Label htmlFor="res-guest">Guest Name</Label>
              <Input
                id="res-guest"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Guest name"
                required={!selectedMember}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-phone">Phone (optional)</Label>
              <Input
                id="res-phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+91..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-party">Party Size</Label>
              <Input
                id="res-party"
                type="number"
                min={1}
                max={30}
                value={partySize}
                onChange={(e) => setPartySize(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="res-notes">Notes / Special Requests</Label>
            <Input
              id="res-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Window seat, anniversary, high chair"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || Boolean(detectedConflict)}
          >
            {submitting ? 'Confirming reservation…' : 'Create Reservation'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { BarTable, TableBooking, TableBookingStatus } from '@packages/validation';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-ops';
import { Field, FormDialog, errorText } from '@/components/club/form-dialog';
import { QueryState, SelectBox, humanize } from '@/components/club/ops-bits';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { cn } from '@/lib/utils';
import {
  MINUTE, SNAP_MINUTES, applyDrag, clubInstant, clubTimeInput, clubTimeLabel, findConflict, holdsTable,
  percentAt, snap, timelineRange, type DragMode,
} from '@/lib/table-bookings';

const VIEWS: ViewKind[] = ['timeline', 'list'];
const ROW_HEIGHT = 48; // px, matches h-12
const LABEL_WIDTH = 96; // px, matches w-24

const STATUS_STYLE: Record<TableBookingStatus, string> = {
  BOOKED: 'border-primary/60 bg-primary/15 text-foreground',
  SEATED: 'border-emerald-500/70 bg-emerald-500/20 text-foreground',
  COMPLETED: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground line-through',
  NO_SHOW: 'border-border bg-muted text-muted-foreground',
};

type DialogState = { booking: TableBooking } | { tableId: string; startMs: number; endMs: number } | null;
interface Preview { id: string; tableId: string; startMs: number; endMs: number; conflict: boolean }

function BookingDialog({ state, tables, date, onClose }: { state: Exclude<DialogState, null>; tables: BarTable[]; date: string; onClose: () => void }) {
  const booking = 'booking' in state ? state.booking : null;
  const startMs = booking ? Date.parse(booking.startsAt) : (state as { startMs: number }).startMs;
  const endMs = booking ? Date.parse(booking.endsAt) : (state as { endMs: number }).endMs;
  const [tableId, setTableId] = useState(booking?.tableId ?? (state as { tableId: string }).tableId);
  const [guest, setGuest] = useState(booking?.guestName ?? '');
  const [party, setParty] = useState(String(booking?.partySize ?? 2));
  const [start, setStart] = useState(clubTimeInput(startMs));
  const [end, setEnd] = useState(clubTimeInput(endMs));
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const create = useOpsMutation<TableBooking, object>('post', ['bar'], () => '/bar/bookings');
  const update = useOpsMutation<TableBooking, { id: string; [key: string]: unknown }>('put', ['bar'], (v) => `/bar/bookings/${v.id}`);
  const closed = booking ? !holdsTable(booking) : false;
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  async function submit() {
    setError(null);
    const partySize = Number(party);
    if (!guest.trim()) return setError('Enter the guest name.');
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) return setError('Party size must be a whole number from 1 to 50.');
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return setError('Choose a start and end time.');
    if (minutes(end) <= minutes(start)) return setError('The booking must end after it starts.');
    const body = {
      tableId, guestName: guest.trim(), partySize, notes: notes.trim() || (booking ? null : undefined),
      startsAt: new Date(clubInstant(date, minutes(start))).toISOString(), endsAt: new Date(clubInstant(date, minutes(end))).toISOString(),
    };
    try {
      if (booking) await update.mutateAsync({ id: booking.id, ...body });
      else await create.mutateAsync(body);
      toast.success(booking ? 'Booking updated' : `Table booked for ${guest.trim()}`);
      onClose();
    } catch (caught) { setError(errorText(caught, 'Could not save the booking.')); }
  }
  async function setStatus(status: TableBookingStatus, message: string) {
    if (!booking) return;
    setError(null);
    try { await update.mutateAsync({ id: booking.id, status }); toast.success(message); onClose(); }
    catch (caught) { setError(errorText(caught, 'Could not change the booking.')); }
  }
  const pending = create.isPending || update.isPending;
  return (
    <FormDialog open onClose={onClose} title={booking ? `Booking for ${booking.guestName}` : 'Book a table'} description={booking && closed ? `This booking is ${humanize(booking.status).toLowerCase()} and can no longer change.` : 'Times are club time. A table cannot be booked twice at the same time.'} onSubmit={closed ? onClose : submit} submitLabel={closed ? 'Close' : booking ? 'Save changes' : 'Book table'} pending={pending} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectBox id="booking-table" label="Table" value={tableId} onChange={setTableId} disabled={closed} options={tables.filter((t) => t.isActive || t.id === tableId).map((t) => ({ value: t.id, label: `${t.name} · ${t.seats} seats` }))} />
        <Field id="booking-guest" label="Guest name" value={guest} maxLength={255} autoComplete="off" disabled={closed} onChange={(e) => setGuest(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="booking-start" label="From" type="time" step={SNAP_MINUTES * 60} value={start} disabled={closed} onChange={(e) => setStart(e.target.value)} />
        <Field id="booking-end" label="To" type="time" step={SNAP_MINUTES * 60} value={end} disabled={closed} onChange={(e) => setEnd(e.target.value)} />
        <Field id="booking-party" label="Guests" inputMode="numeric" value={party} disabled={closed} onChange={(e) => setParty(e.target.value)} />
      </div>
      <Field id="booking-notes" label="Notes" value={notes} maxLength={500} disabled={closed} onChange={(e) => setNotes(e.target.value)} hint="Optional: occasion, seating preference." />
      {booking && !closed && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Booking actions">
          {booking.status === 'BOOKED' && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { void setStatus('SEATED', 'Guest seated'); }}>Seat guest</Button>}
          {booking.status === 'SEATED' && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { void setStatus('COMPLETED', 'Booking completed'); }}>Mark completed</Button>}
          {booking.status === 'BOOKED' && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { void setStatus('NO_SHOW', 'Marked as no-show'); }}>No-show</Button>}
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { void setStatus('CANCELLED', 'Booking cancelled'); }}>Cancel booking</Button>
        </div>
      )}
    </FormDialog>
  );
}

/**
 * Table reservations for one club day, below the bar floor. The timeline shows one row per table;
 * drag a booking to move it (also between tables), drag its right edge to resize, click an empty
 * slot to book. Overlaps turn red while dragging and are refused by the server as the final word.
 */
export function TableBookings({ tables, canManage }: { tables: BarTable[]; canManage: boolean }) {
  const [date, setDate] = useState(() => calendarDate());
  const [view, setView] = useViewPreference('bar-bookings', VIEWS, 'timeline');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: DragMode; x: number; y: number; moved: boolean; origin: { tableId: string; startMs: number; endMs: number } } | null>(null);
  const query = useOpsQuery<TableBooking[]>(['bar', 'bookings', date], `/bar/bookings?date=${date}`);
  const update = useOpsMutation<TableBooking, { id: string; [key: string]: unknown }>('put', ['bar'], (v) => `/bar/bookings/${v.id}`);
  const rows = tables.filter((t) => t.isActive);
  const data = query.data ?? [];
  const range = timelineRange(date, data);
  const hours = Array.from({ length: range.endHour - range.startHour }, (_, i) => range.startHour + i);
  const isToday = date === calendarDate();
  const nowPct = isToday ? percentAt(Date.now(), range) : -1;
  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? 'that table';

  function commit(b: TableBooking, next: { tableId: string; startMs: number; endMs: number }) {
    if (next.tableId === b.tableId && next.startMs === Date.parse(b.startsAt) && next.endMs === Date.parse(b.endsAt)) return;
    const clash = findConflict(data, { id: b.id, ...next });
    if (clash) { toast.error(`${tableName(next.tableId)} is already booked for ${clash.guestName} (${clubTimeLabel(Date.parse(clash.startsAt))} to ${clubTimeLabel(Date.parse(clash.endsAt))}).`); return; }
    void update.mutateAsync({ id: b.id, tableId: next.tableId, startsAt: new Date(next.startMs).toISOString(), endsAt: new Date(next.endMs).toISOString() })
      .then(() => toast.success(`${b.guestName} moved to ${tableName(next.tableId)}, ${clubTimeLabel(next.startMs)}`))
      .catch((e: Error) => toast.error(e.message));
  }

  function rowAt(clientY: number, fallback: string) {
    const rect = rowsRef.current?.getBoundingClientRect();
    if (!rect) return fallback;
    return rows[Math.min(rows.length - 1, Math.max(0, Math.floor((clientY - rect.top) / ROW_HEIGHT)))]?.id ?? fallback;
  }
  const trackWidth = () => Math.max(1, (rowsRef.current?.getBoundingClientRect().width ?? 0) - LABEL_WIDTH);

  function onPointerDown(event: React.PointerEvent, b: TableBooking, mode: DragMode) {
    if (!canManage || !holdsTable(b) || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { id: b.id, mode, x: event.clientX, y: event.clientY, moved: false, origin: { tableId: b.tableId, startMs: Date.parse(b.startsAt), endMs: Date.parse(b.endsAt) } };
  }
  function onPointerMove(event: React.PointerEvent, b: TableBooking) {
    const d = drag.current;
    if (!d || d.id !== b.id) return;
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 4) return;
    d.moved = true;
    const deltaMs = ((event.clientX - d.x) / trackWidth()) * (range.endMs - range.startMs);
    const next = applyDrag(d.origin, d.mode, deltaMs, d.mode === 'move' ? rowAt(event.clientY, d.origin.tableId) : d.origin.tableId);
    setPreview({ id: b.id, ...next, conflict: Boolean(findConflict(data, { id: b.id, ...next })) });
  }
  function onPointerUp(b: TableBooking) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== b.id) return;
    const result = preview;
    setPreview(null);
    if (!d.moved || !result) { setDialog({ booking: b }); return; }
    commit(b, result);
  }
  function onKeyDown(event: React.KeyboardEvent, b: TableBooking) {
    if (!canManage || !holdsTable(b)) return;
    const step = SNAP_MINUTES * MINUTE;
    const origin = { tableId: b.tableId, startMs: Date.parse(b.startsAt), endMs: Date.parse(b.endsAt) };
    const index = rows.findIndex((t) => t.id === b.tableId);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      commit(b, applyDrag(origin, event.shiftKey ? 'resize' : 'move', event.key === 'ArrowLeft' ? -step : step, b.tableId));
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
      event.preventDefault();
      const target = rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) commit(b, { ...origin, tableId: target.id });
    }
  }
  function onTrackClick(event: React.MouseEvent, tableId: string) {
    if (!canManage || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
    const startMs = snap(range.startMs + ratio * (range.endMs - range.startMs));
    setDialog({ tableId, startMs, endMs: startMs + 60 * MINUTE });
  }

  return (
    <section className="space-y-4" aria-label="Table bookings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Table bookings</h2>
          <p className="text-sm text-muted-foreground">{canManage ? 'Click an empty slot to book. Drag a booking to move it, or drag its right edge to change how long it lasts.' : 'Reservations for the day.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitcher views={VIEWS} value={view} onChange={setView} />
          <div className="inline-flex items-center gap-1" role="group" aria-label="Day">
            <Button size="icon" variant="outline" aria-label="Previous day" onClick={() => setDate(dateAfter(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <input type="date" aria-label="Booking day" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" />
            <Button size="icon" variant="outline" aria-label="Next day" onClick={() => setDate(dateAfter(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
            {!isToday && <Button size="sm" variant="ghost" onClick={() => setDate(calendarDate())}>Today</Button>}
          </div>
          {canManage && <Button onClick={() => { const startMs = snap(Math.max(Date.now(), range.startMs)); setDialog({ tableId: rows[0]?.id ?? '', startMs, endMs: startMs + 60 * MINUTE }); }} disabled={!rows.length}>Book a table</Button>}
        </div>
      </div>
      <QueryState query={{ ...query, isEmpty: false }} empty={{ title: '', description: '' }}>
        {view === 'list' ? (
          data.length === 0 ? <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No bookings for this day.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Table</TableHead><TableHead>Guest</TableHead><TableHead className="text-right">Guests</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {data.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="tabular">{clubTimeLabel(Date.parse(b.startsAt))} to {clubTimeLabel(Date.parse(b.endsAt))}</TableCell>
                    <TableCell>{b.tableName}</TableCell>
                    <TableCell className="font-medium">{b.guestName}{b.notes && <span className="block text-xs font-normal text-muted-foreground">{b.notes}</span>}</TableCell>
                    <TableCell className="tabular text-right">{b.partySize}</TableCell>
                    <TableCell><Badge variant={b.status === 'SEATED' ? 'success' : 'outline'}>{humanize(b.status)}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" aria-label={`${canManage ? 'Edit' : 'View'} booking for ${b.guestName}`} onClick={() => setDialog({ booking: b })}>{canManage ? 'Edit' : 'View'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : rows.length === 0 ? <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">Add a bar table to start taking bookings.</p> : (
          <div className="overflow-x-auto rounded-lg border">
            <div className="min-w-[44rem]" ref={rowsRef}>
              <div className="flex border-b bg-muted/40 text-xs text-muted-foreground" aria-hidden>
                <div className="w-24 shrink-0 px-3 py-2">Table</div>
                <div className="relative flex-1">{hours.map((h, i) => <span key={h} className="absolute top-2 -translate-x-1/2 tabular" style={{ left: `${(i / hours.length) * 100}%` }}>{i === 0 ? '' : clubTimeLabel(clubInstant(date, h * 60)).replace(':00', '')}</span>)}<span className="invisible">.</span></div>
              </div>
              {rows.map((table) => (
                <div key={table.id} className="flex border-b last:border-b-0" style={{ height: ROW_HEIGHT }}>
                  <div className="flex w-24 shrink-0 flex-col justify-center px-3 text-sm"><span className="font-medium">{table.name}</span><span className="text-xs text-muted-foreground">{table.seats} seats</span></div>
                  <div role="presentation" data-testid={`track-${table.name}`} className={cn('relative flex-1', canManage && 'cursor-pointer')} onClick={(e) => onTrackClick(e, table.id)}
                    style={{ backgroundImage: 'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px)', backgroundSize: `${100 / hours.length}% 100%` }}>
                    {nowPct >= 0 && nowPct <= 100 && <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-destructive" style={{ left: `${nowPct}%` }} />}
                    {data.filter((b) => (preview?.id === b.id ? preview.tableId : b.tableId) === table.id).map((b) => {
                      const live = preview?.id === b.id ? preview : null;
                      const s = live?.startMs ?? Date.parse(b.startsAt);
                      const e = live?.endMs ?? Date.parse(b.endsAt);
                      const left = Math.max(0, percentAt(s, range));
                      const width = Math.min(100, percentAt(e, range)) - left;
                      const movable = canManage && holdsTable(b);
                      return (
                        <div key={b.id} className="absolute inset-y-1" style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}>
                          <button type="button" aria-label={`${b.guestName}, ${clubTimeLabel(s)} to ${clubTimeLabel(e)}, ${humanize(b.status)}${movable ? '. Arrow keys move, shift with arrows resizes.' : ''}`}
                            className={cn('flex h-full w-full touch-none select-none flex-col justify-center overflow-hidden rounded-md border px-2 text-left text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', STATUS_STYLE[b.status], movable && 'cursor-grab active:cursor-grabbing', live?.conflict && 'border-destructive bg-destructive/20 ring-2 ring-destructive')}
                            onPointerDown={(ev) => onPointerDown(ev, b, 'move')} onPointerMove={(ev) => onPointerMove(ev, b)} onPointerUp={() => onPointerUp(b)}
                            onPointerCancel={() => { drag.current = null; setPreview(null); }}
                            onClick={(ev) => { if (ev.detail === 0) setDialog({ booking: b }); }} onKeyDown={(ev) => onKeyDown(ev, b)}>
                            <span className="truncate font-medium">{b.guestName} · {b.partySize}</span>
                            <span className="truncate tabular opacity-80">{clubTimeLabel(s)} to {clubTimeLabel(e)}</span>
                          </button>
                          {movable && <span role="presentation" aria-hidden data-testid={`resize-${b.id}`} className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize touch-none"
                            onPointerDown={(ev) => onPointerDown(ev, b, 'resize')} onPointerMove={(ev) => onPointerMove(ev, b)} onPointerUp={() => onPointerUp(b)} onPointerCancel={() => { drag.current = null; setPreview(null); }} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </QueryState>
      {preview?.conflict && <p role="status" className="text-sm text-destructive">That overlaps another booking on {tableName(preview.tableId)}. Release over a free slot instead.</p>}
      {dialog && <BookingDialog key={'booking' in dialog ? dialog.booking.id : `new-${dialog.startMs}`} state={dialog} tables={tables} date={date} onClose={() => setDialog(null)} />}
    </section>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChartGantt, ChevronLeft, ChevronRight, Columns3, LayoutGrid, List, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { weekdayIndex } from '@/lib/calendar-grid';
import { cn } from '@/lib/utils';

export type ViewKind = 'list' | 'cards' | 'board' | 'calendar' | 'timeline';

const VIEW_META: Record<ViewKind, { label: string; icon: LucideIcon }> = {
  list: { label: 'List', icon: List },
  cards: { label: 'Cards', icon: LayoutGrid },
  board: { label: 'Board', icon: Columns3 },
  calendar: { label: 'Calendar', icon: CalendarDays },
  timeline: { label: 'Timeline', icon: ChartGantt },
};

/**
 * The view a person last chose on a screen, kept in the browser so it is still there next visit.
 * Only a value from \`allowed\` is accepted, so a stale or tampered value falls back to the default.
 */
export function useViewPreference(key: string, allowed: ViewKind[], fallback: ViewKind): [ViewKind, (view: ViewKind) => void] {
  const storageKey = `view:${key}`;
  const [view, setView] = useState<ViewKind>(fallback);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey) as ViewKind | null;
      if (saved && allowed.includes(saved)) setView(saved);
    } catch { /* storage may be blocked; the default view is fine */ }
  }, [storageKey]);
  const choose = (next: ViewKind) => {
    setView(next);
    try { window.localStorage.setItem(storageKey, next); } catch { /* ignore */ }
  };
  return [view, choose];
}

/** A segmented control for switching how the same data is shown. */
export function ViewSwitcher({ views, value, onChange }: { views: ViewKind[]; value: ViewKind; onChange: (view: ViewKind) => void }) {
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-md border bg-background p-0.5 shadow-sm">
      {views.map((view) => {
        const { label, icon: Icon } = VIEW_META[view];
        const active = view === value;
        return (
          <button key={view} type="button" aria-pressed={active} onClick={() => onChange(view)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </button>
        );
      })}
    </div>
  );
}

/** A responsive grid for card views; children animate in one after another. */
export function CardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:animate-rise', className)}>{children}</div>;
}

export interface KanbanColumn { id: string; title: string; hint?: string }

/**
 * Columns of cards. Cards can be dragged between columns when \`onMove\` is given; \`canDrop\` says
 * which columns a card may land in (the board highlights only those). Drag and drop is a shortcut:
 * every move must also be possible with the buttons on the card, which the caller renders.
 */
export function KanbanBoard<T>({ columns, items, columnOf, idOf, renderCard, onMove, canDrop, emptyLabel = 'Nothing here' }: {
  columns: KanbanColumn[]; items: T[]; columnOf: (item: T) => string; idOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode; onMove?: (item: T, to: string) => void;
  canDrop?: (item: T, to: string) => boolean; emptyLabel?: string;
}) {
  const [dragging, setDragging] = useState<T | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const droppable = (column: string) => Boolean(dragging && onMove && columnOf(dragging) !== column && (canDrop ? canDrop(dragging, column) : true));
  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" role="list" aria-label="Board">
      {columns.map((column) => {
        const cards = items.filter((item) => columnOf(item) === column.id);
        const target = droppable(column.id);
        return (
          <section key={column.id} role="listitem" aria-label={column.title}
            onDragOver={(event) => { if (target) { event.preventDefault(); setOver(column.id); } }}
            onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
            onDrop={(event) => { event.preventDefault(); setOver(null); if (dragging && target) onMove?.(dragging, column.id); setDragging(null); }}
            className={cn('flex w-72 shrink-0 snap-start flex-col rounded-lg border bg-muted/30 transition-colors', target && 'border-dashed border-primary/60', over === column.id && 'bg-primary/10')}>
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <span className="tabular rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{cards.length}</span>
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{target ? 'Drop here' : emptyLabel}</p>}
              {cards.map((item) => (
                <div key={idOf(item)} draggable={Boolean(onMove)} onDragStart={(event) => { setDragging(item); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', idOf(item)); }} onDragEnd={() => { setDragging(null); setOver(null); }}
                  className={cn('animate-rise rounded-md border bg-card p-3 text-sm shadow-sm transition-[box-shadow,opacity,transform] duration-150 hover:shadow-md', onMove && 'cursor-grab active:cursor-grabbing', dragging && idOf(dragging) === idOf(item) && 'opacity-40')}>
                  {renderCard(item)}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export interface CalendarEvent {
  id: string; startsAt: string; endsAt: string; title: string; subtitle?: string;
  tone?: 'default' | 'success' | 'warning' | 'muted'; onClick?: () => void;
}

const TONES: Record<NonNullable<CalendarEvent['tone']>, string> = {
  default: 'border-primary/40 bg-primary/10 text-foreground',
  success: 'border-success/40 bg-success/10 text-foreground',
  warning: 'border-warning/40 bg-warning/10 text-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
};

/** Minutes since midnight and the calendar date of an instant, in the club's time zone. */
function clubClock(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Puts overlapping events side by side so none hides another. */
function layout(events: Array<{ id: string; start: number; end: number }>) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: typeof sorted = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    const placed = group.map((e) => {
      let lane = laneEnds.findIndex((end) => end <= e.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end); } else laneEnds[lane] = e.end;
      return { id: e.id, lane };
    });
    placed.forEach((p) => result.set(p.id, { lane: p.lane, lanes: laneEnds.length }));
    group = [];
  };
  for (const e of sorted) {
    if (group.length && e.start >= groupEnd) { flush(); groupEnd = -1; }
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end);
  }
  if (group.length) flush();
  return result;
}

const HOUR_PX = 44;

/** A week as seven day columns with timed events, in club time. */
export function WeekCalendar({ weekStart, onWeekChange, events, timezone = 'Asia/Kolkata', emptyLabel = 'Nothing scheduled this week' }: {
  weekStart: string; onWeekChange: (monday: string) => void; events: CalendarEvent[]; timezone?: string; emptyLabel?: string;
}) {
  const monday = dateAfter(weekStart, -weekdayIndex(weekStart));
  const days = Array.from({ length: 7 }, (_, i) => dateAfter(monday, i));
  const today = calendarDate(new Date(), timezone);
  const placed = events.map((event) => {
    const a = clubClock(event.startsAt, timezone);
    const b = clubClock(event.endsAt, timezone);
    const end = b.date === a.date ? b.minutes : 24 * 60;
    return { event, date: a.date, start: a.minutes, end: Math.max(end, a.minutes + 20) };
  }).filter((p) => days.includes(p.date));
  const first = Math.min(6, ...placed.map((p) => Math.floor(p.start / 60)));
  const last = Math.max(22, ...placed.map((p) => Math.ceil(p.end / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const scroller = useRef<HTMLDivElement>(null);
  const fmtDay = (d: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
  const label = `${new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${days[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${days[6]}T12:00:00Z`))}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">{label}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" aria-label="Previous week" onClick={() => onWeekChange(dateAfter(monday, -7))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <Button size="sm" variant="outline" onClick={() => onWeekChange(today)}>Today</Button>
          <Button size="sm" variant="outline" aria-label="Next week" onClick={() => onWeekChange(dateAfter(monday, 7))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
      <div ref={scroller} className="relative overflow-x-auto rounded-lg border">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b bg-muted/40 text-xs">
            <span />
            {days.map((d) => <div key={d} className={cn('px-2 py-2 text-center font-medium', d === today && 'text-primary')}>{fmtDay(d)}{d === today && <span className="sr-only"> (today)</span>}</div>)}
          </div>
          <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height: hours.length * HOUR_PX }}>
            <div className="relative">
              {hours.map((h) => <span key={h} className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground" style={{ top: (h - first) * HOUR_PX }}>{h === first ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`}</span>)}
            </div>
            {days.map((d) => {
              const dayEvents = placed.filter((p) => p.date === d);
              const lanes = layout(dayEvents.map((p) => ({ id: p.event.id, start: p.start, end: p.end })));
              return (
                <div key={d} className={cn('relative border-l', d === today && 'bg-primary/[0.03]')}>
                  {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: (h - first) * HOUR_PX }} />)}
                  {dayEvents.map((p) => {
                    const lane = lanes.get(p.event.id) ?? { lane: 0, lanes: 1 };
                    const top = ((p.start - first * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((p.end - p.start) / 60) * HOUR_PX - 2);
                    const Tag = p.event.onClick ? 'button' : 'div';
                    return (
                      <Tag key={p.event.id} type={p.event.onClick ? 'button' : undefined} onClick={p.event.onClick} title={`${p.event.title}${p.event.subtitle ? ` · ${p.event.subtitle}` : ''}`}
                        className={cn('absolute animate-pop-in overflow-hidden rounded border px-1.5 py-1 text-left text-[11px] leading-tight transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', TONES[p.event.tone ?? 'default'])}
                        style={{ top, height, left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`, width: `calc(${100 / lane.lanes}% - 4px)` }}>
                        <span className="block truncate font-medium">{p.event.title}</span>{p.event.subtitle && <span className="block truncate text-muted-foreground">{p.event.subtitle}</span>}
                      </Tag>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {placed.length === 0 && <p className="text-center text-sm text-muted-foreground">{emptyLabel}</p>}
    </div>
  );
}

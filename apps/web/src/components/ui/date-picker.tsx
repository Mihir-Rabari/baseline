'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDate, dateAfter } from '@/lib/booking-calendar';
import { WEEKDAY_LABELS, clampDate, formatLongDate, formatMonth, monthGrid, shiftMonth } from '@/lib/calendar-grid';
import { cn } from '@/lib/utils';

export interface DatePickerProps {
  id?: string;
  /** `YYYY-MM-DD`, or empty for no date. Omit to let the picker keep its own value (use with `name` in a form). */
  value?: string;
  defaultValue?: string;
  /** Submits the date with a form, like an input would. */
  name?: string;
  onChange?: (date: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Show Today, Tomorrow and Next week shortcuts (those inside min and max only). */
  shortcuts?: boolean;
  /** Time zone used to decide what "today" is. */
  timezone?: string;
}

/**
 * A date field with a calendar that opens under it. It works inside dialogs (no portal, so focus
 * stays trapped where it should) and by keyboard: arrows move a day or a week, Page Up and Page
 * Down move a month, Home and End jump to the start and end of the week, Enter picks, Escape closes.
 */
export function DatePicker({ id, value: controlled, defaultValue = '', name, onChange, min, max, disabled, placeholder = 'Choose a date', className, shortcuts = true, timezone = 'Asia/Kolkata' }: DatePickerProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const today = calendarDate(new Date(), timezone);
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const [focused, setFocused] = useState(value || today);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inRange = (date: string) => (!min || date >= min) && (!max || date <= max);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('button[data-focused="true"]')?.focus();
  }, [open, focused]);

  function openPanel() { setFocused(clampDate(value || today, min, max)); setOpen(true); }
  function pick(date: string) { if (!inRange(date)) return; setOwn(date); onChange?.(date); setOpen(false); trigger.current?.focus(); }

  function onKeyDown(event: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    let next: string | null = null;
    if (event.key in moves) next = dateAfter(focused, moves[event.key]);
    else if (event.key === 'PageDown' || event.key === 'PageUp') {
      // Same day of the month, or the last day when the target month is shorter.
      const target = shiftMonth(focused, event.key === 'PageDown' ? 1 : -1);
      const last = Number(dateAfter(shiftMonth(target, 1), -1).slice(8));
      next = `${target.slice(0, 8)}${String(Math.min(Number(focused.slice(8)), last)).padStart(2, '0')}`;
    } else if (event.key === 'Home' || event.key === 'End') {
      const offset = (new Date(`${focused}T12:00:00Z`).getUTCDay() + 6) % 7;
      next = dateAfter(focused, event.key === 'Home' ? -offset : 6 - offset);
    }
    if (next) { event.preventDefault(); setFocused(clampDate(next, min, max)); }
  }

  const grid = monthGrid(focused);
  const presets = shortcuts ? [{ label: 'Today', date: today }, { label: 'Tomorrow', date: dateAfter(today, 1) }, { label: 'Next week', date: dateAfter(today, 7) }].filter((p) => inRange(p.date)) : [];
  return (
    <div ref={root} className={cn('relative', className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={trigger} id={triggerId} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="inline-flex h-9 w-full min-w-44 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn('tabular', !value && 'text-muted-foreground')}>{value ? formatLongDate(value) : placeholder}</span>
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Choose a date" onKeyDown={onKeyDown} className="absolute left-0 top-full z-40 mt-2 w-72 origin-top-left animate-pop-in rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setFocused(shiftMonth(focused, -1))} className="rounded-md p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <p className="text-sm font-medium" aria-live="polite">{formatMonth(focused)}</p>
            <button type="button" aria-label="Next month" onClick={() => setFocused(shiftMonth(focused, 1))} className="rounded-md p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground" aria-hidden>{WEEKDAY_LABELS.map((d) => <span key={d} className="py-1">{d}</span>)}</div>
          <div role="grid" aria-label={formatMonth(focused)} className="grid grid-cols-7 gap-y-0.5">
            {grid.map((cell) => {
              const selected = cell.date === value;
              const isFocus = cell.date === focused;
              const off = !inRange(cell.date);
              return (
                <button
                  key={cell.date} type="button" role="gridcell" disabled={off} aria-label={formatLongDate(cell.date)} aria-selected={selected} aria-current={cell.date === today ? 'date' : undefined}
                  data-focused={isFocus} tabIndex={isFocus ? 0 : -1} onClick={() => pick(cell.date)}
                  className={cn(
                    'tabular mx-auto flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !cell.inMonth && 'text-muted-foreground/50',
                    !selected && !off && 'hover:bg-accent',
                    cell.date === today && !selected && 'border border-primary/60',
                    selected && 'bg-primary font-medium text-primary-foreground',
                    off && 'cursor-not-allowed opacity-30',
                  )}
                >{Number(cell.date.slice(8))}</button>
              );
            })}
          </div>
          {presets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
              {presets.map((p) => <button key={p.label} type="button" onClick={() => pick(p.date)} className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{p.label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

/** `2026-10-03T18:30` split into a calendar date and a time chosen in 15-minute steps. */
export function DateTimePicker({ id, value: controlled, defaultValue = '', name, onChange, min, max, disabled }: {
  id?: string; value?: string; defaultValue?: string; name?: string; onChange?: (value: string) => void; min?: string; max?: string; disabled?: boolean;
}) {
  const [own, setOwn] = React.useState(defaultValue);
  const value = controlled ?? own;
  const [date = '', time = '09:00'] = value.split('T');
  const [hour, minute] = time.split(':');
  const roundedMinute = MINUTES.includes(minute) ? minute : MINUTES[Math.floor(Number(minute) / 15)] ?? '00';
  const set = (d: string, h: string, m: string) => { const next = d ? `${d}T${h}:${m}` : ''; setOwn(next); onChange?.(next); };
  return (
    <div className="flex items-center gap-2">
      {name && <input type="hidden" name={name} value={value} />}
      <DatePicker id={id} className="flex-1" value={date} min={min} max={max} disabled={disabled} onChange={(d) => set(d, hour, roundedMinute)} shortcuts />
      <Select value={hour} disabled={disabled || !date} onValueChange={(h) => set(date, h, roundedMinute)}>
        <SelectTrigger aria-label="Hour" className="w-[4.5rem]"><SelectValue /></SelectTrigger>
        <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
      </Select>
      <span aria-hidden className="text-muted-foreground">:</span>
      <Select value={roundedMinute} disabled={disabled || !date} onValueChange={(m) => set(date, hour, m)}>
        <SelectTrigger aria-label="Minute" className="w-[4.5rem]"><SelectValue /></SelectTrigger>
        <SelectContent>{MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

/** A time of day (`HH:MM`) chosen in 15-minute steps. */
export function TimePicker({ id, value, onChange, disabled, label }: { id?: string; value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  const [hour = '09', minute = '00'] = value.split(':');
  const m = MINUTES.includes(minute) ? minute : MINUTES[Math.floor(Number(minute) / 15)] ?? '00';
  return (
    <div className="flex items-center gap-1.5">
      <Select value={hour} disabled={disabled} onValueChange={(h) => onChange(`${h}:${m}`)}>
        <SelectTrigger id={id} aria-label={`${label} hour`} className="w-[4.5rem]"><SelectValue /></SelectTrigger>
        <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
      </Select>
      <span aria-hidden className="text-muted-foreground">:</span>
      <Select value={m} disabled={disabled} onValueChange={(next) => onChange(`${hour}:${next}`)}>
        <SelectTrigger aria-label={`${label} minutes`} className="w-[4.5rem]"><SelectValue /></SelectTrigger>
        <SelectContent>{MINUTES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

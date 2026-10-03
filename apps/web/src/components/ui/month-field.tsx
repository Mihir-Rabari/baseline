'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A month and year chosen from two dropdowns; the value is `YYYY-MM`. */
export function MonthField({ id, value, onChange, label = 'Month' }: { id: string; value: string; onChange: (value: string) => void; label?: string }) {
  const [year, month] = value.split('-');
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i));
  if (!years.includes(year)) years.push(year);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Select value={month} onValueChange={(m) => onChange(`${year}-${m}`)}>
          <SelectTrigger id={id} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((name, i) => <SelectItem key={name} value={String(i + 1).padStart(2, '0')}>{name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={year} onValueChange={(y) => onChange(`${y}-${month}`)}>
          <SelectTrigger aria-label="Year" className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{years.sort().map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

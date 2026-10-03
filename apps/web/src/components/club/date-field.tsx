'use client';

import React from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';

/** A labelled date picker. Same props as before; the calendar replaces the browser's date input. */
export function DateField({ value, onChange, min, max, disabled, id = 'court-date', label = 'Date' }: {
  value: string; onChange: (date: string) => void; min: string; max: string; disabled?: boolean; id?: string; label?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <DatePicker id={id} className="w-56" value={value} min={min} max={max} disabled={disabled} onChange={onChange} />
    </div>
  );
}

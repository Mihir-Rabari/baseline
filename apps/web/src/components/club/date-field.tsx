'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DateField({ value, onChange, min, max, disabled }: {
  value: string; onChange: (date: string) => void; min: string; max: string; disabled?: boolean;
}) {
  return <div className="space-y-2"><Label htmlFor="court-date">Date</Label>
    <Input id="court-date" className="w-44" type="date" value={value} min={min} max={max} disabled={disabled}
      onChange={(event) => { const date = event.target.value; if (date >= min && date <= max) onChange(date); }} />
  </div>;
}

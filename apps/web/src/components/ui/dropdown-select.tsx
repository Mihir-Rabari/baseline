'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix cannot hold an empty-string value, so "no value" options travel as this token. */
const EMPTY = '__none__';

export interface DropdownOption { value: string; label: string }

/**
 * A dropdown that works anywhere a native select did: controlled (`value` + `onValueChange`) or
 * uncontrolled inside a form (`name` + `defaultValue`, which submits through FormData like a select).
 */
export function DropdownSelect({ id, name, value, defaultValue, onValueChange, options, disabled, className, placeholder = 'Choose…', 'aria-label': ariaLabel }: {
  id?: string; name?: string; value?: string; defaultValue?: string; onValueChange?: (value: string) => void;
  options: DropdownOption[]; disabled?: boolean; className?: string; placeholder?: string; 'aria-label'?: string;
}) {
  const encode = (v: string | undefined) => (v === undefined ? undefined : v === '' ? EMPTY : v);
  return (
    <Select name={name} value={encode(value)} defaultValue={encode(defaultValue)} disabled={disabled} onValueChange={(next) => onValueChange?.(next === EMPTY ? '' : next)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value || EMPTY} value={o.value === '' ? EMPTY : o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

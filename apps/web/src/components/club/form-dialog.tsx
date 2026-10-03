'use client';

import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The one dialog every create and edit form uses: a real <form>, so Enter submits, a visible error
 * above the buttons, a spinner while saving, and no way to close it mid-save.
 */
export function FormDialog({ open, onClose, title, description, onSubmit, submitLabel = 'Save', pending, error, children, wide }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  onSubmit: () => void | Promise<void>; submitLabel?: string; pending?: boolean; error?: string | null;
  children: React.ReactNode; wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent className={cn(wide && 'max-w-2xl')}>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <form noValidate onSubmit={(event) => { event.preventDefault(); if (!pending) void onSubmit(); }} className="grid gap-4">
          {children}
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={pending}>{pending ? `${submitLabel.replace(/\.$/, '')}…` : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled text input. */
export function Field({ id, label, hint, className, ...input }: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A labelled checkbox. */
export function CheckField({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 rounded border-input accent-primary" />
      <div><Label htmlFor={id}>{label}</Label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
    </div>
  );
}

/** Rupees typed by a person (`1,499.50`) to whole paise, or NaN when it is not a valid amount. */
export function toPaise(text: string): number {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

/** Whole paise as a plain editable rupee string (`1499.5`). */
export const fromPaise = (paise: number) => String(paise / 100);

export const errorText = (caught: unknown, fallback: string) => (caught instanceof Error && caught.message ? caught.message : fallback);

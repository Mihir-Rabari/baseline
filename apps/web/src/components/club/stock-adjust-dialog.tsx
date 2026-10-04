'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product } from '@packages/validation';
import { useAdjustStock } from '@/hooks/use-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function StockAdjustDialog({
  product,
  open,
  onClose,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const adjust = useAdjustStock();

  if (!product) return null;

  const currentStock = product.stockQty;
  const parsedDelta = Number(delta);
  const newBalance = Number.isInteger(parsedDelta) ? currentStock + parsedDelta : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!product) return;

    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setError('Enter a non-zero whole number (e.g. +5 to add, -2 to reduce).');
      return;
    }
    if (newBalance !== null && newBalance < 0) {
      setError(`Stock cannot drop below zero. Maximum reduction is -${currentStock}.`);
      return;
    }
    if (!note.trim()) {
      setError('Please provide a reason or note for this stock adjustment.');
      return;
    }

    try {
      await adjust.mutateAsync({
        id: product.id,
        data: { qtyDelta: parsedDelta, note: note.trim() },
      });
      toast.success(`Stock adjusted for ${product.name}`);
      setDelta('');
      setNote('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adjust stock.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock: {product.name}</DialogTitle>
          <DialogDescription>
            Correct stock discrepancies with an audit note. Use positive numbers to add and negative numbers to reduce.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3 text-sm">
            <div>
              <span className="text-muted-foreground">Current stock: </span>
              <strong className="tabular font-mono text-base">{currentStock}</strong>
            </div>
            {newBalance !== null && (
              <div>
                <span className="text-muted-foreground">New balance: </span>
                <strong className={`tabular font-mono text-base ${newBalance < 0 ? 'text-destructive' : 'text-primary'}`}>
                  {newBalance}
                </strong>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-delta">Change quantity (+/-)</Label>
            <Input
              id="adjust-delta"
              type="number"
              step="1"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. -2 (damaged) or +5 (found in stock)"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-note">Reason for adjustment *</Label>
            <Input
              id="adjust-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Broken in storage, physical audit count correction"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending ? 'Saving…' : 'Save adjustment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product } from '@packages/validation';
import { useDeleteProduct } from '@/hooks/use-shop';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ProductDeleteDialog({
  product,
  open,
  onClose,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const deleteMutation = useDeleteProduct();

  if (!product) return null;

  async function confirmDelete() {
    if (!product) return;
    setError(null);
    try {
      const res = await deleteMutation.mutateAsync(product.id);
      if (res && 'deactivated' in res && res.deactivated) {
        toast.info(`${product.name} was deactivated because it has past orders`);
      } else {
        toast.success(`${product.name} was deleted successfully`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete product.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setError(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {product.name}?</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove <strong className="text-foreground">{product.name}</strong> ({product.sku})?
            If this product has past orders or transaction records, it will be safely deactivated instead of deleted.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={confirmDelete}
          >
            {deleteMutation.isPending ? 'Removing…' : 'Confirm remove'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

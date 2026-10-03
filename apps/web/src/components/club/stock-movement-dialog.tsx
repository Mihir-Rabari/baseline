'use client';

import React from 'react';
import type { Product } from '@packages/validation';
import { useProductMovements } from '@/hooks/use-shop';
import { formatDateTime } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function StockMovementDialog({
  product,
  open,
  onClose,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}) {
  const query = useProductMovements(product?.id ?? null, open);

  if (!product) return null;

  const movements = query.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>Stock ledger: {product.name}</DialogTitle>
            <Badge variant="outline" className="font-mono text-xs">{product.sku}</Badge>
          </div>
          <DialogDescription>
            Audit history of all restocks, adjustments, and customer sales.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">Current balance: </span>
              <strong className="font-mono text-sm tabular">{product.stockQty}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Reorder threshold: </span>
              <span className="font-mono text-sm tabular">{product.reorderLevel}</span>
            </div>
          </div>

          {query.isPending ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load stock movements. Try again later.
            </p>
          ) : movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No stock movements recorded yet for this product.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="p-2.5 font-medium">Date</th>
                    <th className="p-2.5 font-medium">Type</th>
                    <th className="p-2.5 text-right font-medium">Change</th>
                    <th className="p-2.5 text-right font-medium">Balance</th>
                    <th className="p-2.5 font-medium">Note / Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movements.map((m) => {
                    const isPositive = m.qtyDelta > 0;
                    return (
                      <tr key={m.id}>
                        <td className="p-2.5 whitespace-nowrap text-muted-foreground">
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="p-2.5">
                          <Badge variant={isPositive ? 'success' : 'secondary'} className="text-[10px]">
                            {m.reason}
                          </Badge>
                        </td>
                        <td className={`p-2.5 text-right font-mono font-medium tabular ${isPositive ? 'text-success' : 'text-destructive'}`}>
                          {isPositive ? `+${m.qtyDelta}` : m.qtyDelta}
                        </td>
                        <td className="p-2.5 text-right font-mono tabular font-semibold">
                          {m.balanceAfter}
                        </td>
                        <td className="p-2.5 text-muted-foreground max-w-xs truncate">
                          {m.orderNumber ? `Order #${m.orderNumber}` : m.note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

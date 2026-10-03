'use client';

import React from 'react';
import type { Product } from '@packages/validation';
import { CardGrid, KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Layers, SlidersHorizontal, History, Trash2 } from 'lucide-react';

const INVENTORY_COLUMNS: KanbanColumn[] = [
  { id: 'OUT_OF_STOCK', title: 'Out of stock' },
  { id: 'LOW_STOCK', title: 'Low stock' },
  { id: 'IN_STOCK', title: 'In stock' },
];

export function inventoryStockCategory(product: Product): 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' {
  if (product.stockQty === 0) return 'OUT_OF_STOCK';
  if (product.lowStock) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export function InventoryCards({
  products,
  canAdjust,
  canUpdate,
  onRestock,
  onEdit,
  onAdjust,
  onHistory,
  onDelete,
}: {
  products: Product[];
  canAdjust: boolean;
  canUpdate: boolean;
  onRestock: (product: Product) => void;
  onEdit: (product: Product) => void;
  onAdjust?: (product: Product) => void;
  onHistory?: (product: Product) => void;
  onDelete?: (product: Product) => void;
}) {
  return (
    <CardGrid>
      {products.map((p) => {
        const outOfStock = p.stockQty === 0;
        return (
          <article
            key={p.id}
            className="flex flex-col justify-between space-y-3 rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {p.isActive === false && (
                    <Badge variant="outline" className="text-muted-foreground border-dashed">
                      Inactive
                    </Badge>
                  )}
                  {outOfStock ? (
                    <Badge variant="destructive">Out of stock</Badge>
                  ) : p.lowStock ? (
                    <Badge variant="warning">Low stock</Badge>
                  ) : (
                    <Badge variant="outline">In stock</Badge>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">{p.name}</h3>
                <p className="text-xs capitalize text-muted-foreground">{p.category.toLowerCase()}</p>
              </div>

              <div className="flex items-center justify-between border-t pt-2 text-xs">
                <div className="flex items-center gap-1">
                  <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span>
                    Stock:{' '}
                    <strong className={`tabular ${outOfStock ? 'text-destructive' : ''}`}>
                      {p.stockQty}
                    </strong>
                  </span>
                </div>
                <span className="text-muted-foreground">Reorder at {p.reorderLevel}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t pt-2">
              {onHistory && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  title="View stock history ledger"
                  onClick={() => onHistory(p)}
                >
                  <History className="h-4 w-4" aria-hidden />
                  <span className="sr-only">History</span>
                </Button>
              )}
              {canAdjust && onAdjust && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  title="Adjust stock discrepancy"
                  onClick={() => onAdjust(p)}
                >
                  <SlidersHorizontal className="mr-1 h-4 w-4" aria-hidden />
                  Adjust
                </Button>
              )}
              {canAdjust && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => onRestock(p)}
                >
                  Restock
                </Button>
              )}
              {canUpdate && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  aria-label={`Edit ${p.name}`}
                  onClick={() => onEdit(p)}
                >
                  Edit
                </Button>
              )}
              {canUpdate && onDelete && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => onDelete(p)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </article>
        );
      })}
    </CardGrid>
  );
}

export function InventoryBoard({
  products,
  canAdjust,
  canUpdate,
  onRestock,
  onEdit,
  onAdjust,
  onHistory,
  onDelete,
}: {
  products: Product[];
  canAdjust: boolean;
  canUpdate: boolean;
  onRestock: (product: Product) => void;
  onEdit: (product: Product) => void;
  onAdjust?: (product: Product) => void;
  onHistory?: (product: Product) => void;
  onDelete?: (product: Product) => void;
}) {
  return (
    <KanbanBoard
      columns={INVENTORY_COLUMNS}
      items={products}
      idOf={(p) => p.id}
      columnOf={inventoryStockCategory}
      emptyLabel="No items"
      renderCard={(p) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-1">
            <span className="font-mono text-[11px] text-muted-foreground">{p.sku}</span>
            <div className="flex items-center gap-1">
              {p.isActive === false && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed px-1 py-0">
                  Inactive
                </Badge>
              )}
              <span className="text-[11px] capitalize text-muted-foreground">{p.category.toLowerCase()}</span>
            </div>
          </div>

          <h4 className="text-sm font-semibold text-foreground leading-snug">{p.name}</h4>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Qty: <strong className="tabular text-foreground">{p.stockQty}</strong>
            </span>
            <span>Reorder: {p.reorderLevel}</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-1.5">
            {onHistory && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                title="View stock history"
                onClick={() => onHistory(p)}
              >
                <History className="h-4 w-4" aria-hidden />
              </Button>
            )}
            {canAdjust && onAdjust && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-1.5 text-[11px]"
                onClick={() => onAdjust(p)}
              >
                Adjust
              </Button>
            )}
            {canAdjust && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => onRestock(p)}
              >
                Restock
              </Button>
            )}
            {canUpdate && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                aria-label={`Edit ${p.name}`}
                onClick={() => onEdit(p)}
              >
                Edit
              </Button>
            )}
            {canUpdate && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                aria-label={`Delete ${p.name}`}
                onClick={() => onDelete(p)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      )}
    />
  );
}

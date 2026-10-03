'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import type { Product, ProductCategory } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useShopProducts, useRestock } from '@/hooks/use-shop';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ProductDialog } from '@/components/club/product-dialog';
import { StockAdjustDialog } from '@/components/club/stock-adjust-dialog';
import { StockMovementDialog } from '@/components/club/stock-movement-dialog';
import { ProductDeleteDialog } from '@/components/club/product-delete-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { InventoryBoard, InventoryCards } from '@/components/club/inventory-views';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';
import { categoryName, categoryOptions, useCategories } from '@/hooks/use-categories';
import { Search, History, SlidersHorizontal, Trash2 } from 'lucide-react';

const INVENTORY_VIEWS: ViewKind[] = ['list', 'cards', 'board'];

export default function InventoryPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('products:read') && hasPermission('inventory:read');
  const canAdjust = hasPermission('inventory:adjust');
  const canUpdate = hasPermission('products:update');
  const canCreate = hasPermission('products:create');

  const [view, setView] = useViewPreference('inventory', INVENTORY_VIEWS, 'list');
  const [low, setLow] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const categoryList = useCategories('PRODUCT');
  const categoryFilter = [{ value: 'ALL', label: 'All categories' }, ...categoryOptions(categoryList.data)];

  // Dialog states
  const [creating, setCreating] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  // Quick Restock form states
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const restock = useRestock();

  const query = useShopProducts(
    {
      limit: 100,
      lowStock: low ? 'true' : undefined,
      category: category !== 'ALL' ? (category as ProductCategory) : undefined,
      q: search.trim() ? search.trim() : undefined,
    },
    'staff',
    allowed
  );

  if (!user) return null;

  const startRestock = (p: Product) => {
    setRestockProduct(p);
    setQty('');
    setNote('');
    setFormError('');
    restock.reset();
  };

  const allProducts = (query.data?.data as Product[]) ?? [];
  // Client-side filtering when mock or query doesn't filter search/category in unit tests
  const filteredProducts = allProducts.filter((p) => {
    if (low && !p.lowStock && p.stockQty > 0) return false;
    if (category !== 'ALL' && p.category !== category) return false;
    if (search.trim()) {
      const term = search.toLowerCase();
      const matchName = p.name.toLowerCase().includes(term);
      const matchSku = p.sku.toLowerCase().includes(term);
      if (!matchName && !matchSku) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Track the club shop stock, restock products and adjust discrepancies."
        actions={
          <>
            <ViewSwitcher views={INVENTORY_VIEWS} value={view} onChange={setView} />
            {canCreate && (
              <Button onClick={() => setCreating(true)}>New product</Button>
            )}
          </>
        }
      />

      {!allowed ? (
        <EmptyState
          title="Inventory is unavailable"
          description="Ask the front desk for stock information."
        />
      ) : (
        <>
          {/* Filters & Search toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="inventory-search"
                  type="search"
                  placeholder="Search by name or SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-8 text-xs"
                />
              </div>

              <div className="w-40">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category-filter" className="h-9 text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryFilter.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="text-xs">
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pl-2">
                <Switch
                  id="low-stock"
                  checked={low}
                  onCheckedChange={setLow}
                />
                <Label htmlFor="low-stock" className="text-xs font-medium cursor-pointer">
                  Low stock only
                </Label>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Showing <strong className="tabular text-foreground">{filteredProducts.length}</strong> items
            </div>
          </div>

          {/* Data rendering states */}
          {query.error ? (
            <PageError error={query.error} onRetry={() => { void query.refetch(); }} />
          ) : query.isPending ? (
            <div role="status" aria-label="Loading inventory">
              <Skeleton className="h-80" />
            </div>
          ) : !filteredProducts.length ? (
            <EmptyState
              title="No products match"
              description="Change your search filters or add a new product."
              action={
                search || category !== 'ALL' || low ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('');
                      setCategory('ALL');
                      setLow(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : view === 'board' ? (
            <InventoryBoard
              products={filteredProducts}
              canAdjust={canAdjust}
              canUpdate={canUpdate}
              onRestock={startRestock}
              onEdit={(p) => setEditingProduct(p)}
              onAdjust={(p) => setAdjustProduct(p)}
              onHistory={(p) => setHistoryProduct(p)}
              onDelete={(p) => setDeleteProduct(p)}
            />
          ) : view === 'cards' ? (
            <InventoryCards
              products={filteredProducts}
              canAdjust={canAdjust}
              canUpdate={canUpdate}
              onRestock={startRestock}
              onEdit={(p) => setEditingProduct(p)}
              onAdjust={(p) => setAdjustProduct(p)}
              onHistory={(p) => setHistoryProduct(p)}
              onDelete={(p) => setDeleteProduct(p)}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['SKU', 'Name', 'Category', 'Stock', 'Reorder level', 'Status', 'Actions'].map((name) => (
                      <TableHead
                        key={name}
                        className={name === 'Stock' ? 'text-right' : undefined}
                      >
                        {name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p) => {
                    const outOfStock = p.stockQty === 0;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.sku}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          <button
                            type="button"
                            className="hover:underline text-left"
                            onClick={() => setHistoryProduct(p)}
                            title="View history"
                          >
                            {p.name}
                          </button>
                        </TableCell>
                        <TableCell className="capitalize text-xs">
                          {categoryName(categoryList.data, p.category)}
                        </TableCell>
                        <TableCell className="text-right tabular font-mono font-medium">
                          <span className={outOfStock ? 'text-destructive font-bold' : ''}>
                            {p.stockQty}
                          </span>
                        </TableCell>
                        <TableCell className="tabular font-mono text-xs">
                          {p.reorderLevel}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {p.isActive === false && (
                              <Badge variant="outline" className="text-muted-foreground border-dashed text-[10px]">
                                Inactive
                              </Badge>
                            )}
                            {outOfStock ? (
                              <Badge variant="destructive">Out of stock</Badge>
                            ) : p.lowStock ? (
                              <Badge variant="warning">Low</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="space-x-1.5 whitespace-nowrap text-right">
                          {canAdjust && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => startRestock(p)}
                            >
                              Restock {p.name}
                            </Button>
                          )}
                          {canAdjust && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              title="Adjust count discrepancy"
                              onClick={() => setAdjustProduct(p)}
                            >
                              <SlidersHorizontal className="mr-1 h-3 w-3" />
                              Adjust
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="View movement history"
                            onClick={() => setHistoryProduct(p)}
                          >
                            <History className="h-3.5 w-3.5" />
                            <span className="sr-only">History</span>
                          </Button>
                          {canUpdate && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              aria-label={`Edit ${p.name}`}
                              onClick={() => setEditingProduct(p)}
                            >
                              Edit
                            </Button>
                          )}
                          {canUpdate && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10"
                              aria-label={`Delete ${p.name}`}
                              title="Delete product"
                              onClick={() => setDeleteProduct(p)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Restock Dialog */}
      <Dialog
        open={Boolean(restockProduct)}
        onOpenChange={(open) => {
          if (!open) setRestockProduct(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restock {restockProduct?.name}</DialogTitle>
            <DialogDescription>Record the quantity received into the shop.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!restockProduct || !canAdjust) return;
              if (!Number.isInteger(Number(qty)) || Number(qty) <= 0) {
                setFormError('Enter a whole quantity greater than zero.');
                return;
              }
              try {
                await restock.mutateAsync({
                  id: restockProduct.id,
                  data: { qty: Number(qty), note: note || undefined },
                });
                toast.success('Stock updated');
                setRestockProduct(null);
              } catch {
                /* Mutation error stays visible for retry. */
              }
            }}
          >
            <Label htmlFor="restock-qty">Quantity</Label>
            <Input
              id="restock-qty"
              type="number"
              min="1"
              step="1"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              autoComplete="off"
            />
            <Label htmlFor="restock-note">Note</Label>
            <Input
              id="restock-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Shipment received, invoice ref"
            />
            {(formError || restock.error) && (
              <p role="alert" className="text-destructive text-xs">
                {formError || restock.error?.message}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRestockProduct(null)}
              >
                Cancel
              </Button>
              <Button disabled={restock.isPending}>Save restock</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock Adjust Dialog */}
      <StockAdjustDialog
        product={adjustProduct}
        open={Boolean(adjustProduct)}
        onClose={() => setAdjustProduct(null)}
      />

      {/* Stock Movement History Ledger Dialog */}
      <StockMovementDialog
        product={historyProduct}
        open={Boolean(historyProduct)}
        onClose={() => setHistoryProduct(null)}
      />

      {/* Create Product Dialog */}
      <ProductDialog
        key={`new-${creating}`}
        product={null}
        open={creating}
        onClose={() => setCreating(false)}
      />

      {/* Edit Product Dialog */}
      <ProductDialog
        key={`edit-${editingProduct?.id ?? 'none'}`}
        product={editingProduct}
        open={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        onDeleteRequest={(p) => setDeleteProduct(p)}
      />

      {/* Delete / Deactivate Product Confirmation Dialog */}
      <ProductDeleteDialog
        product={deleteProduct}
        open={Boolean(deleteProduct)}
        onClose={() => setDeleteProduct(null)}
      />
    </div>
  );
}

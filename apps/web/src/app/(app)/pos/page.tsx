'use client';

import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search,
  ScanBarcode,
  RotateCcw,
  Trash2,
  Plus,
  Minus,
  Keyboard,
  CreditCard,
  Banknote,
  QrCode,
  ShoppingBag,
} from 'lucide-react';
import type { MemberLookupItem, PaymentMethod, PublicProduct, Product, Order } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useShopProducts, useShopQuote } from '@/hooks/use-shop';
import { useShopCart } from '@/hooks/use-shop-cart';
import { shopApi } from '@/lib/shop-api';
import {
  POS_CATEGORIES,
  type PosCategory,
  filterPosProducts,
  findBarcodeOrExactSkuMatch,
  calculateCashChange,
  getQuickCashNotesPaise,
} from '@/lib/pos-filter';
import { MemberSearch } from '@/components/club/member-search';
import { Money } from '@/components/club/money';
import { OrderDetailDialog } from '@/components/club/order-detail-dialog';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function stockErrorLine(error: Error | null | undefined, index: number, productId: string): boolean {
  if (!error || !('details' in error)) return false;
  const details = (error as unknown as { details: unknown }).details;
  if (Array.isArray(details)) {
    return details.some(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'field' in entry &&
        (entry as { field: string }).field === `items[${index}].productId`
    );
  }
  return (
    typeof details === 'object' &&
    details !== null &&
    'productId' in details &&
    (details as { productId: string }).productId === productId
  );
}

export default function PosPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('orders:create') && hasPermission('products:read');
  const client = useQueryClient();

  // Filter & Search states
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<PosCategory>('ALL');
  const [inStockOnly, setInStockOnly] = useState(false);

  // Customer & Cart states
  const [member, setMember] = useState<MemberLookupItem | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [tenderedInput, setTenderedInput] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();
  const customerNameId = useId();

  // Data fetching
  const productsQuery = useShopProducts({ limit: 100 }, 'staff', allowed);
  const cart = useShopCart();

  const allProducts = useMemo(() => {
    return (productsQuery.data?.data ?? []) as Product[];
  }, [productsQuery.data?.data]);

  // Filter products client-side for rapid feedback
  const filteredProducts = useMemo(() => {
    return filterPosProducts(allProducts, {
      q,
      category,
      inStockOnly,
    });
  }, [allProducts, q, category, inStockOnly]);

  const items = useMemo(() => {
    return cart.lines.map((line) => ({
      productId: line.product.id,
      qty: line.qty,
    }));
  }, [cart.lines]);

  const quote = useShopQuote({ items, memberId: member?.id }, allowed);

  // Payment mutation
  const pay = useMutation({
    mutationFn: (method: PaymentMethod) =>
      shopApi.pos({
        items,
        memberId: member?.id,
        customerName: customerName.trim() ? customerName.trim() : undefined,
        paymentMethod: method,
      }),
    onSuccess: (order) => {
      toast.success(`Order ${order.orderNumber} paid successfully`);
      setCompletedOrder(order);
      setShowReceipt(true);
      cart.clear();
      setMember(null);
      setCustomerName('');
      setTenderedInput('');
      client.invalidateQueries({ queryKey: ['products'] });
      client.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Calculate cash change
  const totalPaise = quote.data?.totalPaise ?? 0;
  const tenderedPaise = Math.round((parseFloat(tenderedInput) || 0) * 100);
  const cashChangePaise = calculateCashChange(totalPaise, tenderedPaise);
  const quickCashNotes = useMemo(() => getQuickCashNotesPaise(totalPaise), [totalPaise]);

  // Handle barcode / SKU scanner input on Enter
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;

    const matched = findBarcodeOrExactSkuMatch(allProducts, q);
    if (matched) {
      if (!matched.inStock) {
        toast.error(`"${matched.name}" is sold out`);
        return;
      }
      cart.add(matched as PublicProduct);
      toast.success(`Added "${matched.name}" to cart`);
      setQ('');
    } else if (filteredProducts.length === 1) {
      const single = filteredProducts[0];
      if (!single.inStock) {
        toast.error(`"${single.name}" is sold out`);
        return;
      }
      cart.add(single as PublicProduct);
      toast.success(`Added "${single.name}" to cart`);
      setQ('');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore when typing in an input other than search, unless it's a function key
      const isInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;

      if (event.key === '/' && !isInput) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (event.key === 'F2') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (event.key === 'Escape') {
        if (q) {
          setQ('');
        }
      } else if (event.key === 'F8' || (event.altKey && event.key === '1')) {
        event.preventDefault();
        setPaymentMethod('CASH');
      } else if (event.key === 'F9' || (event.altKey && event.key === '2')) {
        event.preventDefault();
        setPaymentMethod('CARD');
      } else if (event.key === 'F10' || (event.altKey && event.key === '3')) {
        event.preventDefault();
        setPaymentMethod('UPI');
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (
          items.length > 0 &&
          !pay.isPending &&
          !quote.isPending &&
          !quote.error &&
          !quote.data?.items.some((line) => !line.inStock)
        ) {
          pay.mutate(paymentMethod);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [q, items.length, pay, paymentMethod, quote]);

  if (!user) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Counter sale"
          description="Take a shop payment, scan barcodes, apply member discounts, and calculate cash change."
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowShortcuts(true)}
            aria-label="View keyboard shortcuts"
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Shortcuts</span>
          </Button>
        </div>
      </div>

      {!allowed ? (
        <EmptyState
          title="Counter sales are unavailable"
          description="Ask the front desk or club manager to take this payment."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_440px]">
          {/* LEFT CATALOG COLUMN */}
          <section className="space-y-4" aria-label="Product Catalog">
            {/* Search & Barcode Bar */}
            <form onSubmit={handleBarcodeSubmit} className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  id={searchInputId}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search products by name, SKU, barcode (press Enter to scan)…"
                  className="pl-9 pr-16"
                  aria-label="Search products"
                />
                <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-muted-foreground">
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                    /
                  </kbd>
                </div>
              </div>
              <Button
                type="submit"
                variant="secondary"
                className="gap-1.5 shrink-0"
                title="Scan barcode or exact SKU match"
              >
                <ScanBarcode className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Scan</span>
              </Button>
              {q && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQ('')}
                  aria-label="Clear search"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </form>

            {/* Category Pills & Filters */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div
                role="tablist"
                aria-label="Product categories"
                className="flex flex-wrap gap-1.5"
              >
                {POS_CATEGORIES.map((cat) => {
                  const isActive = category === cat.key;
                  return (
                    <button
                      key={cat.key}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setCategory(cat.key)}
                      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'border bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <span>In stock only</span>
                </label>
                <span>
                  {filteredProducts.length}{' '}
                  {filteredProducts.length === 1 ? 'item' : 'items'}
                </span>
              </div>
            </div>

            {/* Product Cards Grid */}
            {productsQuery.error ? (
              <PageError
                error={productsQuery.error}
                onRetry={() => {
                  productsQuery.refetch();
                }}
              />
            ) : productsQuery.isPending ? (
              <div
                role="status"
                aria-label="Loading products"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <ShoppingBag className="mx-auto h-4 w-4 text-muted-foreground/50 mb-2" aria-hidden="true" />
                <p className="font-medium text-sm">No products found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try adjusting your search query or selecting another category.
                </p>
                {(q || category !== 'ALL' || inStockOnly) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 text-xs"
                    onClick={() => {
                      setQ('');
                      setCategory('ALL');
                      setInStockOnly(false);
                    }}
                  >
                    Reset filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.map((p) => {
                  const inCartLine = cart.lines.find((line) => line.product.id === p.id);
                  const inCartQty = inCartLine?.qty ?? 0;
                  const discountPct = member?.shopDiscountPct ?? 0;
                  const memberPricePaise =
                    discountPct > 0
                      ? Math.round((p.pricePaise * (100 - discountPct)) / 100)
                      : p.pricePaise;

                  return (
                    <button
                      key={p.id}
                      disabled={!p.inStock || pay.isPending}
                      onClick={() => cart.add(p as PublicProduct)}
                      className={`group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:hover:border-border disabled:hover:shadow-none ${
                        inCartQty > 0
                          ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                          : 'bg-card'
                      }`}
                    >
                      <div className="space-y-1 w-full">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] text-muted-foreground uppercase">
                            {p.sku}
                          </span>
                          {inCartQty > 0 && (
                            <Badge
                              variant="default"
                              className="h-5 px-1.5 text-[10px] font-semibold"
                            >
                              {inCartQty} in cart
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium text-sm line-clamp-1 group-hover:text-primary transition-colors">
                          {p.name}
                        </p>
                      </div>

                      <div className="mt-3 flex items-end justify-between gap-2 pt-2 border-t border-border/50">
                        <div>
                          {discountPct > 0 ? (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-semibold text-primary">
                                <Money paise={memberPricePaise} />
                              </span>
                              <span className="text-xs text-muted-foreground line-through">
                                <Money paise={p.pricePaise} />
                              </span>
                            </div>
                          ) : (
                            <div className="text-sm font-semibold">
                              <Money paise={p.pricePaise} />
                            </div>
                          )}
                        </div>

                        <div>
                          {!p.inStock ? (
                            <span className="text-[11px] font-medium text-destructive">
                              Sold out
                            </span>
                          ) : p.lowStock ? (
                            <span className="text-[11px] font-medium text-warning">
                              Low stock ({p.stockQty})
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {p.stockQty} in stock
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* RIGHT CART & TENDER COLUMN */}
          <aside
            aria-label="Order Cart and Payment"
            className="space-y-4 rounded-xl border bg-card p-4 shadow-sm h-fit sticky top-4"
          >
            {/* Customer & Member Section */}
            <div className="space-y-3 pb-3 border-b">
              {hasPermission('members:read') && (
                <MemberSearch
                  value={member}
                  onChange={setMember}
                  disabled={pay.isPending}
                />
              )}

              <div className="space-y-1.5">
                <Label htmlFor={customerNameId} className="text-xs">
                  Walk-in customer name (optional)
                </Label>
                <Input
                  id={customerNameId}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. John Doe"
                  disabled={pay.isPending}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Cart Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Cart</h2>
                <Badge variant="secondary" className="text-xs">
                  {cart.lines.reduce((sum, l) => sum + l.qty, 0)} items
                </Badge>
              </div>
              {cart.lines.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cart.clear}
                  disabled={pay.isPending}
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  aria-label="Clear cart"
                >
                  <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />
                  Clear
                </Button>
              )}
            </div>

            {/* Cart Items List */}
            {cart.lines.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                <ShoppingBag className="mx-auto h-4 w-4 opacity-40 mb-1" aria-hidden="true" />
                <p className="text-sm font-medium">Add products to start an order.</p>
                <p className="text-xs mt-0.5">Click product cards or scan barcodes to add.</p>
              </div>
            ) : (
              <ul className="divide-y max-h-[260px] overflow-y-auto pr-1">
                {cart.lines.map((line, index) => {
                  const priced = quote.data?.items.find(
                    (item) => item.productId === line.product.id
                  );
                  const isStockError = stockErrorLine(
                    quote.error || pay.error,
                    index,
                    line.product.id
                  );

                  return (
                    <li key={line.product.id} className="space-y-1.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm font-medium leading-tight truncate ${
                              isStockError ? 'text-destructive font-semibold' : ''
                            }`}
                          >
                            {line.product.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono">
                            {line.product.sku}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Money
                            paise={
                              priced?.lineTotalPaise ??
                              line.product.pricePaise * line.qty
                            }
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-6 p-0"
                            disabled={pay.isPending}
                            aria-label={`Decrease ${line.product.name}`}
                            onClick={() => cart.quantity(line.product.id, line.qty - 1)}
                          >
                            <Minus className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <span
                            className="w-7 text-center text-xs tabular font-medium"
                            aria-label={`Quantity for ${line.product.name}`}
                          >
                            {line.qty}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-6 p-0"
                            disabled={pay.isPending || line.qty >= 1000}
                            aria-label={`Increase ${line.product.name}`}
                            onClick={() => cart.quantity(line.product.id, line.qty + 1)}
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                          disabled={pay.isPending}
                          aria-label={`Remove ${line.product.name}`}
                          onClick={() => cart.quantity(line.product.id, 0)}
                        >
                          Remove {line.product.name}
                        </Button>
                      </div>

                      {priced?.inStock === false && (
                        <p className="text-xs text-destructive">
                          Insufficient stock. Reduce this quantity.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {(quote.error || pay.error) && (
              <p role="alert" className="text-xs text-destructive">
                {(quote.error || pay.error)?.message}
              </p>
            )}

            {/* Price Breakdown */}
            {quote.data && cart.lines.length > 0 && (
              <div className="space-y-1.5 border-t pt-3 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>
                    <Money paise={quote.data.subtotalPaise} />
                  </span>
                </div>
                {quote.data.discountPaise > 0 && (
                  <div className="flex justify-between text-success font-medium">
                    <span>
                      Member discount ({quote.data.discountPct}%)
                    </span>
                    <span>
                      -<Money paise={quote.data.discountPaise} />
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold pt-1.5 border-t border-border/60">
                  <span>Total Due</span>
                  <span className="text-primary">
                    <Money paise={quote.data.totalPaise} />
                  </span>
                </div>
              </div>
            )}

            {/* Payment Method Selector */}
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">Payment Method</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { method: 'CASH', label: 'Cash', icon: Banknote, key: 'F8' },
                    { method: 'CARD', label: 'Card', icon: CreditCard, key: 'F9' },
                    { method: 'UPI', label: 'UPI', icon: QrCode, key: 'F10' },
                  ] as const
                ).map(({ method, label, icon: Icon, key }) => {
                  const isSelected = paymentMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      disabled={pay.isPending}
                      onClick={() => setPaymentMethod(method)}
                      className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{label}</span>
                      <span className="text-[9px] opacity-75 font-mono">{key}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cash Tender Calculator */}
            {paymentMethod === 'CASH' && cart.lines.length > 0 && (
              <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tendered-input" className="text-xs font-medium">
                    Cash Tendered
                  </Label>
                  {tenderedInput && (
                    <button
                      type="button"
                      onClick={() => setTenderedInput('')}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      ₹
                    </span>
                    <Input
                      id="tendered-input"
                      type="number"
                      step="any"
                      min="0"
                      placeholder={(totalPaise / 100).toFixed(2)}
                      value={tenderedInput}
                      onChange={(e) => setTenderedInput(e.target.value)}
                      className="h-8 pl-6 text-xs"
                    />
                  </div>
                </div>

                {/* Quick cash notes pills */}
                <div className="flex flex-wrap gap-1">
                  {quickCashNotes.map((notePaise) => (
                    <button
                      key={notePaise}
                      type="button"
                      onClick={() => setTenderedInput((notePaise / 100).toString())}
                      className="rounded border bg-background px-2 py-0.5 text-[10px] font-medium hover:bg-muted"
                    >
                      {notePaise === totalPaise ? 'Exact' : `₹${notePaise / 100}`}
                    </button>
                  ))}
                </div>

                {/* Change or Split balance calculation */}
                {tenderedPaise > 0 && tenderedPaise < totalPaise && (
                  <div className="flex items-center justify-between rounded bg-background p-2 border">
                    <span className="font-medium text-muted-foreground">Remaining balance</span>
                    <span className="font-bold text-primary">
                      <Money paise={totalPaise - tenderedPaise} />
                    </span>
                  </div>
                )}
                {tenderedPaise >= totalPaise && (
                  <div className="flex items-center justify-between rounded bg-background p-2 border">
                    <span className="font-medium text-muted-foreground">Change to return</span>
                    <span className="font-bold text-success">
                      <Money paise={cashChangePaise} />
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Payment Action Button */}
            <div className="pt-2">
              <Button
                className="w-full h-10 gap-2 text-sm font-semibold"
                disabled={
                  !items.length ||
                  pay.isPending ||
                  quote.isPending ||
                  quote.isFetching ||
                  Boolean(quote.error) ||
                  quote.data?.items.some((line) => !line.inStock)
                }
                onClick={() => pay.mutate(paymentMethod)}
              >
                {pay.isPending ? (
                  'Processing sale…'
                ) : (
                  <>
                    Pay {paymentMethod === 'CASH' ? 'cash' : paymentMethod === 'CARD' ? 'card' : 'UPI'}
                  </>
                )}
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-primary" aria-hidden="true" />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription>
              Speed up checkout operations with POS shortcuts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Focus search / barcode input</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                / or F2
              </kbd>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Scan item & add to cart</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                Enter (in search)
              </kbd>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Clear search query</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                Esc
              </kbd>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Select Cash payment</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                F8 or Alt+1
              </kbd>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Select Card payment</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                F9 or Alt+2
              </kbd>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">Select UPI payment</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                F10 or Alt+3
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Complete & submit sale</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono font-semibold">
                Ctrl + Enter
              </kbd>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Receipt Dialog */}
      <OrderDetailDialog
        order={completedOrder}
        open={showReceipt}
        onOpenChange={(open) => {
          setShowReceipt(open);
          if (!open) {
            setCompletedOrder(null);
          }
        }}
      />
    </div>
  );
}

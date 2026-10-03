'use client';
import React from 'react';
import type { QuoteOrderResponse } from '@packages/validation';
import type { CartLine } from '@/hooks/use-shop-cart';
import { Button } from '@/components/ui/button';
import { Money } from './money';
function stockErrorLine(error: Error | null | undefined, index: number, productId: string): boolean {
  if (!error || !("details" in error)) return false;
  const details = error.details;
  if (Array.isArray(details)) return details.some((entry: unknown) => typeof entry === "object" && entry !== null && "field" in entry && entry.field === `items[${index}].productId`);
  return typeof details === "object" && details !== null && "productId" in details && details.productId === productId;
}
export function Cart({ lines, onQuantity, quote, error, disabled = false }: { lines: CartLine[]; onQuantity: (id: string, qty: number) => void; quote?: QuoteOrderResponse; error?: Error | null; disabled?: boolean }) {
  return <section aria-label="Cart" className="space-y-4"><h2 className="text-lg font-semibold">Cart</h2>{lines.length === 0 ? <p className="text-sm text-muted-foreground">Add products to start an order.</p> : <ul className="divide-y">{lines.map((line, index) => { const priced = quote?.items.find((item) => item.productId === line.product.id); return <li key={line.product.id} className="space-y-2 py-3"><div className="flex items-start justify-between gap-3"><p className={stockErrorLine(error, index, line.product.id) ? "font-medium text-destructive" : "font-medium"}>{line.product.name}</p><Money paise={priced?.lineTotalPaise ?? line.product.pricePaise * line.qty} /></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={disabled} aria-label={`Decrease ${line.product.name}`} onClick={() => onQuantity(line.product.id, line.qty - 1)}>−</Button><span className="tabular" aria-label={`Quantity for ${line.product.name}`}>{line.qty}</span><Button size="sm" variant="outline" disabled={disabled || line.qty >= 1000} aria-label={`Increase ${line.product.name}`} onClick={() => onQuantity(line.product.id, line.qty + 1)}>+</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onQuantity(line.product.id, 0)}>Remove {line.product.name}</Button></div>{priced?.inStock === false && <p className="text-sm text-destructive">Insufficient stock. Reduce this quantity.</p>}</li>; })}</ul>}{error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}{quote && <dl className="space-y-2 border-t pt-3 text-sm">{[['Subtotal', quote.subtotalPaise], ['Member discount', -quote.discountPaise], ['Delivery', quote.deliveryFeePaise], ['Total', quote.totalPaise]].map(([label, paise]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd><Money paise={Number(paise)} /></dd></div>)}</dl>}</section>;
}

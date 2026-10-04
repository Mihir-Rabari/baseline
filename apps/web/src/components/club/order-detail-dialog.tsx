'use client';

import React from 'react';
import type { Order } from '@packages/validation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/club/status-badge';
import { Money } from '@/components/club/money';
import { formatDateTime } from '@/lib/format';
import { Printer } from 'lucide-react';

export function OrderDetailDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!order) return null;

  const isPos = order.channel === 'POS';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between pr-4">
            <DialogTitle className="font-mono text-xl">{order.orderNumber}</DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant={isPos ? 'default' : 'outline'}>
                {isPos ? 'Counter POS' : order.fulfilment === 'DELIVERY' ? 'Delivery' : 'Pickup'}
              </Badge>
              <StatusBadge kind="order" value={order.status} />
            </div>
          </div>
          <DialogDescription>
            Placed on {order.createdAt ? formatDateTime(order.createdAt) : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Printable Receipt Header (Issue #78) */}
        <div className="hidden print:block border-b pb-3 mb-2 space-y-1" data-testid="printable-receipt-header">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Receipt · {order.orderNumber}</h1>
          <p className="text-xs text-neutral-600">Placed on {order.createdAt ? formatDateTime(order.createdAt) : ''}</p>
        </div>

        <div className="space-y-4 py-2 text-sm" data-testid="order-receipt-content">
          {/* Customer info */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-1 print:border-neutral-300 print:bg-white print:text-black">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider print:text-neutral-700">
              Customer Details
            </div>
            <div className="font-medium print:text-black">
              {order.member?.fullName ?? order.customerName ?? 'Walk-in customer'}
            </div>
            {order.member && (
              <div className="font-mono text-xs text-muted-foreground print:text-neutral-700">
                Member Code: {order.member.memberCode}
              </div>
            )}
            {order.deliveryAddress && (
              <div className="text-xs text-muted-foreground print:text-neutral-700">
                Delivery address: {order.deliveryAddress}
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider print:text-neutral-700">
              Items Purchased
            </div>
            <div className="divide-y rounded-lg border print:border-neutral-300 print:bg-white print:text-black">
              {(order.items ?? []).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 text-sm print:text-black">
                  <div>
                    <div className="font-medium print:text-black">{item.name}</div>
                    <div className="text-xs text-muted-foreground print:text-neutral-700">
                      {item.qty} &times; <Money paise={item.unitPricePaise} />
                      {item.discountPct > 0 && ` (${item.discountPct}% off)`}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums font-semibold print:text-black">
                    <Money paise={item.lineTotalPaise} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment summary */}
          <div className="rounded-lg border bg-card p-3 space-y-2 print:border-neutral-300 print:bg-white print:text-black">
            <div className="flex justify-between text-muted-foreground print:text-neutral-700">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums print:text-black"><Money paise={order.subtotalPaise ?? 0} /></span>
            </div>
            {(order.discountPaise ?? 0) > 0 && (
              <div className="flex justify-between text-primary print:text-black">
                <span>Member discount</span>
                <span className="font-mono tabular-nums">-<Money paise={order.discountPaise} /></span>
              </div>
            )}
            {(order.deliveryFeePaise ?? 0) > 0 && (
              <div className="flex justify-between text-muted-foreground print:text-neutral-700">
                <span>Delivery fee</span>
                <span className="font-mono tabular-nums print:text-black"><Money paise={order.deliveryFeePaise} /></span>
              </div>
            )}
            <div className="border-t pt-2 flex justify-between font-semibold text-base print:border-neutral-300 print:text-black">
              <span>Total Paid</span>
              <span className="font-mono tabular-nums text-primary print:text-black"><Money paise={order.totalPaise ?? 0} /></span>
            </div>
            <div className="flex justify-between items-center pt-1 text-xs">
              <span className="text-muted-foreground print:text-neutral-700">Payment Status</span>
              <Badge variant={order.paymentStatus === 'PAID' ? 'outline' : 'destructive'} className="print:border-black print:text-black">
                {order.paymentStatus ?? 'PAID'}
              </Badge>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="gap-1.5"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print receipt
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

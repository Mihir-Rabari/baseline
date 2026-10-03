'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethod } from '@packages/validation';
import { toast } from 'sonner';
import { invoiceApi } from '@/lib/invoice-api';
import { Money } from '@/components/club/money';
import { StatusBadge } from '@/components/club/status-badge';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ExternalLink } from 'lucide-react';

export function InvoiceDetailDialog({
  invoiceId,
  open,
  onClose,
  canPay,
  canVoid,
  canSend,
}: {
  invoiceId: string | null;
  open: boolean;
  onClose: () => void;
  canPay: boolean;
  canVoid: boolean;
  canSend: boolean;
}) {
  const client = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['invoices', 'detail', invoiceId],
    queryFn: () => (invoiceId ? invoiceApi.get(invoiceId) : null),
    enabled: Boolean(open && invoiceId),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceId) return;
      await invoiceApi.send(invoiceId);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice marked sent');
    },
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceId) return;
      await invoiceApi.pay(invoiceId, {
        method,
        amountPaise: amount ? Math.round(Number(amount) * 100) : undefined,
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['invoices'] });
      setPayOpen(false);
      setAmount('');
      toast.success('Payment recorded');
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceId) return;
      await invoiceApi.void(invoiceId, { reason });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['invoices'] });
      setVoidOpen(false);
      setReason('');
      toast.success('Invoice voided');
    },
  });

  const invoice = query.data;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="font-mono text-xl">
                {invoice?.invoiceNumber ?? 'Invoice details'}
              </DialogTitle>
              {invoice && <StatusBadge kind="invoice" value={invoice.status} />}
            </div>
            <DialogDescription>
              {invoice ? `${invoice.billTo.name} · Due ${formatDate(invoice.dueDate)}` : 'Loading invoice details…'}
            </DialogDescription>
          </DialogHeader>

          {query.isPending ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : query.isError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              Could not load invoice details. The invoice may not exist or require elevated access permissions.
            </div>
          ) : invoice ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Issued: </span>
                  <span className="font-medium">{formatDate(invoice.issueDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Due: </span>
                  <span className="font-medium">{formatDate(invoice.dueDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold tabular"><Money paise={invoice.totalPaise} /></span>
                </div>
                <div>
                  <span className="text-muted-foreground">Balance: </span>
                  <span className={`font-semibold tabular ${invoice.balancePaise > 0 ? 'text-destructive' : 'text-success'}`}>
                    <Money paise={invoice.balancePaise} />
                  </span>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Line items
                </h4>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="p-2.5 font-medium">Description</th>
                        <th className="p-2.5 text-right font-medium">Qty</th>
                        <th className="p-2.5 text-right font-medium">Price</th>
                        <th className="p-2.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {invoice.lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="p-2.5 font-medium">{line.description}</td>
                          <td className="p-2.5 text-right tabular">{line.qty}</td>
                          <td className="p-2.5 text-right tabular"><Money paise={line.unitPricePaise} /></td>
                          <td className="p-2.5 text-right font-semibold tabular"><Money paise={line.lineTotalPaise} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {invoice.payments.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payments recorded
                  </h4>
                  <ul className="divide-y rounded-md border text-xs">
                    {invoice.payments.map((p) => (
                      <li key={p.id} className="flex justify-between p-2.5">
                        <span>{p.method} · {formatDateTime(p.paidAt)}</span>
                        <strong className="tabular"><Money paise={p.amountPaise} /></strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Link
                  href={`/invoices/${invoice.id}`}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  onClick={onClose}
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
                  Full page & print
                </Link>

                <div className="flex flex-wrap items-center gap-2">
                  {invoice.status === 'DRAFT' && canSend && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sendMutation.isPending}
                      onClick={() => sendMutation.mutate()}
                    >
                      {sendMutation.isPending ? 'Sending…' : 'Send invoice'}
                    </Button>
                  )}
                  {invoice.balancePaise > 0 && invoice.status !== 'VOID' && canPay && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAmount('');
                        setPayOpen(true);
                      }}
                    >
                      Record payment
                    </Button>
                  )}
                  {invoice.paidPaise === 0 && invoice.status !== 'VOID' && canVoid && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setReason('');
                        setVoidOpen(true);
                      }}
                    >
                      Void
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Payment Subdialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Record the amount received. Leave blank to pay the remaining balance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="dlg-pay-method">Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="dlg-pay-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
              </SelectContent>
            </Select>

            <Label htmlFor="dlg-pay-amount">Amount (₹)</Label>
            <Input
              id="dlg-pay-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={invoice ? String(invoice.balancePaise / 100) : ''}
            />
            {payMutation.error && (
              <p role="alert" className="text-xs text-destructive">{payMutation.error.message}</p>
            )}
            <Button
              className="w-full"
              disabled={payMutation.isPending}
              onClick={() => payMutation.mutate()}
            >
              {payMutation.isPending ? 'Saving…' : 'Confirm payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Void Subdialog */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void invoice</DialogTitle>
            <DialogDescription>
              Voiding cancels this invoice and sets its balance to zero.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="dlg-void-reason">Reason for voiding</Label>
            <Input
              id="dlg-void-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Created by mistake / duplicated"
            />
            {voidMutation.error && (
              <p role="alert" className="text-xs text-destructive">{voidMutation.error.message}</p>
            )}
            <Button
              variant="destructive"
              className="w-full"
              disabled={voidMutation.isPending || !reason.trim()}
              onClick={() => voidMutation.mutate()}
            >
              {voidMutation.isPending ? 'Voiding…' : 'Confirm void'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

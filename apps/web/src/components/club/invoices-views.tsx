'use client';

import React from 'react';
import Link from 'next/link';
import type { InvoiceStatus } from '@packages/validation';
import { formatDate } from '@/lib/format';
import { Money } from '@/components/club/money';
import { StatusBadge } from '@/components/club/status-badge';
import { CardGrid, KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { FileText, Calendar, ArrowRight } from 'lucide-react';

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  billTo: {
    type?: string;
    id?: string;
    name: string;
    email?: string | null;
  };
  totalPaise: number;
  balancePaise: number;
}

const INVOICE_COLUMNS: KanbanColumn[] = [
  { id: 'DRAFT', title: 'Draft' },
  { id: 'SENT', title: 'Sent' },
  { id: 'PAID', title: 'Paid' },
  { id: 'VOID', title: 'Void' },
];

/** Where an invoice may be dragged; the drop opens the invoice so the change is confirmed there. */
const INVOICE_MOVES: Record<string, string[]> = {
  DRAFT: ['SENT', 'VOID'],
  SENT: ['PAID', 'VOID'],
};

export function InvoicesCards({
  invoices,
  onPreview,
}: {
  invoices: InvoiceItem[];
  onPreview?: (invoice: InvoiceItem) => void;
}) {
  return (
    <CardGrid>
      {invoices.map((inv) => (
        <article
          key={inv.id}
          className="flex flex-col justify-between space-y-3 rounded-lg border bg-card p-4 shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <Link
                  href={`/invoices/${inv.id}`}
                  className="font-mono text-sm font-semibold underline underline-offset-4 hover:text-primary"
                >
                  {inv.invoiceNumber}
                </Link>
              </div>
              <StatusBadge kind="invoice" value={inv.status} />
            </div>

            <p className="font-medium text-foreground">{inv.billTo.name}</p>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-4 w-4" aria-hidden />
              <span>Due: {formatDate(inv.dueDate)}</span>
            </div>

            <div className="flex items-baseline justify-between border-t pt-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Total: </span>
                <span className="font-semibold tabular">
                  <Money paise={inv.totalPaise} />
                </span>
              </div>
              {inv.balancePaise > 0 && inv.status !== 'PAID' && (
                <div>
                  <span className="text-xs text-muted-foreground">Balance: </span>
                  <span className="font-medium tabular text-destructive">
                    <Money paise={inv.balancePaise} />
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-2">
            {onPreview ? (
              <button
                type="button"
                onClick={() => onPreview(inv)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Quick view
              </button>
            ) : <span />}
            <Link
              href={`/invoices/${inv.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Full page</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </article>
      ))}
    </CardGrid>
  );
}

export function InvoicesBoard({
  invoices,
  onPreview,
}: {
  invoices: InvoiceItem[];
  onPreview?: (invoice: InvoiceItem) => void;
}) {
  return (
    <KanbanBoard
      columns={INVOICE_COLUMNS}
      items={invoices}
      idOf={(inv) => inv.id}
      columnOf={(inv) => inv.status}
      emptyLabel="No invoices"
      canDrop={(inv, to) => (INVOICE_MOVES[inv.status] ?? []).includes(to)}
      onMove={onPreview ? (inv) => onPreview(inv) : undefined}
      renderCard={(inv) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            {onPreview ? (
              <button
                type="button"
                onClick={() => onPreview(inv)}
                className="font-mono text-xs font-medium underline underline-offset-4 hover:text-primary text-left"
              >
                {inv.invoiceNumber}
              </button>
            ) : (
              <Link
                href={`/invoices/${inv.id}`}
                className="font-mono text-xs font-medium underline underline-offset-4 hover:text-primary"
              >
                {inv.invoiceNumber}
              </Link>
            )}
            <StatusBadge kind="invoice" value={inv.status} />
          </div>

          <p className="font-medium text-sm text-foreground">{inv.billTo.name}</p>

          <p className="text-xs text-muted-foreground">Due: {formatDate(inv.dueDate)}</p>

          <div className="flex items-baseline justify-between border-t pt-2 text-xs">
            <div>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-medium tabular">
                <Money paise={inv.totalPaise} />
              </span>
            </div>
            {inv.balancePaise > 0 && inv.status !== 'PAID' && (
              <span className="font-medium tabular text-destructive">
                <Money paise={inv.balancePaise} />
              </span>
            )}
          </div>
        </div>
      )}
    />
  );
}

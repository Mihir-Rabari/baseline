'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { InvoiceStatus } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { invoiceApi } from '@/lib/invoice-api';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Money } from '@/components/club/money';
import { StatusBadge } from '@/components/club/status-badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { ClientsButton } from '@/components/club/clients-dialog';
import { InvoicesBoard, InvoicesCards } from '@/components/club/invoices-views';
import { InvoiceDetailDialog } from '@/components/club/invoice-detail-dialog';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';

const INVOICE_VIEWS: ViewKind[] = ['list', 'cards', 'board'];

export default function InvoicesPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('invoices:read');
  const [view, setView] = useViewPreference('invoices', INVOICE_VIEWS, 'list');
  const isBoard = view === 'board';
  const [status, setStatus] = useState('ALL');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['invoices', isBoard ? 'board' : status, overdue, isBoard ? 1 : page],
    queryFn: () => invoiceApi.list({
      status: isBoard || status === 'ALL' ? undefined : (status as InvoiceStatus),
      overdue: overdue ? 'true' : undefined,
      page: isBoard ? 1 : page,
      limit: isBoard ? 100 : 20,
    }),
    enabled: allowed,
  });
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Track invoices, payments and balances."
        actions={
          <>
            <ViewSwitcher views={INVOICE_VIEWS} value={view} onChange={setView} />
            {allowed && <ClientsButton canEdit={hasPermission('invoices:create')} />}
            {hasPermission('invoices:create') ? <Link className={buttonVariants()} href="/invoices/new">New invoice</Link> : undefined}
          </>
        }
      />
      {!allowed ? (
        <EmptyState title="Invoices are unavailable" />
      ) : (
        <>
          {!isBoard && (
            <Tabs value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
              <TabsList>
                {['ALL', 'DRAFT', 'SENT', 'PAID', 'VOID'].map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {value === 'ALL' ? 'All' : value.charAt(0) + value.slice(1).toLowerCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="flex items-center gap-2">
            <Switch id="overdue" checked={overdue} onCheckedChange={(value) => { setOverdue(value); setPage(1); }} />
            <Label htmlFor="overdue">Overdue only</Label>
          </div>
          {query.error ? (
            <PageError error={query.error} onRetry={() => { void query.refetch(); }} />
          ) : query.isPending ? (
            <div role="status" aria-label="Loading invoices"><Skeleton className="h-64" /></div>
          ) : !query.data?.data.length ? (
            <EmptyState title="No invoices match" description="Create an invoice or change the filters." />
          ) : isBoard ? (
            <InvoicesBoard invoices={query.data.data} onPreview={(inv) => setPreviewId(inv.id)} />
          ) : view === 'cards' ? (
            <>
              <InvoicesCards invoices={query.data.data} onPreview={(inv) => setPreviewId(inv.id)} />
              {query.data && (
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" disabled={!query.data.meta.hasPrevPage} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <Button variant="outline" disabled={!query.data.meta.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Number', 'Customer', 'Status', 'Due', 'Total', 'Balance', 'Action'].map((value) => (
                      <TableHead key={value}>{value}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.data.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setPreviewId(invoice.id)}
                          className="font-mono text-xs underline underline-offset-4 text-left hover:text-primary font-medium"
                        >
                          {invoice.invoiceNumber}
                        </button>
                      </TableCell>
                      <TableCell>{invoice.billTo.name}</TableCell>
                      <TableCell><StatusBadge kind="invoice" value={invoice.status} /></TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell><Money paise={invoice.totalPaise} /></TableCell>
                      <TableCell><Money paise={invoice.balancePaise} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setPreviewId(invoice.id)}
                          >
                            Preview
                          </Button>
                          <Link
                            href={`/invoices/${invoice.id}`}
                            className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' h-7 text-xs'}
                          >
                            Details
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {query.data && (
                <div className="flex gap-2">
                  <Button variant="outline" disabled={!query.data.meta.hasPrevPage} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <Button variant="outline" disabled={!query.data.meta.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <InvoiceDetailDialog
        invoiceId={previewId}
        open={Boolean(previewId)}
        onClose={() => setPreviewId(null)}
        canPay={hasPermission('payments:create')}
        canVoid={hasPermission('invoices:update')}
        canSend={hasPermission('invoices:create')}
      />
    </div>
  );
}

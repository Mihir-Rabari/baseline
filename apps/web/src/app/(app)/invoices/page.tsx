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
export default function InvoicesPage() {
  const {user,hasPermission}=useAuth();const allowed=hasPermission('invoices:read');const [status,setStatus]=useState('ALL');const[overdue,setOverdue]=useState(false);const[page,setPage]=useState(1);
  const query=useQuery({queryKey:['invoices',status,overdue,page],queryFn:()=>invoiceApi.list({status:status==='ALL'?undefined:status as InvoiceStatus,overdue:overdue?'true':undefined,page,limit:20}),enabled:allowed});
  if(!user)return null;
  return <div className="space-y-8"><PageHeader title="Invoices" description="Track invoices, payments and balances." actions={<>{allowed&&<ClientsButton canEdit={hasPermission('invoices:create')}/>}{hasPermission('invoices:create')?<Link className={buttonVariants()} href="/invoices/new">New invoice</Link>:undefined}</>}/>{!allowed?<EmptyState title="Invoices are unavailable"/>:<><Tabs value={status} onValueChange={(value)=>{setStatus(value);setPage(1);}}><TabsList>{['ALL','DRAFT','SENT','PAID','VOID'].map((value)=><TabsTrigger key={value} value={value}>{value==='ALL'?'All':value.charAt(0)+value.slice(1).toLowerCase()}</TabsTrigger>)}</TabsList></Tabs><div className="flex items-center gap-2"><Switch id="overdue" checked={overdue} onCheckedChange={(value)=>{setOverdue(value);setPage(1);}}/><Label htmlFor="overdue">Overdue only</Label></div>{query.error?<PageError error={query.error} onRetry={()=>{query.refetch();}}/>:query.isPending?<div role="status" aria-label="Loading invoices"><Skeleton className="h-64"/></div>:!query.data?.data.length?<EmptyState title="No invoices match" description="Create an invoice or change the filters."/>:<Table><TableHeader><TableRow>{['Number','Customer','Status','Due','Total','Balance'].map((value)=><TableHead key={value}>{value}</TableHead>)}</TableRow></TableHeader><TableBody>{query.data.data.map((invoice)=><TableRow key={invoice.id}><TableCell><Link href={`/invoices/${invoice.id}`} className="font-mono text-xs underline underline-offset-4">{invoice.invoiceNumber}</Link></TableCell><TableCell>{invoice.billTo.name}</TableCell><TableCell><StatusBadge kind="invoice" value={invoice.status}/></TableCell><TableCell>{formatDate(invoice.dueDate)}</TableCell><TableCell><Money paise={invoice.totalPaise}/></TableCell><TableCell><Money paise={invoice.balancePaise}/></TableCell></TableRow>)}</TableBody></Table>}{query.data&&<div className="flex gap-2"><Button variant="outline" disabled={!query.data.meta.hasPrevPage} onClick={()=>setPage((current)=>current-1)}>Previous</Button><Button variant="outline" disabled={!query.data.meta.hasNextPage} onClick={()=>setPage((current)=>current+1)}>Next</Button></div>}</>}</div>;
}

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useMembers } from '@/hooks/use-members';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { StatusBadge } from '@/components/club/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { MembersBoard, MembersCards } from '@/components/club/members-views';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const MEMBER_VIEWS: ViewKind[] = ['list', 'cards', 'board'];

export default function MembersPage() {
  const { user, hasPermission } = useAuth();
  const [q, setQ] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useViewPreference('members', MEMBER_VIEWS, 'list');
  const grouped = view === 'board';
  const debounced = useDebounce(q.trim(), 250);
  const search = debounced.length >= 2 ? debounced : undefined;
  const { data, error, isPending, refetch } = useMembers({ page: grouped ? 1 : page, limit: grouped ? 100 : 20, q: search, planCode: planCode || undefined });

  if (!user) return null;
  return (
    <div className="space-y-8">
      <PageHeader title="Members" description="Find a member and check their membership."
        actions={<><ViewSwitcher views={MEMBER_VIEWS} value={view} onChange={setView} />{hasPermission('members:create') && hasPermission('memberships:create') ? <Link className={buttonVariants()} href="/members/new">New member</Link> : undefined}</>} />
      <div className="flex flex-wrap gap-4">
        <div className="min-w-60 flex-1 space-y-2">
          <Label htmlFor="member-search">Search members</Label>
          <Input id="member-search" type="search" placeholder="Name, phone or member code" value={q}
            onChange={(event) => { setQ(event.target.value); setPage(1); }} aria-describedby="search-help" />
          <p id="search-help" className="text-sm text-muted-foreground">Enter at least 2 characters to search.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="member-plan">Plan</Label>
          <Select value={planCode || 'ALL'} onValueChange={(value) => { setPlanCode(value === 'ALL' ? '' : value); setPage(1); }}>
            <SelectTrigger id="member-plan" className="min-w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All plans</SelectItem><SelectItem value="GOLD">Gold</SelectItem><SelectItem value="SILVER">Silver</SelectItem><SelectItem value="JUNIOR">Junior</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      {error ? <PageError error={error} onRetry={() => { refetch(); }} /> : isPending ? (
        <div role="status" aria-label="Loading members" className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : data?.data.length === 0 ? (
        <EmptyState title="No members match" description="Try another name, phone number or plan."
          action={<Button variant="outline" onClick={() => { setQ(''); setPlanCode(''); setPage(1); }}>Clear filters</Button>} />
      ) : data ? (
        <>
          {view === 'board' ? <MembersBoard members={data.data} /> : view === 'cards' ? <MembersCards members={data.data} /> : (
            <Table className="min-w-[760px] text-left">
              <caption className="sr-only">Club members</caption>
              <TableHeader><TableRow>{['Code', 'Name', 'Phone', 'Plan', 'Expiry', 'Days left'].map((heading) => <TableHead key={heading} scope="col" className={heading === 'Days left' ? 'text-right' : undefined}>{heading}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{data.data.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-mono text-xs">{member.memberCode}</TableCell>
                  <TableCell><Link href={`/members/${member.id}`} className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{member.fullName}</Link></TableCell>
                  <TableCell>{member.phone}</TableCell>
                  <TableCell>{member.membership ? <Badge variant={member.membership.plan.code === 'GOLD' ? 'default' : member.membership.plan.code === 'SILVER' ? 'secondary' : 'outline'}>{member.membership.plan.name}</Badge> : '—'}</TableCell>
                  <TableCell><StatusBadge kind="membership" value={member.membership?.expiryState ?? 'NONE'} /></TableCell>
                  <TableCell className="tabular text-right">{member.membership ? Math.max(0, member.membership.daysLeft) : '—'}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
          {!grouped && <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">{data.meta.totalItems} members · Page {data.meta.page} of {data.meta.totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!data.meta.hasPrevPage} onClick={() => setPage((current) => current - 1)}>Previous</Button>
              <Button variant="outline" disabled={!data.meta.hasNextPage} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          </div>}
        </>
      ) : null}
    </div>
  );
}

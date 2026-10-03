'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useNotifications } from '@/hooks/use-notifications';
import { notificationHref } from '@/lib/notification-api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const state = useNotifications(page, 20);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const run = async (action: () => Promise<unknown>) => {
    if (state.pending) return;
    setError(null);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not update notifications. Try again.'); }
  };
  return <div className="space-y-8"><PageHeader title="Notifications" description="Follow up on updates from around the club." actions={state.canUpdate && <Button disabled={state.pending || !state.count.data?.count} onClick={() => run(() => state.readAll.mutateAsync())}>{state.readAll.isPending ? 'Marking…' : 'Mark all read'}</Button>} />
    {!state.canRead ? <EmptyState title="Notification access required" description="Ask the owner for access to your notifications." /> : state.list.isPending ? <Skeleton className="h-72" /> : state.list.isError ? <PageError error={state.list.error} onRetry={() => state.list.refetch()} /> : <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!state.list.data?.data.length ? <EmptyState title="No notifications" description="Club updates will appear here." /> : <Table><TableHeader><TableRow><TableHead>Update</TableHead><TableHead>Received</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{state.list.data.data.map((row) => {
        const href = notificationHref(row.link);
        return <TableRow key={row.id}><TableCell><p className="font-medium">{row.title}</p>{row.body && <p className="text-sm text-muted-foreground">{row.body}</p>}</TableCell><TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell><TableCell><Badge variant={row.readAt ? 'outline' : 'secondary'}>{row.readAt ? 'Read' : 'Unread'}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-2">{!row.readAt && state.canUpdate && <Button size="sm" variant="outline" disabled={state.pending} onClick={() => run(() => state.read.mutateAsync(row.id))}>Mark read</Button>}{href && <Button asChild size="sm" variant="ghost"><Link href={href}>View</Link></Button>}</div></TableCell></TableRow>;
      })}</TableBody></Table>}
      {state.list.data && state.list.data.meta.totalPages > 1 && <div className="flex items-center justify-between"><Button variant="outline" disabled={!state.list.data.meta.hasPrevPage} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {state.list.data.meta.totalPages}</span><Button variant="outline" disabled={!state.list.data.meta.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
    </>}
  </div>;
}


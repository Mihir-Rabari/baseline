'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { useNotifications } from '@/hooks/use-notifications';
import { notificationHref, relativeTime } from '@/lib/notification-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

export function NotificationBell() {
  const state = useNotifications(1, 8);
  const router = useRouter();
  if (!state.canRead) return null;
  const mark = async (id: string, link: string | null) => {
    if (state.pending) return;
    try {
      if (state.canUpdate) await state.read.mutateAsync(id);
      const href = notificationHref(link);
      if (href) router.push(href);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not mark the notification read. Try again.'); }
  };
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="relative" aria-label="Notifications"><Bell className="h-4 w-4" aria-hidden />{Boolean(state.count.data?.count) && <Badge className="absolute -right-1 -top-1 px-1 text-xs" aria-label={`${state.count.data!.count} unread`}>{state.count.data!.count > 99 ? '99+' : state.count.data!.count}</Badge>}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-80"><DropdownMenuLabel>Notifications</DropdownMenuLabel><DropdownMenuSeparator />
      {state.list.isPending ? <Skeleton className="m-2 h-24" /> : state.list.isError || state.count.isError ? <div role="alert" className="space-y-2 p-3 text-sm"><p>Could not load notifications.</p><Button variant="outline" size="sm" onClick={() => { state.list.refetch(); state.count.refetch(); }}>Try again</Button></div> :
        !state.list.data?.data.length ? <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p> : state.list.data.data.map((row) => <DropdownMenuItem key={row.id} disabled={state.pending} className="items-start" onSelect={() => mark(row.id, row.link)}><div className="space-y-1"><p className={row.readAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>{row.title}</p><p className="text-xs text-muted-foreground">{relativeTime(row.createdAt)} · {row.readAt ? 'Read' : 'Unread'}</p></div></DropdownMenuItem>)}
      <DropdownMenuSeparator />{state.canUpdate && <DropdownMenuItem disabled={state.pending || !state.count.data?.count} onSelect={() => { if (!state.pending) state.readAll.mutateAsync().catch((error: Error) => toast.error(error.message)); }}>Mark all read</DropdownMenuItem>}
      <DropdownMenuItem asChild><Link href="/notifications">View all notifications</Link></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}


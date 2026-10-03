'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { UpdateTicketStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { useKitchen } from '@/hooks/use-bar';
import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KitchenBoard, KitchenCards } from '@/components/club/kitchen-views';
import { ViewSwitcher, useViewPreference, type ViewKind } from '@/components/club/views';

const KITCHEN_VIEWS: ViewKind[] = ['board', 'cards'];

export default function KitchenPage() {
  const { user, hasPermission } = useAuth();
  const { tickets, advance, canRead } = useKitchen();
  const [view, setView] = useViewPreference('kitchen', KITCHEN_VIEWS, 'board');
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const move = async (id: string, status: UpdateTicketStatusRequest['status']) => {
    if (advance.isPending || !canRead) return;
    setError(null);
    try { await advance.mutateAsync({ id, status }); }
    catch (error) { setError(error instanceof Error ? error.message : 'The ticket could not be updated. Try again.'); }
  };
  return <div className="space-y-6">
    <PageHeader
      title="Kitchen"
      description="Start tickets, mark them ready and confirm service."
      actions={
        <>
          <ViewSwitcher views={KITCHEN_VIEWS} value={view} onChange={setView} />
          {hasPermission('bar:read') && <Button asChild variant="outline"><Link href="/bar">Bar floor</Link></Button>}
        </>
      }
    />
    {!canRead ? <EmptyState title="Kitchen access required" description="Ask the owner for access to kitchen tickets." /> :
      tickets.isPending ? <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div> :
      tickets.isError ? <PageError error={tickets.error} onRetry={() => tickets.refetch()} /> : <>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!tickets.data?.length ? <EmptyState title="No tickets" description="Sent bar items will appear here." /> :
          view === 'cards' ? (
            <KitchenCards
              tickets={tickets.data}
              isPending={advance.isPending}
              activePendingId={advance.variables?.id}
              onMove={move}
            />
          ) : (
            <KitchenBoard
              tickets={tickets.data}
              isPending={advance.isPending}
              activePendingId={advance.variables?.id}
              onMove={move}
            />
          )
        }
      </>}
  </div>;
}


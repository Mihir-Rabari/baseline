'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { barApi } from '@/lib/bar-api';
import { EmptyState } from '@/components/app-shell/empty-state';
import { PageError } from '@/components/club/page-error';
import { Money } from '@/components/club/money';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export function BarMenuSettings() {
  const { user, hasPermission } = useAuth();
  const canRead = Boolean(user) && hasPermission('bar:read');
  const canEdit = hasPermission('bar:manage') && hasPermission('reports:read');
  const client = useQueryClient();
  const menu = useQuery({ queryKey: ['bar', user?.id, 'menu'], queryFn: barApi.menu, enabled: canRead, staleTime: 30000 });
  const update = useMutation({ mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => barApi.updateMenu(id, { isAvailable }),
    onSettled: () => client.invalidateQueries({ queryKey: ['bar'] }) });
  if (!canRead) return <EmptyState title="Bar access required" description="Ask the owner for access to the menu." />;
  if (menu.isPending) return <Skeleton className="h-72" />;
  if (menu.isError) return <PageError error={menu.error} onRetry={() => menu.refetch()} />;
  if (!menu.data?.length) return <EmptyState title="No menu items" description="Add menu items before opening bar tabs." />;
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Unavailable items cannot be added to new bills. Existing bills keep their original prices.</p>
    {update.isError && <p role="alert" className="text-sm text-destructive">{update.error.message}</p>}
    <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Station</TableHead><TableHead>Price</TableHead><TableHead>Available</TableHead></TableRow></TableHeader><TableBody>{menu.data.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.station === 'BAR' ? 'Bar' : 'Kitchen'}</TableCell><TableCell><Money paise={item.pricePaise} /></TableCell><TableCell><Switch aria-label={`${item.name} available`} checked={item.isAvailable} disabled={!canEdit || update.isPending} onCheckedChange={(isAvailable) => { if (canEdit && !update.isPending) update.mutate({ id: item.id, isAvailable }); }} /></TableCell></TableRow>)}</TableBody></Table>
  </div>;
}

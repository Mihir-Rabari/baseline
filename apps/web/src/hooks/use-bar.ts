'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddTabItemRequest, OpenTabRequest, SettleTabRequest, UpdateTicketStatusRequest } from '@packages/validation';
import { useAuth } from '@/hooks/use-auth';
import { barApi } from '@/lib/bar-api';

export function useBarTables() {
  const { user, hasPermission } = useAuth();
  const client = useQueryClient();
  const canRead = Boolean(user) && hasPermission('bar:read');
  const canManage = Boolean(user) && hasPermission('bar:manage');
  const tables = useQuery({ queryKey: ['bar', user?.id, 'tables'], queryFn: barApi.tables,
    enabled: canRead, refetchInterval: 5000, staleTime: 2000 });
  const open = useMutation({ mutationFn: (data: OpenTabRequest) => barApi.open(data),
    onSettled: () => client.invalidateQueries({ queryKey: ['bar'] }) });
  return { tables, open, canRead, canManage };
}

export function useBarTab(id: string) {
  const { user, hasPermission } = useAuth();
  const client = useQueryClient();
  const canRead = Boolean(user) && hasPermission('bar:read');
  const canManage = Boolean(user) && hasPermission('bar:manage');
  const canSettle = Boolean(user) && hasPermission('bar:settle');
  const tab = useQuery({ queryKey: ['bar', user?.id, 'tab', id], queryFn: () => barApi.tab(id), enabled: canRead,
    refetchInterval: 5000, staleTime: 2000 });
  const menu = useQuery({ queryKey: ['bar', user?.id, 'menu'], queryFn: barApi.menu, enabled: canRead, staleTime: 30000 });
  const refresh = () => client.invalidateQueries({ queryKey: ['bar'] });
  const add = useMutation({ mutationFn: (data: AddTabItemRequest) => barApi.add(id, data), onSettled: refresh });
  const remove = useMutation({ mutationFn: (itemId: string) => barApi.remove(id, itemId), onSettled: refresh });
  const send = useMutation({ mutationFn: () => barApi.send(id), onSettled: refresh });
  const settle = useMutation({ mutationFn: (data: SettleTabRequest) => barApi.settle(id, data), onSettled: refresh });
  return { tab, menu, add, remove, send, settle, canRead, canManage, canSettle,
    pending: add.isPending || remove.isPending || send.isPending || settle.isPending };
}

export function useKitchen() {
  const { user, hasPermission } = useAuth();
  const client = useQueryClient();
  const canRead = Boolean(user) && hasPermission('bar:kitchen');
  const tickets = useQuery({ queryKey: ['bar', user?.id, 'tickets'], queryFn: barApi.tickets,
    enabled: canRead, refetchInterval: 5000, staleTime: 2000 });
  const advance = useMutation({ mutationFn: ({ id, status }: { id: string; status: UpdateTicketStatusRequest['status'] }) => barApi.advance(id, { status }),
    onSettled: () => client.invalidateQueries({ queryKey: ['bar'] }) });
  return { tickets, advance, canRead };
}

export function useBarEarnings(date: string) {
  const { user, hasPermission } = useAuth();
  const canRead = Boolean(user) && hasPermission('bar:read');
  const query = useQuery({ queryKey: ['bar', user?.id, 'earnings', date], queryFn: () => barApi.earnings(date),
    enabled: canRead, staleTime: 10000, refetchInterval: 10000 });
  return { query, canRead, canChooseDate: hasPermission('reports:read') };
}

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { notificationApi } from '@/lib/notification-api';

export function useNotifications(page = 1, limit = 20) {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const scope = user?.id ?? '';
  const canRead = Boolean(user) && hasPermission('notifications:read:self');
  const canUpdate = Boolean(user) && hasPermission('notifications:update:self');
  const list = useQuery({ queryKey: ['notifications', scope, 'list', page, limit],
    queryFn: () => notificationApi.list(scope, { page, limit }), enabled: canRead, refetchInterval: 10000, staleTime: 5000 });
  const count = useQuery({ queryKey: ['notifications', scope, 'count'],
    queryFn: () => notificationApi.count(scope), enabled: canRead, refetchInterval: 10000, staleTime: 5000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications', scope] });
  const read = useMutation({ mutationFn: (id: string) => notificationApi.read(scope, id), onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: () => notificationApi.readAll(scope), onSuccess: invalidate });
  return { list, count, read, readAll, canRead, canUpdate, pending: read.isPending || readAll.isPending };
}

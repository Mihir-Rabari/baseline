'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RenewMembershipRequest } from '@packages/validation';
import { api } from '@/lib/api-client';

export function useMemberProfile(id: string) {
  return useQuery({ queryKey: ['members', 'detail', id], queryFn: () => api.members.get(id), enabled: Boolean(id), staleTime: 30000 });
}

export function useMemberTimeline(id: string, enabled = true) {
  return useQuery({ queryKey: ['members', 'timeline', id], queryFn: () => api.members.timeline(id), enabled: Boolean(id) && enabled, staleTime: 30000 });
}

export function useMemberCheckin(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => api.members.checkin(id), onSuccess: () => client.invalidateQueries({ queryKey: ['members'] }) });
}

export function useMemberRenewal(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (data: RenewMembershipRequest) => api.members.renew(id, data), onSuccess: () => client.invalidateQueries({ queryKey: ['members'] }) });
}

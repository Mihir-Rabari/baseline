'use client';

import { useQuery } from '@tanstack/react-query';
import type { MemberListQuery } from '@packages/validation';
import { api } from '@/lib/api-client';

export function useMembers(params: Partial<MemberListQuery>) {
  return useQuery({
    queryKey: ['members', params], queryFn: () => api.members.list(params), staleTime: 30000,
  });
}

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function usePlans() {
  return useQuery({ queryKey: ['public', 'plans'], queryFn: api.public.plans, staleTime: 60000 });
}

export function usePublicClub() {
  return useQuery({ queryKey: ['public', 'club'], queryFn: api.public.club, staleTime: 60000 });
}

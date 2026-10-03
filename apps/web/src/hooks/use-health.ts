import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useSystemHealth() {
  return useQuery({
    queryKey: ['system-readiness'],
    queryFn: () => api.health.getReadiness(),
    refetchInterval: 5000, // Poll every 5s on status page
    retry: 1,
  });
}

export function useSystemInfo() {
  return useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.system.getInfo(),
    staleTime: 60000,
  });
}

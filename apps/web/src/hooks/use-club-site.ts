import { useQuery } from '@tanstack/react-query';
import type { TenantSite } from '@packages/validation';
import { ops } from '@/lib/ops';

/** The club serving this address: its name and logo. Quiet on failure; the shell falls back to the Baseline mark. */
export function useClubSite() {
  return useQuery({ queryKey: ['tenant', 'site'], queryFn: () => ops.get<TenantSite>('/tenant'), staleTime: 5 * 60_000, retry: false });
}

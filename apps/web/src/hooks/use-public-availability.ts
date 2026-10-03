import { useQuery } from '@tanstack/react-query';
import type { AvailabilityQuery } from '@packages/validation';
import { bookingApi } from '@/lib/booking-api';
export function usePublicAvailability(params: AvailabilityQuery) {
  return useQuery({ queryKey: ['availability', 'public', params], queryFn: () => bookingApi.availability(params, true), refetchInterval: 10000, staleTime: 5000 });
}

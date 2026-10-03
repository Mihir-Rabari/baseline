'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityQuery, CreateTrialBookingRequest } from '@packages/validation';
import { api } from '@/lib/api-client';

export function usePublicAvailability(params: Pick<AvailabilityQuery, 'date' | 'courtTypeId'>) {
  return useQuery({ queryKey: ['availability', 'public', params], queryFn: () => api.public.availability(params), refetchInterval: 10000, staleTime: 5000 });
}

export function useTrialBooking() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTrialBookingRequest) => api.public.createTrialBooking(data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['availability'] }),
  });
}

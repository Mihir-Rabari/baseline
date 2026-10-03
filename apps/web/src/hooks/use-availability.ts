'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailabilityQuery, CreateBookingRequest, JoinSocialRequest } from '@packages/validation';
import { api } from '@/lib/api-client';

export function useAvailability(params: AvailabilityQuery, enabled = true) {
  return useQuery({ queryKey: ['availability', params], queryFn: () => api.courts.availability(params),
    enabled, refetchInterval: 10000, staleTime: 5000 });
}
export function useCreateBooking() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: { social: boolean; data: CreateBookingRequest | JoinSocialRequest }) =>
    input.social ? api.bookings.joinSocial(input.data) : api.bookings.create(input.data),
  onSuccess: async () => {
    await Promise.all(['availability', 'bookings', 'members', 'reports'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  } });
}
export function useMemberLookup(q: string, enabled = true) {
  return useQuery({ queryKey: ['members', 'lookup', q], queryFn: () => api.members.lookup(q),
    enabled: enabled && q.length >= 2, staleTime: 30000 });
}

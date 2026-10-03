'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelBookingRequest } from '@packages/validation';
import { api } from '@/lib/api-client';
import { dateAfter } from '@/lib/booking-calendar';

export type BookingScope = 'upcoming' | 'past';

export function useMyBookings(scope: BookingScope, enabled = true) {
  return useQuery({ queryKey: ['bookings', 'mine', scope], queryFn: () => api.bookings.mine({ scope, limit: 100 }), enabled, staleTime: 15000 });
}

export function useDayBookings(date: string, enabled = true) {
  return useQuery({ queryKey: ['bookings', 'day', date], queryFn: () => api.bookings.list({ date, limit: 100 }), enabled, staleTime: 15000 });
}

/** Every booking in the week starting `monday`, for the calendar view. */
export function useWeekBookings(monday: string, enabled = true) {
  return useQuery({ queryKey: ['bookings', 'week', monday], queryFn: () => api.bookings.list({ from: monday, to: dateAfter(monday, 6), limit: 100 }), enabled, staleTime: 15000 });
}

export function useCancelBooking() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; data?: CancelBookingRequest }) => api.bookings.cancel(input.id, input.data),
    onSuccess: async () => {
      await Promise.all(['bookings', 'availability', 'members', 'reports'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
}

export function useMyMember(enabled = true) {
  return useQuery({
    queryKey: ['members', 'me'], queryFn: () => api.members.me(), enabled, staleTime: 30000,
    // A missing profile is an expected state, not an outage: do not retry a 404.
    retry: (count, error) => (error as { statusCode?: number }).statusCode !== 404 && count < 2,
  });
}

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useCancelBooking, useMyBookings, useMyMember } from './use-bookings';

afterEach(() => vi.restoreAllMocks());
const setup = () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

describe('booking history hooks', () => {
  it('queries own bookings per scope', async () => {
    const spy = vi.spyOn(api.bookings, 'mine').mockResolvedValue({ data: [], meta: { page: 1, limit: 100, totalItems: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false } });
    const { wrapper } = setup();
    const { rerender } = renderHook(({ scope }) => useMyBookings(scope), { wrapper, initialProps: { scope: 'upcoming' as 'upcoming' | 'past' } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ scope: 'upcoming', limit: 100 }));
    rerender({ scope: 'past' });
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ scope: 'past', limit: 100 }));
  });

  it('invalidates bookings, availability, members and reports after a cancel', async () => {
    const cancel = vi.spyOn(api.bookings, 'cancel').mockResolvedValue({} as Awaited<ReturnType<typeof api.bookings.cancel>>);
    const { client, wrapper } = setup(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelBooking(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'b1' }); });
    expect(cancel).toHaveBeenCalledWith('b1', undefined);
    for (const key of ['bookings', 'availability', 'members', 'reports']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  });

  it('does not retry a missing member profile', async () => {
    const spy = vi.spyOn(api.members, 'me').mockRejectedValue(new ApiError('none', 404, 'NOT_A_MEMBER'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyMember(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledOnce();
  });
});

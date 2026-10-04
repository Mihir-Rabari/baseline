import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { AvailabilitySchema } from '@packages/validation';
import fixture from '@/mocks/availability.json';
import { useAvailability, useCreateBooking } from '../../../../apps/web/src/hooks/use-availability';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('calendar queries', () => {
  it('separates prices by member and refreshes availability on a 10-second interval', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api.courts, 'availability').mockResolvedValue(AvailabilitySchema.parse(fixture));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { rerender, unmount } = renderHook(({ memberId }) => useAvailability({ date: '2031-05-14', memberId }), { wrapper, initialProps: { memberId: undefined as string | undefined } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(spy).toHaveBeenCalledTimes(2);
    rerender({ memberId: 'member-a' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenLastCalledWith({ date: '2031-05-14', memberId: 'member-a' });
    unmount(); client.clear();
  });
  it('invalidates affected modules after standard and social booking mutations', async () => {
    const standard = vi.spyOn(api.bookings, 'create').mockResolvedValue({} as Awaited<ReturnType<typeof api.bookings.create>>);
    const social = vi.spyOn(api.bookings, 'joinSocial').mockResolvedValue({} as Awaited<ReturnType<typeof api.bookings.joinSocial>>);
    const client = new QueryClient(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useCreateBooking(), { wrapper });
    const data = { courtId: 'court', startsAt: '2031-05-14T12:30:00Z' };
    await act(async () => { await result.current.mutateAsync({ social: false, data }); await result.current.mutateAsync({ social: true, data }); });
    expect(standard).toHaveBeenCalledWith(data); expect(social).toHaveBeenCalledWith(data);
    for (const key of ['availability', 'bookings', 'members', 'reports']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    unmount(); client.clear();
  });
});

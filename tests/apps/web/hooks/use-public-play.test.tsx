import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilitySchema } from '@packages/validation';
import { api } from '@/lib/api-client';
import fixture from '@/mocks/availability.json';
import { usePublicAvailability, useTrialBooking } from '../../../../apps/web/src/hooks/use-public-play';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

describe('public play hooks', () => {
  it('polls public availability every 10 seconds', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api.public, 'availability').mockResolvedValue(AvailabilitySchema.parse(fixture));
    const { client, wrapper } = setup();
    const { unmount } = renderHook(() => usePublicAvailability({ date: '2031-05-14' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(spy).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });

  it('refreshes availability after a trial is booked', async () => {
    const book = vi.spyOn(api.public, 'createTrialBooking').mockResolvedValue({} as Awaited<ReturnType<typeof api.public.createTrialBooking>>);
    const { client, wrapper } = setup(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useTrialBooking(), { wrapper });
    const data = { courtId: 'court', startsAt: '2031-05-14T12:30:00Z', name: 'Riya', phone: '9876543210' };
    await act(async () => { await result.current.mutateAsync(data); });
    expect(book).toHaveBeenCalledWith(data);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['availability'] });
  });
});

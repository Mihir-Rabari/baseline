import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { useMemberCheckin, useMemberProfile, useMemberRenewal, useMemberTimeline } from './use-member-profile';

vi.mock('@/lib/api-client', () => ({ api: { members: { get: vi.fn(), timeline: vi.fn(), checkin: vi.fn(), renew: vi.fn() } } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('member profile hooks', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not request an absent member or inactive timeline tab', () => {
    const { wrapper } = setup();
    renderHook(() => useMemberProfile(''), { wrapper });
    renderHook(() => useMemberTimeline('member', false), { wrapper });
    expect(api.members.get).not.toHaveBeenCalled(); expect(api.members.timeline).not.toHaveBeenCalled();
  });
  it('invalidates the list, detail and timeline after a renewal or checkin', async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(api.members.renew).mockResolvedValue({} as Awaited<ReturnType<typeof api.members.renew>>);
    vi.mocked(api.members.checkin).mockResolvedValue({} as Awaited<ReturnType<typeof api.members.checkin>>);
    const renewal = renderHook(() => useMemberRenewal('member'), { wrapper });
    await act(async () => { await renewal.result.current.mutateAsync({ paymentMethod: 'UPI' }); });
    expect(api.members.renew).toHaveBeenCalledWith('member', { paymentMethod: 'UPI' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['members'] });
    const checkin = renderHook(() => useMemberCheckin('member'), { wrapper });
    await act(async () => { await checkin.result.current.mutateAsync(); });
    expect(api.members.checkin).toHaveBeenCalledWith('member');
    expect(invalidate).toHaveBeenCalledTimes(2); client.clear();
  });
  it('retains failed mutation errors and does not invalidate or report success', async () => {
    const { client, wrapper } = setup(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(api.members.renew).mockRejectedValue(new Error('Payment failed'));
    const { result } = renderHook(() => useMemberRenewal('member'), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ paymentMethod: 'CARD' })).rejects.toThrow('Payment failed'); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled(); client.clear();
  });
});

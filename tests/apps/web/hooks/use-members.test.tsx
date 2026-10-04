import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { listMockMembers } from '@/lib/mock-members';
import { useMembers } from '../../../../apps/web/src/hooks/use-members';

vi.mock('@/lib/api-client', () => ({ api: { members: { list: vi.fn() } } }));

describe('useMembers', () => {
  it('fetches again when filters or page change and caches by query parameters', async () => {
    vi.mocked(api.members.list).mockImplementation(async (params) => listMockMembers(params));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ page, planCode }) => useMembers({ page, limit: 2, planCode }), { wrapper, initialProps: { page: 1, planCode: 'GOLD' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);
    rerender({ page: 2, planCode: 'GOLD' });
    await waitFor(() => expect(result.current.data?.meta.page).toBe(2));
    expect(api.members.list).toHaveBeenLastCalledWith({ page: 2, limit: 2, planCode: 'GOLD' });
    rerender({ page: 1, planCode: 'JUNIOR' });
    await waitFor(() => expect(result.current.data?.data[0]?.membership?.plan.code).toBe('JUNIOR'));
    expect(client.getQueryData(['members', { page: 2, limit: 2, planCode: 'GOLD' }])).toBeDefined();
    client.clear();
  });
});

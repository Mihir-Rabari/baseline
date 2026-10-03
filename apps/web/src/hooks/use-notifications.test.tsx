import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createNotificationMock } from '@/lib/notification-api';
import { useNotifications } from './use-notifications';

const doubles = vi.hoisted(() => ({ api: { list: vi.fn(), count: vi.fn(), read: vi.fn(), readAll: vi.fn() }, permissions: new Set<string>(), userId: 'first-user' }));
vi.mock('@/lib/notification-api', async (original) => ({ ...(await original<object>()), notificationApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: doubles.userId }, hasPermission: (permission: string) => doubles.permissions.has(permission) }) }));
beforeEach(() => {
  vi.clearAllMocks(); doubles.permissions = new Set(['notifications:read:self', 'notifications:update:self']);
  const state = createNotificationMock(); doubles.userId = 'first-user';
  doubles.api.list.mockImplementation((_scope, params) => Promise.resolve(state.list(params)));
  doubles.api.count.mockImplementation(() => Promise.resolve(state.count()));
  doubles.api.read.mockImplementation((_scope, id) => Promise.resolve(state.read(id)));
  doubles.api.readAll.mockImplementation(() => Promise.resolve(state.readAll()));
});
const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
describe('Notification queries', () => {
  it('refreshes the badge and recent list after reading one or all notifications', async () => {
    const { result } = renderHook(() => useNotifications(1, 8), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.count.data?.count).toBe(4));
    await waitFor(() => expect(result.current.list.data?.data.length).toBe(4));
    await act(() => result.current.read.mutateAsync(result.current.list.data!.data[0].id));
    await waitFor(() => expect(result.current.count.data?.count).toBe(3));
    expect(result.current.list.data?.data[0].readAt).not.toBeNull();
    await act(() => result.current.readAll.mutateAsync());
    await waitFor(() => expect(result.current.count.data?.count).toBe(0));
    expect(doubles.api.list).toHaveBeenCalledWith('first-user', { page: 1, limit: 8 });
  });
  it('does not request notifications without the read permission', () => {
    doubles.permissions = new Set();
    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper() });
    expect(result.current.canRead).toBe(false);
    expect(doubles.api.list).not.toHaveBeenCalled(); expect(doubles.api.count).not.toHaveBeenCalled();
  });
});

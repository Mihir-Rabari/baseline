import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useIamUsers,
  useIamUser,
  useUpdateUserStatus,
  useAssignRole,
  useCreateRole,
  useIamRoles,
} from './use-iam';

vi.mock('@/lib/api-client', () => ({
  api: {
    iam: {
      listUsers: vi.fn(),
      getUser: vi.fn(),
      updateUserStatus: vi.fn(),
      assignRole: vi.fn(),
      createRole: vi.fn(),
      listRoles: vi.fn(),
    },
  },
}));

import { api } from '@/lib/api-client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('use-iam hooks (@app/web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useIamUsers fetches with the ["iam", "users", query] key', async () => {
    vi.mocked(api.iam.listUsers).mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
    });

    const { result } = renderHook(() => useIamUsers({ page: 1 }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.iam.listUsers).toHaveBeenCalledWith({ page: 1 });
  });

  it('useIamUser is disabled until an id is provided', () => {
    const { result } = renderHook(() => useIamUser(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.iam.getUser).not.toHaveBeenCalled();
  });

  it('useUpdateUserStatus invalidates the users list and the affected user on success', async () => {
    vi.mocked(api.iam.updateUserStatus).mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      name: 'U',
      status: 'SUSPENDED',
      identityType: 'EXTERNAL_USER',
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUpdateUserStatus(), { wrapper });

    result.current.mutate({ id: 'user-1', data: { status: 'SUSPENDED' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['iam', 'users'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['iam', 'user', 'user-1'] });
  });

  it('useAssignRole invalidates the user and their permissions cache', async () => {
    vi.mocked(api.iam.assignRole).mockResolvedValue({ success: true, message: 'ok' });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAssignRole(), { wrapper });

    result.current.mutate({ userId: 'user-1', roleId: 'role-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['iam', 'user', 'user-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['iam', 'user', 'user-1', 'permissions'],
    });
  });

  it('useCreateRole invalidates the roles list on success', async () => {
    vi.mocked(api.iam.createRole).mockResolvedValue({
      id: 'role-1',
      name: 'Admin',
      description: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCreateRole(), { wrapper });

    result.current.mutate({ name: 'Admin' } as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['iam', 'roles'] });
  });

  it('useIamRoles uses the ["iam", "roles"] key', async () => {
    vi.mocked(api.iam.listRoles).mockResolvedValue([]);

    const { result } = renderHook(() => useIamRoles(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.iam.listRoles).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileAvatarApi } from '@/lib/profile-avatar';
import { profileAvatarKey, useProfileAvatar } from '../../../../apps/web/src/hooks/use-profile-avatar';

vi.mock('@/lib/profile-avatar', () => ({
  profileAvatarApi: { get: vi.fn(), upload: vi.fn(), remove: vi.fn() },
  profileAvatarUrl: (id: string, version: string) => `/avatar/${id}?v=${version}`,
}));
beforeEach(() => vi.clearAllMocks());
function setup(userId?: string, enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useProfileAvatar(userId, enabled), { wrapper }) };
}
describe('useProfileAvatar', () => {
  it('does not fetch when signed out or permission is missing', () => {
    setup(); setup('user-a', false);
    expect(profileAvatarApi.get).not.toHaveBeenCalled();
  });
  it('updates the same account cache after upload and removal', async () => {
    vi.mocked(profileAvatarApi.get).mockResolvedValue({ version: null });
    vi.mocked(profileAvatarApi.upload).mockResolvedValue({ version: 'updated' });
    vi.mocked(profileAvatarApi.remove).mockResolvedValue({ success: true });
    const { result, client } = setup('user-a');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.src).toBeUndefined();
    await act(async () => { await result.current.upload.mutateAsync('PNG'); });
    await waitFor(() => expect(result.current.src).toBe('/avatar/user-a?v=updated'));
    expect(client.getQueryData(profileAvatarKey('user-a'))).toEqual({ version: 'updated' });
    expect(client.getQueryData(profileAvatarKey('user-b'))).toBeUndefined();
    await act(async () => { await result.current.remove.mutateAsync(); });
    await waitFor(() => expect(result.current.src).toBeUndefined());
  });
  it('preserves the displayed photo when a replacement fails', async () => {
    vi.mocked(profileAvatarApi.get).mockResolvedValue({ version: 'existing' });
    vi.mocked(profileAvatarApi.upload).mockRejectedValue(new Error('Storage unavailable'));
    const { result } = setup('user-a');
    await waitFor(() => expect(result.current.src).toBe('/avatar/user-a?v=existing'));
    await act(async () => { await expect(result.current.upload.mutateAsync('PNG')).rejects.toThrow('Storage unavailable'); });
    expect(result.current.src).toBe('/avatar/user-a?v=existing');
  });
});

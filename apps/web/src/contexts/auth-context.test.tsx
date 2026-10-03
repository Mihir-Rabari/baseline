import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AuthUser, AuthSessionInfo, SessionResponse } from '@packages/validation';
import { AuthProvider, useAuth } from './auth-context';

// Matches the mocking convention used in src/lib/api-client.test.ts (mock the module
// boundary rather than reaching into fetch), since AuthProvider talks to `api.auth.*`
// directly and never touches `fetch` itself.
vi.mock('@/lib/api-client', () => ({
  api: {
    auth: {
      getSession: vi.fn(),
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
    },
  },
}));

import { api } from '@/lib/api-client';

const mockUser: AuthUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  name: 'Test User',
  status: 'ACTIVE',
  identityType: 'EXTERNAL_USER',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockRootUser: AuthUser = { ...mockUser, identityType: 'ROOT' };

const mockSession: AuthSessionInfo = {
  id: '22222222-2222-2222-2222-222222222222',
  expiresAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockSessionResponse(user: AuthUser, permissions: string[] = []): SessionResponse {
  return { user, session: mockSession, effectivePermissions: permissions };
}

/** Small consumer that surfaces AuthContext state as text/attributes for assertions. */
function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user-email">{auth.user?.email ?? 'none'}</span>
      <span data-testid="is-root">{String(auth.isRoot)}</span>
      <span data-testid="can-read-users">{String(auth.hasPermission('users:read'))}</span>
      <button onClick={() => auth.login({ email: 'user@example.com', password: 'pw' })}>login</button>
      <button onClick={() => auth.logout()}>logout</button>
    </div>
  );
}

describe('AuthProvider (@app/web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bootstraps the session on mount and exposes the authenticated user', async () => {
    vi.mocked(api.auth.getSession).mockResolvedValue(mockSessionResponse(mockUser, ['users:read']));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user-email')).toHaveTextContent('user@example.com');
    expect(screen.getByTestId('can-read-users')).toHaveTextContent('true');
    expect(api.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('clears state when the session bootstrap is unauthenticated', async () => {
    vi.mocked(api.auth.getSession).mockRejectedValue(new Error('Unauthorized'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('user-email').textContent).toBe('none');
  });

  it('logs in and updates user/session/permissions state', async () => {
    vi.mocked(api.auth.getSession).mockRejectedValue(new Error('Unauthorized'));
    vi.mocked(api.auth.login).mockResolvedValue(mockSessionResponse(mockUser, ['orders:*']));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('true'));
    expect(api.auth.login).toHaveBeenCalledWith({ email: 'user@example.com', password: 'pw' });
  });

  it('logs out and clears state even if the logout request fails', async () => {
    vi.mocked(api.auth.getSession).mockResolvedValue(mockSessionResponse(mockUser));
    vi.mocked(api.auth.logout).mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('true'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('false'));
    expect(screen.getByTestId('user-email').textContent).toBe('none');
  });

  it('grants every permission to a ROOT identity regardless of effectivePermissions', async () => {
    vi.mocked(api.auth.getSession).mockResolvedValue(mockSessionResponse(mockRootUser, []));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('is-root').textContent).toBe('true'));
    expect(screen.getByTestId('can-read-users').textContent).toBe('true');
  });

  it('throws when useAuth is used outside of an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });
});

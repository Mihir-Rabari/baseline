import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfilePanel } from './profile-panel';

const mocks = vi.hoisted(() => ({ update: vi.fn(), password: vi.fn(), refresh: vi.fn(), logout: vi.fn(), theme: vi.fn(), canUpdate: true }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({
  user: { id: 'user-one', name: 'Khushi', email: 'khushi@example.com', status: 'ACTIVE' },
  session: { createdAt: '2026-10-01T12:00:00Z', expiresAt: '2026-10-08T12:00:00Z' },
  effectivePermissions: ['profile:read:self'], isRoot: false,
  refreshSession: mocks.refresh, logout: mocks.logout, hasPermission: () => mocks.canUpdate,
}) }));
vi.mock('@/lib/api-client', () => ({ api: { profile: { update: mocks.update, changePassword: mocks.password } } }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: mocks.theme }) }));
vi.mock('./profile-avatar', () => ({ ProfileAvatar: () => <div>Profile photo</div> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function fillPassword(confirmation = 'new-password') {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
}

describe('ProfilePanel', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.canUpdate = true; mocks.update.mockResolvedValue({}); mocks.password.mockResolvedValue({}); mocks.refresh.mockResolvedValue(undefined); });

  it('groups personal information, security, preferences and current session', () => {
    render(<ProfilePanel />);
    for (const title of ['Personal information', 'Security', 'Preferences', 'Sessions']) expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Khushi');
    expect(screen.getByText('Your current signed-in session.')).toBeVisible();
  });

  it('saves personal details and refreshes without replacing the authenticated screen', async () => {
    render(<ProfilePanel />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Khushi Trivedi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Profile details updated successfully')).toBeVisible());
    expect(mocks.update).toHaveBeenCalledWith({ name: 'Khushi Trivedi', email: 'khushi@example.com' });
    expect(mocks.refresh).toHaveBeenCalledWith({ background: true });
  });

  it('preserves edited details and displays a failed update', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Email is already in use'));
    render(<ProfilePanel />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email is already in use');
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirmation without sending passwords', () => {
    render(<ProfilePanel />); fillPassword('different');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The new passwords do not match.');
    expect(mocks.password).not.toHaveBeenCalled();
  });

  it('clears all password fields after a successful change', async () => {
    render(<ProfilePanel />); fillPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await screen.findByText('Password changed successfully');
    expect(mocks.password).toHaveBeenCalledWith({ currentPassword: 'old-password', newPassword: 'new-password' });
    for (const label of ['Current password', 'New password', 'Confirm new password']) expect(screen.getByLabelText(label)).toHaveValue('');
  });

  it('keeps read-only accounts from editing profile or password', () => {
    mocks.canUpdate = false; render(<ProfilePanel />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update password' })).not.toBeInTheDocument();
  });

  it('saves appearance using the existing browser theme preference', () => {
    render(<ProfilePanel />);
    fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'dark' } });
    expect(mocks.theme).toHaveBeenCalledWith('dark');
  });

  it('signs out the current session', () => {
    render(<ProfilePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of this session' }));
    expect(mocks.logout).toHaveBeenCalledOnce();
  });
});

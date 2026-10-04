import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '../../../../../../apps/web/src/app/(app)/dashboard/page';

const navigation = vi.hoisted(() => ({ tab: null as string | null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => navigation.tab }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { name: 'Khushi', email: 'khushi@example.com' } }) }));
vi.mock('@/components/profile/profile-panel', () => ({ ProfilePanel: () => <div>Profile sections</div> }));
vi.mock('@/components/club/dashboard-workspace', () => ({ DashboardWorkspace: () => <div>Club overview</div> }));

describe('Dashboard profile navigation', () => {
  it('opens the profile when the account menu changes the URL on an already mounted dashboard', () => {
    navigation.tab = null;
    const { rerender } = render(<DashboardPage />);
    expect(screen.getByText('Club overview')).toBeVisible();
    navigation.tab = 'profile'; rerender(<DashboardPage />);
    expect(screen.getByText('Profile sections')).toBeVisible();
    expect(screen.queryByText('Club overview')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Overview' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('Club overview')).toBeVisible();
  });
});

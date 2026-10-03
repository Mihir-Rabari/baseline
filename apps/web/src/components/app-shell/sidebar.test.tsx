import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './sidebar';

const state = vi.hoisted(() => ({ pathname: '/dashboard', isRoot: false, permissions: [] as string[] }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({
  isRoot: state.isRoot, hasPermission: (permission: string) => state.permissions.includes(permission),
}) }));

describe('club navigation', () => {
  beforeEach(() => {
    state.pathname = '/dashboard';
    state.isRoot = false;
    state.permissions = [];
  });

  it('hides restricted destinations and empty sections without permissions', () => {
    render(<Sidebar />);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard']);
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Bar')).not.toBeInTheDocument();
  });

  it('shows member destinations without staff or admin access', () => {
    state.permissions = ['bookings:read:self', 'orders:read:self'];
    render(<Sidebar />);
    for (const name of ['Courts', 'Bookings', 'Membership', 'Orders']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of ['Members', 'Reports', 'Access (IAM)', 'Counter sale']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('shows only granted staff destinations', () => {
    state.permissions = ['members:read', 'orders:create', 'inventory:read'];
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Counter sale' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Membership' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('shows every destination for root', () => {
    state.isRoot = true;
    render(<Sidebar />);
    expect(screen.getAllByRole('link')).toHaveLength(19);
  });

  it.each(['/bar/kitchen', '/bar/earnings', '/admin/club', '/members/member-1'])('highlights only the most specific destination at %s', (pathname) => {
    state.isRoot = true;
    state.pathname = pathname;
    render(<Sidebar />);
    const active = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('href', pathname.startsWith('/members/') ? '/members' : pathname);
  });

  it('does not match an unrelated path prefix and closes mobile navigation on click', () => {
    state.isRoot = true;
    state.pathname = '/membership-other';
    const onNavigate = vi.fn();
    render(<Sidebar onNavigate={onNavigate} />);
    expect(screen.getAllByRole('link').some((link) => link.hasAttribute('aria-current'))).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});

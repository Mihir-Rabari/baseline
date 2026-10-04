import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from './layout';

const state = vi.hoisted(() => ({
  pathname: '/admin',
  isRoot: false,
  permissions: [] as string[],
  user: { id: 'user-1', email: 'admin@baseline.test' } as { id: string; email: string } | null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: state.user,
    isRoot: state.isRoot,
    hasPermission: (perm: string) => state.permissions.includes(perm),
  }),
}));

describe('AdminLayout (Issue #64)', () => {
  beforeEach(() => {
    state.pathname = '/admin';
    state.isRoot = false;
    state.permissions = ['admin:access'];
    state.user = { id: 'user-1', email: 'admin@baseline.test' };
  });

  it('renders IAM tabs on IAM overview and IAM subpages', () => {
    state.pathname = '/admin';
    render(
      <AdminLayout>
        <div>Admin Overview Content</div>
      </AdminLayout>
    );

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Policies' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByText('Admin Overview Content')).toBeInTheDocument();
  });

  it('removes IAM tabs from the top of the Club Settings page (/admin/club)', () => {
    state.pathname = '/admin/club';
    render(
      <AdminLayout>
        <div>Club Settings Content</div>
      </AdminLayout>
    );

    // IAM tabs must not be present on Club Settings
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.getByText('Club Settings Content')).toBeInTheDocument();
  });

  it('blocks access when user lacks admin permission', () => {
    state.permissions = [];
    render(
      <AdminLayout>
        <div>Protected Content</div>
      </AdminLayout>
    );

    expect(screen.getByText('Not allowed')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});

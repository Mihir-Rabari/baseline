import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '@/app/(app)/admin/iam/users/page';
import UserPage from '@/app/(app)/admin/iam/users/[id]/page';
import PoliciesPage from '@/app/(app)/admin/iam/policies/page';
const state = vi.hoisted(() => ({ policies: [] as Record<string, unknown>[], users: [] as Record<string, unknown>[], user: null as Record<string, unknown> | null, update: vi.fn(), role: vi.fn(), group: vi.fn(), policy: vi.fn(), refetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'user-1' }) }));
vi.mock('@/hooks/use-iam', () => ({
  useIamUsers: () => ({ data: { data: state.users, meta: { page: 1, limit: 10, totalItems: 21, totalPages: 3, hasNextPage: true, hasPrevPage: false } }, isLoading: false, refetch: state.refetch }),
  useUpdateUserStatus: () => ({ mutateAsync: state.update }),
  useIamUser: () => ({ data: state.user, refetch: state.refetch }),
  useIamUserPermissions: () => ({ data: { effectivePermissions: [] }, refetch: state.refetch }),
  useIamRoles: () => ({ data: [] }), useIamGroups: () => ({ data: [] }), useIamPolicies: () => ({ data: state.policies }), useIamPolicy: (id: string) => ({ data: id ? state.policies[0] ?? null : null }),
  useAssignRole: () => ({ mutateAsync: vi.fn() }), useRemoveRole: () => ({ mutateAsync: state.role }),
  useAddUserToGroup: () => ({ mutateAsync: vi.fn() }), useRemoveUserFromGroup: () => ({ mutateAsync: state.group }),
  useAttachDirectPolicy: () => ({ mutateAsync: vi.fn() }), useDetachDirectPolicy: () => ({ mutateAsync: state.policy }),
  useCreatePolicy: () => ({ mutateAsync: vi.fn() }), useDeletePolicy: () => ({ mutateAsync: vi.fn() }),
}));
const user = { id: 'user-1', name: 'Khushi', email: 'khushi@example.com', identityType: 'USER', status: 'ACTIVE', createdAt: '2026-10-04T12:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); state.policies = []; state.update.mockResolvedValue(undefined); state.role.mockResolvedValue(undefined); state.group.mockResolvedValue(undefined); state.policy.mockResolvedValue(undefined); state.users = [user]; state.user = { ...user, roles: [{ id: 'r1', name: 'Desk' }], groups: [{ id: 'g1', name: 'Staff' }], directPolicies: [{ id: 'p1', name: 'Read only' }] }; });
describe('IAM icon-only controls', () => {
  it('names status actions and retains visible status text and correct mutations', async () => {
    render(<UsersPage />);
    expect(screen.getByText('ACTIVE')).toBeVisible();
    const suspend = screen.getByRole('button', { name: 'Suspend Khushi' });
    expect(suspend.querySelector('svg')).toHaveAttribute('aria-hidden', 'true'); expect(suspend.querySelector('svg')).toHaveClass('h-4', 'w-4');
    fireEvent.click(suspend); await waitFor(() => expect(state.update).toHaveBeenCalledWith({ id: 'user-1', data: { status: 'SUSPENDED' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable Khushi' })); await waitFor(() => expect(state.update).toHaveBeenCalledWith({ id: 'user-1', data: { status: 'DISABLED' } }));
    const inspect = screen.getByRole('link', { name: 'Inspect' }); expect(inspect).toHaveAttribute('href', '/admin/iam/users/user-1'); expect(inspect.querySelector('button')).toBeNull();
  });
  it('names pagination and search controls without changing their behavior', () => {
    render(<UsersPage />); expect(screen.getByLabelText('Search users')).toHaveValue(''); fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Khushi' } }); expect(screen.getByLabelText('Search users')).toHaveValue('Khushi');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });
  it('keeps root actions hidden and names activation for suspended accounts', () => {
    state.users = [{ ...user, id: 'root', name: 'Root', identityType: 'ROOT' }, { ...user, status: 'SUSPENDED' }]; render(<UsersPage />);
    expect(screen.queryByRole('button', { name: /Root/ })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Activate Khushi' })).toBeVisible();
  });
  it('uses a text-led empty state with no ornamental glyph', () => {
    state.users = []; render(<UsersPage />); const empty = screen.getByText('No users found').parentElement!; expect(within(empty).getByText('Try a different name, email or status.')).toBeVisible(); expect(empty.querySelector('svg')).toBeNull();
  });
  it('names each assignment removal by its resource and invokes the right mutation', async () => {
    render(<UserPage />); fireEvent.click(screen.getByRole('button', { name: 'Remove role Desk' })); await waitFor(() => expect(state.role).toHaveBeenCalledWith({ userId: 'user-1', roleId: 'r1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove group Staff' })); await waitFor(() => expect(state.group).toHaveBeenCalledWith({ userId: 'user-1', groupId: 'g1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detach policy Read only' })); await waitFor(() => expect(state.policy).toHaveBeenCalledWith({ userId: 'user-1', policyId: 'p1' }));
    for (const heading of screen.getAllByRole('heading')) expect(heading.querySelector('svg')).toBeNull();
  });
  it('names the policy detail close control and dismisses it', () => { state.policies = [{ id: 'p1', name: 'Read only', isSystem: false, statements: [] }]; render(<PoliciesPage />); fireEvent.click(screen.getByRole('button', { name: 'View Statements' })); const close = screen.getByRole('button', { name: 'Close policy details' }); expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true'); fireEvent.click(close); expect(screen.queryByRole('button', { name: 'Close policy details' })).not.toBeInTheDocument(); });
  it('names statement removal buttons and removes the selected statement', () => {
    render(<PoliciesPage />); fireEvent.click(screen.getByRole('button', { name: 'Create Policy' })); fireEvent.click(screen.getByRole('button', { name: 'Add Statement' }));
    expect(screen.getByText('Statement #2')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Remove statement 2' })); expect(screen.queryByText('Statement #2')).not.toBeInTheDocument();
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import plans from '@/mocks/plans.json';
import created from '@/mocks/member-created.json';
import NewMemberPage from './page';

const state = vi.hoisted(() => ({ plans: { data: undefined as unknown, error: null, isPending: false, refetch: vi.fn() }, mutation: { isPending: false, mutateAsync: vi.fn() }, push: vi.fn(), success: vi.fn(), error: vi.fn(), permissions: ['members:create', 'memberships:create'] }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => state.plans }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'staff' }, hasPermission: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('@/hooks/use-create-member', () => ({ useCreateMember: () => state.mutation }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('sonner', () => ({ toast: { success: state.success, error: state.error } }));
function fill() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Riya Kapoor' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+919811122233' } });
  fireEvent.click(screen.getByRole('button', { name: /Gold/ }));
}
describe('New member form', () => {
  beforeEach(() => { state.permissions = ['members:create', 'memberships:create']; state.plans.data = plans; state.mutation.isPending = false; state.mutation.mutateAsync.mockReset().mockResolvedValue(created); state.push.mockReset(); state.success.mockReset(); state.error.mockReset(); });
  it.each([['members:create'], ['memberships:create'], []])('blocks registration when permissions are incomplete: %j', (...permissions) => {
    state.permissions = permissions as string[];
    render(<NewMemberPage />);
    expect(screen.getByText('Registration is unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register member' })).not.toBeInTheDocument();
    expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  });
  it('blocks an incomplete registration', async () => {
    render(<NewMemberPage />); fireEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  });
  it('registers with typed values and uses actual returned code and ID', async () => {
    render(<NewMemberPage />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith(`/members/${created.member.id}`));
    expect(state.success).toHaveBeenCalledWith(`Member ${created.member.memberCode} registered`);
    expect(state.mutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Riya Kapoor', phone: '+919811122233', planId: plans[0].id, paymentMethod: 'CASH', email: undefined }));
  });
  it('requires Junior date of birth and prevents adult registration', async () => {
    render(<NewMemberPage />); fill(); fireEvent.click(screen.getByRole('button', { name: /Junior/ }));
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Junior members must be under 18'));
    expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  });
  it('keeps details after failure and shows the error', async () => {
    state.mutation.mutateAsync.mockRejectedValue(new Error('Duplicate phone'));
    render(<NewMemberPage />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Register member' }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Duplicate phone'));
    expect(screen.getByLabelText('Name')).toHaveValue('Riya Kapoor');
    expect(state.push).not.toHaveBeenCalled();
  });
  it('disables all actions while saving', () => {
    state.mutation.isPending = true; render(<NewMemberPage />);
    expect(screen.getByRole('button', { name: 'Registering member…' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Gold/ })).toBeDisabled();
  });
});

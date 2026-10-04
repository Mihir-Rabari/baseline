import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMockMembers } from '@/lib/mock-members';
import MembersPage from './page';

const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as Error | null, isPending: false, refetch: vi.fn(), create: true, membershipCreate: true, params: vi.fn() }));
vi.mock('@/hooks/use-members', () => ({ useMembers: (params: unknown) => { state.params(params); return state; } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'staff' }, hasPermission: (permission: string) => permission === 'memberships:create' ? state.membershipCreate : state.create }) }));

describe('members page', () => {
  beforeEach(() => { state.data = listMockMembers({}); state.error = null; state.isPending = false; state.create = true; state.membershipCreate = true; vi.clearAllMocks(); });
  afterEach(() => vi.useRealTimers());
  it('shows accessible member links, expiry states and safe absent membership', () => {
    render(<MembersPage />);
    expect(screen.getAllByRole('row')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Aarav Mehta' })).toHaveAttribute('href', '/members/b0000000-0000-4000-8000-000000000001');
    expect(screen.getByRole('link', { name: 'New member' })).toHaveAttribute('href', '/members/new');
    expect(screen.getAllByText('Expiring soon')).toHaveLength(2);
    expect(screen.getAllByText('Expired')).toHaveLength(2);
    expect(screen.getByText('No membership')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('switches between list, cards and board, and asks for the larger page only for the board', () => {
    window.localStorage.clear();
    render(<MembersPage />);
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Aarav Mehta/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 100 }));
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }));
    window.localStorage.clear();
  });
  it('hides registration without create permission', () => {
    state.create = false;
    render(<MembersPage />);
    expect(screen.queryByRole('link', { name: 'New member' })).not.toBeInTheDocument();
  });
  it('hides registration when only member creation is permitted', () => {
    state.membershipCreate = false;
    render(<MembersPage />);
    expect(screen.queryByRole('link', { name: 'New member' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aarav Mehta' })).toBeInTheDocument();
  });
  it('renders loading skeletons and an actionable empty state', () => {
    state.isPending = true;
    const { rerender } = render(<MembersPage />);
    expect(screen.getByRole('status', { name: 'Loading members' })).toBeInTheDocument();
    state.isPending = false; state.data = listMockMembers({ q: 'missing' });
    rerender(<MembersPage />);
    expect(screen.getByText('No members match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
  it('renders errors and retries the query', () => {
    state.error = new Error('Service unavailable');
    render(<MembersPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
  it('debounces trimmed searches, omits one character and resets page on filters', () => {
    vi.useFakeTimers();
    state.data = listMockMembers({ limit: 2 });
    render(<MembersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'a' } });
    act(() => vi.advanceTimersByTime(250));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, q: undefined }));
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: ' Aarav ' } });
    act(() => vi.advanceTimersByTime(249));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined }));
    act(() => vi.advanceTimersByTime(1));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Aarav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Plan' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Gold' }));
    expect(state.params).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, planCode: 'GOLD' }));
  });
});

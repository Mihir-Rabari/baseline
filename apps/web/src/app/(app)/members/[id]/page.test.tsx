import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSchema, MemberTimelinePageSchema } from '@packages/validation';
import { toast } from 'sonner';
import detail from '@/mocks/member-detail.json';
import events from '@/mocks/member-timeline.json';
import MemberProfilePage from './page';

const state = vi.hoisted(() => ({
  member: { data: undefined as unknown, error: null as Error | null, isPending: false, refetch: vi.fn() },
  timeline: { data: undefined as unknown, error: null as Error | null, isPending: false, refetch: vi.fn() },
  checkin: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  renewal: { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
  permission: true,
  permissions: null as string[] | null,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'b0000000-0000-4000-8000-000000000002' }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'staff' }, hasPermission: (action: string) => state.permissions ? state.permissions.includes(action) : state.permission }) }));
vi.mock('@/hooks/use-member-profile', () => ({ useMemberProfile: () => state.member, useMemberTimeline: () => state.timeline, useMemberCheckin: () => state.checkin, useMemberRenewal: () => state.renewal }));
vi.mock('@/hooks/use-ops', () => ({ useOpsMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function switchTab(name: string) { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }); }

describe('member profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.member = { data: MemberSchema.parse(detail), error: null, isPending: false, refetch: vi.fn() };
    state.timeline = { data: MemberTimelinePageSchema.parse(events), error: null, isPending: false, refetch: vi.fn() };
    state.checkin = { mutateAsync: vi.fn().mockResolvedValue({}), error: null, isPending: false };
    state.renewal = { mutateAsync: vi.fn().mockResolvedValue({}), reset: vi.fn(), error: null, isPending: false };
    state.permission = true;
    state.permissions = null;
  });
  it('shows profile fields and expiring notice, then switches to mixed activity', () => {
    render(<MemberProfilePage />);
    expect(screen.getByRole('heading', { name: 'Diya Shah' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Membership expires in 5 days');
    expect(screen.getByText('9876543202')).toBeInTheDocument();
    switchTab('Timeline');
    expect(screen.getByText('Tennis court booked')).toBeInTheDocument();
    expect(screen.getByText('₹420')).toBeInTheDocument();
    expect(screen.queryByText('9876543202')).not.toBeInTheDocument();
  });
  it('opens renewal, closes with Escape, sends payment and closes after success', async () => {
    render(<MemberProfilePage />);
    switchTab('Membership');
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm renewal' }));
    await waitFor(() => expect(state.renewal.mutateAsync).toHaveBeenCalledWith({ paymentMethod: 'CASH' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('keeps renewal open on payment failure and allows retry', async () => {
    state.renewal.mutateAsync.mockRejectedValue(new Error('Payment not recorded'));
    const { rerender } = render(<MemberProfilePage />);
    switchTab('Membership'); fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm renewal' }));
    await waitFor(() => expect(state.renewal.mutateAsync).toHaveBeenCalledOnce());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Payment not recorded'));
    state.renewal.error = new Error('Payment not recorded');
    rerender(<MemberProfilePage />);
    expect(screen.getByText('Payment not recorded')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm renewal' })).toBeEnabled();
  });
  it('shows expired and no-membership profiles safely', () => {
    const member = MemberSchema.parse(detail);
    if (member.membership) { member.membership.expiryState = 'EXPIRED'; member.membership.status = 'EXPIRED'; member.membership.daysLeft = -3; }
    state.member.data = member;
    const { rerender } = render(<MemberProfilePage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Membership expired');
    state.member.data = { ...member, membership: null };
    rerender(<MemberProfilePage />);
    expect(screen.getAllByText('No membership').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('handles 404 and generic errors with appropriate next steps', () => {
    state.member.error = Object.assign(new Error('Missing'), { statusCode: 404 });
    const { rerender } = render(<MemberProfilePage />);
    expect(screen.getByText('Member not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to members' })).toHaveAttribute('href', '/members');
    state.member.error = new Error('Service unavailable'); rerender(<MemberProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.member.refetch).toHaveBeenCalledOnce();
  });
  it('handles loading, empty timeline and timeline errors', () => {
    state.member.isPending = true;
    const { rerender } = render(<MemberProfilePage />);
    expect(screen.getByRole('status', { name: 'Loading member' })).toBeInTheDocument();
    state.member.isPending = false; state.timeline.isPending = true; rerender(<MemberProfilePage />); switchTab('Timeline');
    expect(screen.getByRole('status', { name: 'Loading timeline' })).toBeInTheDocument();
    state.timeline.isPending = false; state.timeline.data = { data: [], meta: events.meta }; rerender(<MemberProfilePage />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    state.timeline.error = new Error('Timeline unavailable'); rerender(<MemberProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(state.timeline.refetch).toHaveBeenCalledOnce();
  });
  it('checks in and hides actions without permissions', async () => {
    const { rerender } = render(<MemberProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(state.checkin.mutateAsync).toHaveBeenCalledOnce());
    state.permission = false; rerender(<MemberProfilePage />);
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    switchTab('Membership'); expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
  });
  it.each([{ permissions: ['members:read'] }, { permissions: ['members:update'] }, { permissions: [] }])('hides check-in with partial permissions $permissions', ({ permissions }) => {
    state.permissions = permissions;
    render(<MemberProfilePage />);
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    expect(state.checkin.mutateAsync).not.toHaveBeenCalled();
  });
  it('shows check-in only when both member permissions are present', () => {
    state.permissions = ['members:read', 'members:update'];
    render(<MemberProfilePage />);
    expect(screen.getByRole('button', { name: 'Check in' })).toBeEnabled();
  });
  it('requires membership update rather than create permission for renewal', () => {
    state.permissions = ['memberships:create'];
    const { rerender } = render(<MemberProfilePage />);
    switchTab('Membership');
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
    state.permissions = ['memberships:update'];
    rerender(<MemberProfilePage />);
    expect(screen.getByRole('button', { name: 'Renew' })).toBeEnabled();
  });
  it('disables payment selection and confirmation while renewal is pending', () => {
    state.renewal.isPending = true;
    render(<MemberProfilePage />);
    switchTab('Membership');
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    expect(screen.getByRole('combobox', { name: 'Payment method' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Renewing…' })).toBeDisabled();
  });
});

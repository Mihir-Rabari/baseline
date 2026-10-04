import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chooseOption } from '@/test-utils/ui';
import { ShiftSwaps } from '../../../../../apps/web/src/components/club/shift-swaps';

const SHIFT = '10000000-0000-4000-8000-000000000001';
const OTHER_SHIFT = '10000000-0000-4000-8000-000000000002';
const ANN = '20000000-0000-4000-8000-000000000001';
const BEN = '20000000-0000-4000-8000-000000000002';
const SWAP = '30000000-0000-4000-8000-000000000001';

const doubles = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/ops', () => ({ ops: { get: doubles.get, post: doubles.post } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: (permission: string) => doubles.permissions.has(permission) }) }));

const shift = (id: string, day: string) => ({ id, roleLabel: 'FRONT_DESK', startsAt: `${day}T04:30:00.000Z`, endsAt: `${day}T12:30:00.000Z` });
const swap = (overrides: Record<string, unknown> = {}) => ({
  id: SWAP, status: 'PENDING', role: null, shift: shift(SHIFT, '2031-05-10'), requestedShift: null,
  proposer: { id: ANN, fullName: 'Ann Proposer' }, target: { id: BEN, fullName: 'Ben Target' },
  note: null, decisionNote: null, respondedAt: null, decidedAt: null, createdAt: '2031-05-01T00:00:00.000Z', ...overrides,
});

let data: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  doubles.permissions = new Set(['shifts:read', 'shifts:clock:self']);
  data = {
    '/me/shift-swaps': [], '/shift-swaps': [],
    '/me/shifts/upcoming': [{ ...shift(SHIFT, '2031-05-10'), employee: { id: ANN, fullName: 'Ann Proposer' }, clockInAt: null, clockOutAt: null, status: 'SCHEDULED' }, { ...shift(OTHER_SHIFT, '2031-05-12'), employee: { id: ANN, fullName: 'Ann Proposer' }, clockInAt: null, clockOutAt: null, status: 'SCHEDULED' }],
    '/me/colleagues': [{ id: BEN, fullName: 'Ben Target', position: 'Bar' }],
  };
  doubles.get.mockImplementation((path: string) => Promise.resolve(data[path]));
  doubles.post.mockResolvedValue({});
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ShiftSwaps /></QueryClientProvider>);
}

describe('Shift swaps: staff', () => {
  it('offers an upcoming shift to a colleague with a note', async () => {
    mount();
    expect(await screen.findByText(/No swaps yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Offer a shift' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Send offer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose the shift you want to offer.');
    expect(doubles.post).not.toHaveBeenCalled();
    await chooseOption('Shift to offer', /10 May 2031/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose who to offer it to.');
    await chooseOption('Offer to', /Ben Target/);
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), { target: { value: ' Dentist ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(doubles.post).toHaveBeenCalledWith('/me/shift-swaps', { shiftId: SHIFT, targetEmployeeId: BEN, note: 'Dentist' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server reason and keeps the dialog open when an offer is refused', async () => {
    doubles.post.mockRejectedValueOnce(new Error('That shift is already in an open swap.'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Offer a shift' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'Send offer' });
    await chooseOption('Shift to offer', /10 May 2031/);
    await chooseOption('Offer to', /Ben Target/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That shift is already in an open swap.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('tells staff when no shift can be offered', async () => {
    data['/me/shifts/upcoming'] = [];
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Offer a shift' }));
    expect(await screen.findByText('You have no upcoming shifts that can be offered.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send offer' })).not.toBeInTheDocument();
  });

  it('lets the colleague accept or decline an incoming offer, but not withdraw it', async () => {
    data['/me/shift-swaps'] = [swap({ role: 'TARGET', note: 'Dentist' })];
    mount();
    expect(await screen.findByText('Waiting for colleague')).toBeInTheDocument();
    expect(screen.getByText('“Dentist”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept shift from Ann Proposer' }));
    await waitFor(() => expect(doubles.post).toHaveBeenCalledWith(`/me/shift-swaps/${SWAP}/respond`, { id: SWAP, response: 'ACCEPT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline shift from Ann Proposer' }));
    await waitFor(() => expect(doubles.post).toHaveBeenLastCalledWith(`/me/shift-swaps/${SWAP}/respond`, { id: SWAP, response: 'DECLINE' }));
  });

  it('lets the proposer withdraw an open offer, but not answer it', async () => {
    data['/me/shift-swaps'] = [swap({ role: 'PROPOSER' })];
    mount();
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw offer to Ben Target' }));
    await waitFor(() => expect(doubles.post).toHaveBeenCalledWith(`/me/shift-swaps/${SWAP}/cancel`, { id: SWAP }));
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument();
  });

  it('offers no actions on a swap that is already settled', async () => {
    data['/me/shift-swaps'] = [swap({ role: 'PROPOSER', status: 'APPROVED' }), swap({ id: '30000000-0000-4000-8000-000000000002', role: 'TARGET', status: 'DECLINED' })];
    mount();
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw|Accept|Decline/ })).not.toBeInTheDocument();
  });

  it('surfaces the server reason when an answer is refused', async () => {
    data['/me/shift-swaps'] = [swap({ role: 'TARGET' })];
    doubles.post.mockRejectedValueOnce(new Error('This offer was withdrawn.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept shift from Ann Proposer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This offer was withdrawn.');
  });

  it('does not show the owner approvals to staff, and does not call the owner endpoint', async () => {
    mount(); await screen.findByText(/No swaps yet/);
    expect(screen.queryByRole('region', { name: 'Shift swap approvals' })).not.toBeInTheDocument();
    expect(doubles.get).not.toHaveBeenCalledWith('/shift-swaps');
  });
});

describe('Shift swaps: owner', () => {
  beforeEach(() => { doubles.permissions = new Set(['shifts:read', 'shifts:manage']); });

  it('shows nothing to people with neither permission', () => {
    doubles.permissions = new Set(['shifts:read']);
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(doubles.get).not.toHaveBeenCalled();
  });

  it('approves an accepted swap and offers no offer-a-shift button', async () => {
    data['/shift-swaps'] = [swap({ status: 'ACCEPTED' })];
    mount();
    expect(screen.queryByRole('button', { name: 'Offer a shift' })).not.toBeInTheDocument();
    expect(doubles.get).not.toHaveBeenCalledWith('/me/shift-swaps');
    fireEvent.click(await screen.findByRole('button', { name: 'Approve swap from Ann Proposer' }));
    await waitFor(() => expect(doubles.post).toHaveBeenCalledWith(`/shift-swaps/${SWAP}/decision`, { id: SWAP, decision: 'APPROVED' }));
  });

  it('can override a swap the colleague has not answered, but cannot approve it', async () => {
    data['/shift-swaps'] = [swap({ status: 'PENDING' })];
    mount();
    expect(await screen.findByText('Waiting for colleague')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject swap from Ann Proposer' }));
    await waitFor(() => expect(doubles.post).toHaveBeenCalledWith(`/shift-swaps/${SWAP}/decision`, { id: SWAP, decision: 'REJECTED' }));
  });

  it('shows the server message when approval would double-book someone', async () => {
    data['/shift-swaps'] = [swap({ status: 'ACCEPTED' })];
    doubles.post.mockRejectedValueOnce(new Error('Ben Target already has a shift that overlaps this one.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve swap from Ann Proposer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ben Target already has a shift that overlaps this one.');
    expect(screen.getByRole('button', { name: 'Approve swap from Ann Proposer' })).toBeEnabled();
  });

  it('keeps settled swaps out of the action list', async () => {
    data['/shift-swaps'] = [swap({ status: 'REJECTED', decisionNote: 'Short staffed' })];
    mount();
    expect(await screen.findByText('No swaps are waiting for you.')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Owner: Short staffed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve|Reject/ })).not.toBeInTheDocument();
  });
});

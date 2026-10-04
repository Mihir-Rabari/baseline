import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageCourtsPage from './page';

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const state = vi.hoisted(() => ({
  allowed: true,
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'owner' }, hasPermission: () => state.allowed }) }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: (key: string[]) => ({
    data: key[1] === 'types'
      ? [{ id: TYPE_ID, code: 'PADEL', name: 'Padel', baseRatePaise: 80000, isActive: true }]
      : [{ id: 'c1', name: 'Padel 1', type: 'PADEL', typeName: 'Padel', baseRatePaise: 80000, socialCapacity: 4, isActive: true, courtTypeId: TYPE_ID, sortOrder: 1 }],
    isPending: false, error: null, refetch: vi.fn(),
  }),
  useOpsMutation: (method: string) => ({
    isPending: false,
    mutateAsync: method === 'post' ? state.post : method === 'delete' ? state.del : state.put,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('court management', () => {
  beforeEach(() => {
    state.allowed = true;
    state.post.mockReset().mockResolvedValue({});
    state.put.mockReset().mockResolvedValue({});
    state.del.mockReset().mockResolvedValue({ deleted: true, deactivated: false });
  });

  it('is closed to anyone who cannot update courts', () => {
    state.allowed = false;
    render(<ManageCourtsPage />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
  });

  it('adds a court with its sport and order', async () => {
    render(<ManageCourtsPage />);
    expect(screen.getByText('Padel 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New court' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add court' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the court name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Padel 2' } });
    fireEvent.change(screen.getByLabelText('Display order'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add court' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Display order');
    fireEvent.change(screen.getByLabelText('Display order'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add court' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith({ name: 'Padel 2', courtTypeId: TYPE_ID, sortOrder: 2 }));
  });

  it('renames a court and toggles whether it is bookable', async () => {
    render(<ManageCourtsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Padel 1' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Padel One' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'c1', name: 'Padel One', courtTypeId: TYPE_ID, sortOrder: 1, imageUrl: null }));
    fireEvent.click(screen.getByRole('switch', { name: 'Padel 1 bookable' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 'c1', isActive: false }));
  });

  it('asks before removing, and shows why the server refused', async () => {
    state.del.mockRejectedValueOnce(new Error('This court has upcoming bookings. Cancel or move them first.'));
    render(<ManageCourtsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Padel 1' }));
    expect(state.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('upcoming bookings');
  });
});

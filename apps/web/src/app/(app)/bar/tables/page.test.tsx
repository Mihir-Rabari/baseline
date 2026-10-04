import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BarTablesPage from './page';

const state = vi.hoisted(() => ({
  allowed: true,
  tables: [] as unknown[],
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'owner' }, hasPermission: () => state.allowed }) }));
vi.mock('@/hooks/use-ops', () => ({
  useOpsQuery: () => ({ data: state.tables, isPending: false, error: null, refetch: vi.fn() }),
  useOpsMutation: (method: string) => ({
    isPending: false,
    mutateAsync: method === 'post' ? state.post : method === 'delete' ? state.del : state.put,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const table = (over: object = {}) => ({ id: 't1', name: 'T1', seats: 4, status: 'FREE', isActive: true, openTab: null, ...over });

describe('bar table management', () => {
  beforeEach(() => {
    state.allowed = true;
    state.tables = [table(), table({ id: 't2', name: 'T2', isActive: false })];
    state.post.mockReset().mockResolvedValue({});
    state.put.mockReset().mockResolvedValue({});
    state.del.mockReset().mockResolvedValue({ deleted: true, deactivated: false });
  });

  it('is closed to anyone without owner access', () => {
    state.allowed = false;
    render(<BarTablesPage />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
  });

  it('adds a table after validating the name and seats', async () => {
    render(<BarTablesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New table' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the table name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'T9' } });
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seats must be a whole number');
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledWith({ name: 'T9', seats: 6 }));
  });

  it('edits a table and switches it on or off', async () => {
    render(<BarTablesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit T1' }));
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 't1', name: 'T1', seats: 8 }));
    fireEvent.click(screen.getByRole('switch', { name: 'T2 in use' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith({ id: 't2', isActive: true }));
  });

  it('confirms before removing and shows the server refusal', async () => {
    state.del.mockRejectedValueOnce(new Error('Settle or void the open tab before removing this table.'));
    render(<BarTablesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove T1' }));
    expect(state.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('open tab');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.del).toHaveBeenLastCalledWith({ id: 't1' }));
  });
});

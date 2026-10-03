import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBarMock } from '@/lib/mock-bar';
import TabPage from '@/app/(app)/bar/tabs/[id]/page';
import KitchenPage from '@/app/(app)/bar/kitchen/page';
import { BarMenuSettings } from './bar-menu-settings';

const doubles = vi.hoisted(() => ({ api: {
  tab: vi.fn(), menu: vi.fn(), add: vi.fn(), remove: vi.fn(), send: vi.fn(), settle: vi.fn(), tickets: vi.fn(), advance: vi.fn(), updateMenu: vi.fn(),
}, permissions: new Set<string>(), id: '' }));
vi.mock('@/lib/bar-api', () => ({ barApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: (permission: string) => doubles.permissions.has(permission) }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: doubles.id }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const renderPage = (page: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
};
beforeEach(() => {
  vi.clearAllMocks();
  doubles.permissions = new Set(['bar:read', 'bar:manage', 'bar:settle', 'bar:kitchen', 'reports:read']);
  const state = createBarMock(); doubles.id = state.listTables()[0].openTab!.id;
  doubles.api.tab.mockImplementation((id) => Promise.resolve(state.getTab(id)));
  doubles.api.menu.mockImplementation(() => Promise.resolve(state.menu()));
  doubles.api.add.mockImplementation((id, data) => Promise.resolve(state.addItem(id, data)));
  doubles.api.remove.mockImplementation((id, itemId) => Promise.resolve(state.removeItem(id, itemId)));
  doubles.api.send.mockImplementation((id) => Promise.resolve(state.send(id)));
  doubles.api.settle.mockImplementation((id, data) => Promise.resolve(state.settle(id, data)));
  doubles.api.tickets.mockImplementation(() => Promise.resolve(state.tickets()));
  doubles.api.advance.mockImplementation((id, data) => Promise.resolve(state.updateTicket(id, data)));
  doubles.api.updateMenu.mockImplementation((id, data) => Promise.resolve(state.updateMenu(id, data)));
});
describe('Bar screens', () => {
  it('adds an item, sends it and confirms one UPI payment before rendering a read-only receipt', async () => {
    renderPage(<TabPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Lime soda/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send to kitchen' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send to kitchen' }));
    await screen.findByText('Sent');
    expect(screen.queryByRole('button', { name: 'Remove Lime soda line' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settle tab' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'UPI' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));
    await screen.findByText('Settled');
    expect(doubles.api.settle).toHaveBeenCalledTimes(1);
    expect(doubles.api.settle).toHaveBeenCalledWith(doubles.id, { payments: [{ method: 'UPI' }] });
    expect(screen.queryByRole('button', { name: 'Settle tab' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument();
  });
  it('keeps payment details and shows a settlement error for recovery', async () => {
    doubles.api.settle.mockRejectedValue(new Error('Payment could not be recorded. Try again.'));
    renderPage(<TabPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Lime soda/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Settle tab' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Settle tab' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Payment could not be recorded'));
    expect(within(dialog).getByRole('button', { name: 'Confirm payment' })).toBeEnabled();
  });
  it('prevents read-only staff from changing or settling a tab', async () => {
    doubles.permissions = new Set(['bar:read']);
    renderPage(<TabPage />);
    expect(await screen.findByRole('button', { name: /Lime soda/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Settle tab' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to kitchen' })).not.toBeInTheDocument();
  });
  it('advances a kitchen ticket into preparing and rejects access without kitchen permission', async () => {
    const result = renderPage(<KitchenPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start ticket 60' }));
    await screen.findByRole('button', { name: 'Mark ready ticket 60' });
    expect(doubles.api.advance).toHaveBeenCalledTimes(1);
    result.unmount(); doubles.permissions = new Set(); doubles.api.tickets.mockClear();
    renderPage(<KitchenPage />);
    expect(screen.getByText('Kitchen access required')).toBeInTheDocument();
    expect(doubles.api.tickets).not.toHaveBeenCalled();
  });
  it('lets the owner switch menu availability but hides editing from bar staff', async () => {
    const result = renderPage(<BarMenuSettings />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Lime soda available' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Lime soda available' })).not.toBeChecked());
    expect(doubles.api.updateMenu).toHaveBeenCalledTimes(1);
    result.unmount(); doubles.permissions = new Set(['bar:read', 'bar:manage']);
    renderPage(<BarMenuSettings />);
    expect(await screen.findByRole('switch', { name: 'Lime soda available' })).toBeDisabled();
  });
});

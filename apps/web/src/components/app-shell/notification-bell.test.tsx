import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createNotificationMock } from '@/lib/notification-api';
import { NotificationBell } from './notification-bell';
const doubles = vi.hoisted(() => ({ push: vi.fn(), api: { list: vi.fn(), count: vi.fn(), read: vi.fn(), readAll: vi.fn() } }));
vi.mock('@/lib/notification-api', async (original) => ({ ...(await original<object>()), notificationApi: doubles.api }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: () => true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: doubles.push }) }));
describe('Notification bell', () => {
  it('opens by keyboard, marks a notification read, changes the badge and navigates locally', async () => {
    const state = createNotificationMock();
    doubles.api.list.mockImplementation((_scope, params) => Promise.resolve(state.list(params)));
    doubles.api.count.mockImplementation(() => Promise.resolve(state.count()));
    doubles.api.read.mockImplementation((_scope, id) => Promise.resolve(state.read(id)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
    await screen.findByLabelText('4 unread');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Notifications' }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Tennis balls are running low'));
    await waitFor(() => expect(doubles.push).toHaveBeenCalledWith('/inventory'));
    await screen.findByLabelText('3 unread');
    expect(doubles.api.read).toHaveBeenCalledTimes(1);
  });
});

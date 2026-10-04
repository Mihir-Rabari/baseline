import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBarMock } from './mock-bar';
import { createNotificationMock } from './notification-api';
const transport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ USE_MOCKS: false, fetchApi: transport, mock: (data: unknown) => Promise.resolve(data) }));
import { barApi } from './bar-api';
import { notificationApi } from './notification-api';

beforeEach(() => transport.mockReset());
describe('Bar real transport', () => {
  it('uses versioned URLs, encoded IDs and exact mutation bodies', async () => {
    const state = createBarMock();
    const tab = state.getTab(state.listTables()[0].openTab!.id);
    const id = 'tab/with?characters';
    transport.mockResolvedValue(tab);
    await barApi.tab(id);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs/tab%2Fwith%3Fcharacters');
    const data = { menuItemId: state.menu()[0].id, qty: 1 };
    await barApi.add(id, data);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs/tab%2Fwith%3Fcharacters/items', { method: 'POST', body: JSON.stringify(data) });
    await barApi.remove(id, 'item/one');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs/tab%2Fwith%3Fcharacters/items/item%2Fone', { method: 'DELETE' });
    const opened = { tableId: state.listTables()[1].id, guestName: 'Guest' };
    await barApi.open(opened);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs', { method: 'POST', body: JSON.stringify(opened) });
    transport.mockResolvedValue({ tab, tickets: [] });
    await barApi.send(id);
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs/tab%2Fwith%3Fcharacters/send', { method: 'POST', body: '{}' });
  });
  it('reads tables, menu, kitchen and earnings through the same versioned gateway', async () => {
    const state = createBarMock();
    transport.mockResolvedValue(state.listTables()); await barApi.tables();
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tables');
    transport.mockResolvedValue(state.menu()); await barApi.menu();
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/menu');
    const item = state.menu()[0]; transport.mockResolvedValue(item); await barApi.updateMenu(item.id, { isAvailable: false });
    expect(transport).toHaveBeenLastCalledWith(`/api/v1/bar/menu/${item.id}`, { method: 'PUT', body: '{"isAvailable":false}' });
    transport.mockResolvedValue(state.tickets()); await barApi.tickets();
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tickets');
    const ticket = state.tickets()[0]; transport.mockResolvedValue(ticket); await barApi.advance(ticket.id, { status: 'PREPARING' });
    expect(transport).toHaveBeenLastCalledWith(`/api/v1/bar/tickets/${ticket.id}/status`, { method: 'PATCH', body: '{"status":"PREPARING"}' });
    transport.mockResolvedValue(state.earnings('2026-10-03')); await barApi.earnings('2026-10-03');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/earnings?date=2026-10-03');
  });
  it('propagates server rejection and rejects malformed success data', async () => {
    transport.mockRejectedValue(new Error('ALREADY_SETTLED'));
    await expect(barApi.settle('id', { payments: [{ method: 'UPI' }] })).rejects.toThrow('ALREADY_SETTLED');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/bar/tabs/id/settle', { method: 'POST', body: '{"payments":[{"method":"UPI"}]}' });
    transport.mockResolvedValue({ status: 'SETTLED' });
    await expect(barApi.tab('id')).rejects.toThrow();
  });
});
describe('Notification real transport', () => {
  it('does not send mock user scope to the server and uses self-session routes', async () => {
    const state = createNotificationMock();
    transport.mockResolvedValue(state.list()); await notificationApi.list('mock-user-only', { limit: 8, page: 1 });
    expect(transport).toHaveBeenLastCalledWith('/api/v1/notifications?limit=8&page=1');
    transport.mockResolvedValue(state.count()); await notificationApi.count('mock-user-only');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/notifications/unread-count');
    transport.mockResolvedValue(state.list().data[0]); await notificationApi.read('mock-user-only', 'id/one');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/notifications/id%2Fone/read', { method: 'POST' });
    transport.mockResolvedValue({ updated: 4 }); await notificationApi.readAll('mock-user-only');
    expect(transport).toHaveBeenLastCalledWith('/api/v1/notifications/read-all', { method: 'POST' });
  });
});

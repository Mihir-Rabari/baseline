import { describe, expect, it } from 'vitest';
import { BarTableListSchema, TabSchema, SendTabResponseSchema, SettleTabResponseSchema, TicketListSchema, BarEarningsSchema } from '@packages/validation';
import { createBarMock, clubToday } from './mock-bar';
import { mockMemberStore } from './mock-members';
import plans from '@/mocks/plans.json';

describe('Bar mock workflow', () => {
  it('opens a free table, adds discounted items, sends per station, settles by UPI and frees the table', () => {
    const state = createBarMock();
    const table = state.listTables().find((row) => row.status === 'FREE')!;
    const member = mockMemberStore.find((row) => row.membership?.status === 'ACTIVE' && row.membership.expiryState !== 'EXPIRED')!;
    const discount = plans.find((plan) => plan.code === member.membership?.plan.code)!.barDiscountPct;
    const tab = state.openTab({ tableId: table.id, memberId: member.id });
    expect(TabSchema.safeParse(tab).success).toBe(true);
    expect(state.listTables().find((row) => row.id === table.id)?.status).toBe('OCCUPIED');
    const drink = state.menu().find((item) => item.station === 'BAR')!;
    const food = state.menu().find((item) => item.station === 'KITCHEN')!;
    state.addItem(tab.id, { menuItemId: drink.id, qty: 2 });
    const updated = state.addItem(tab.id, { menuItemId: food.id, qty: 1, note: 'No chilli' });
    expect(updated.totalPaise).toBe(Math.round(drink.pricePaise * (100 - discount) / 100) * 2 + Math.round(food.pricePaise * (100 - discount) / 100));
    expect(updated.discountPaise).toBe(updated.subtotalPaise - updated.totalPaise);
    const sent = state.send(tab.id);
    expect(SendTabResponseSchema.safeParse(sent).success).toBe(true);
    expect(sent.tickets).toHaveLength(2);
    expect(sent.tab.items.every((item) => item.status === 'SENT')).toBe(true);
    expect(() => state.send(tab.id)).toThrow('no pending');
    const settled = state.settle(tab.id, { payments: [{ method: 'UPI' }] });
    expect(SettleTabResponseSchema.safeParse(settled).success).toBe(true);
    expect(settled.payments[0]).toMatchObject({ method: 'UPI', amountPaise: updated.totalPaise });
    expect(state.listTables().find((row) => row.id === table.id)?.status).toBe('FREE');
    expect(BarTableListSchema.safeParse(state.listTables()).success).toBe(true);
    const earnings = state.earnings(clubToday());
    expect(BarEarningsSchema.safeParse(earnings).success).toBe(true);
    expect(earnings.totalPaise).toBe(updated.totalPaise);
    expect(earnings.tabsSettled).toBe(1);
    expect(earnings.byMethod.find((row) => row.method === 'UPI')?.amountPaise).toBe(updated.totalPaise);
    expect(earnings.topItems.reduce((sum, item) => sum + item.amountPaise, 0)).toBe(updated.totalPaise);
    expect(() => state.settle(tab.id, { payments: [{ method: 'UPI' }] })).toThrow('already closed');
    expect(() => state.addItem(tab.id, { menuItemId: food.id, qty: 1 })).toThrow('already closed');
  });

  it('rejects occupied tables, unavailable items and mismatched payments without closing the tab', () => {
    const state = createBarMock();
    const table = state.listTables()[0];
    expect(() => state.openTab({ tableId: table.id, guestName: 'Another guest' })).toThrow('open tab');
    const tab = state.openTab({ tableId: state.listTables()[1].id, guestName: 'Guest' });
    const item = state.menu()[0];
    state.updateMenu(item.id, { isAvailable: false });
    expect(() => state.addItem(tab.id, { menuItemId: item.id, qty: 1 })).toThrow('no longer available');
    state.updateMenu(item.id, { isAvailable: true });
    const added = state.addItem(tab.id, { menuItemId: item.id, qty: 1 });
    expect(() => state.settle(tab.id, { payments: [{ method: 'CASH', amountPaise: 1 }] })).toThrow('equal');
    expect(state.getTab(tab.id).status).toBe('OPEN');
    const removed = state.removeItem(tab.id, added.items[0].id);
    expect(removed.totalPaise).toBe(0);
    expect(() => state.settle(tab.id, { payments: [{ method: 'CASH' }] })).toThrow('Add an item');
  });

  it('moves tickets through columns, rejects stale transitions and removes served tickets', () => {
    const state = createBarMock();
    const ticket = state.tickets().find((row) => row.status === 'NEW')!;
    state.updateTicket(ticket.id, { status: 'PREPARING' });
    expect(() => state.updateTicket(ticket.id, { status: 'PREPARING' })).toThrow('already changed');
    state.updateTicket(ticket.id, { status: 'READY' });
    expect(state.tickets().find((row) => row.id === ticket.id)?.status).toBe('READY');
    state.updateTicket(ticket.id, { status: 'SERVED' });
    expect(state.tickets().some((row) => row.id === ticket.id)).toBe(false);
    expect(TicketListSchema.safeParse(state.tickets()).success).toBe(true);
  });

  it('returns detached values so consumers cannot change totals or close a tab', () => {
    const state = createBarMock();
    const tab = state.getTab(state.listTables()[0].openTab!.id);
    tab.status = 'SETTLED'; tab.totalPaise = -1;
    expect(state.getTab(tab.id).status).toBe('OPEN');
    expect(state.getTab(tab.id).totalPaise).toBe(0);
  });
});

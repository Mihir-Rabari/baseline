import {
  BarTableListSchema, MenuItemListSchema, TabSchema, TicketListSchema,
  OpenTabRequestSchema, AddTabItemRequestSchema, SettleTabRequestSchema,
  type Tab, type Ticket, type OpenTabRequest, type AddTabItemRequest, type SettleTabRequest,
  type SettleTabResponse, type SendTabResponse, type UpdateTicketStatusRequest, type BarEarnings,
  type UpdateMenuItemRequest,
} from '@packages/validation';
import tablesFixture from '@/mocks/bar-tables.json';
import menuFixture from '@/mocks/bar-menu.json';
import tabFixture from '@/mocks/bar-tab.json';
import ticketsFixture from '@/mocks/bar-tickets.json';
import { mockMemberStore } from '@/lib/mock-members';
import plans from '@/mocks/plans.json';

const copy = <T,>(value: T): T => structuredClone(value);
export class BarMockError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const clubToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

/** One state machine for floor, tabs, kitchen and takings; factory keeps tests isolated. */
export function createBarMock() {
  const tables = BarTableListSchema.parse(tablesFixture);
  const menu = MenuItemListSchema.parse(menuFixture);
  const tabs = new Map<string, Tab>([[tabFixture.id, TabSchema.parse(tabFixture)]]);
  const tickets = TicketListSchema.parse(ticketsFixture);
  const receipts: Array<{ tab: Tab; payments: SettleTabResponse['payments'] }> = [];
  let tabNumber = 42;
  let ticketNumber = 65;
  const get = (id: string) => {
    const tab = tabs.get(id);
    if (!tab) throw new BarMockError('NOT_FOUND', 'This tab was not found.');
    return tab;
  };
  const open = (id: string) => {
    const tab = get(id);
    if (tab.status !== 'OPEN') throw new BarMockError('ALREADY_SETTLED', 'This tab is already closed. Refresh to see the receipt.');
    return tab;
  };
  const totals = (tab: Tab) => {
    const items = tab.items.filter((item) => item.status !== 'VOID');
    tab.subtotalPaise = items.reduce((sum, item) => sum + item.qty * item.unitPricePaise, 0);
    tab.totalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    tab.discountPaise = tab.subtotalPaise - tab.totalPaise;
    return copy(tab);
  };
  return {
    listTables() {
      return copy(tables.map((table) => {
        const tab = [...tabs.values()].find((item) => item.table?.id === table.id && item.status === 'OPEN');
        return { ...table, status: tab ? 'OCCUPIED' as const : 'FREE' as const, openTab: tab ? {
          id: tab.id, tabNumber: tab.tabNumber, label: tab.member?.fullName ?? tab.guestName ?? 'Walk-in',
          totalPaise: tab.totalPaise, openedAt: tab.openedAt,
        } : null };
      }));
    },
    menu: () => copy(menu),
    updateMenu(id: string, data: UpdateMenuItemRequest) {
      const item = menu.find((row) => row.id === id);
      if (!item) throw new BarMockError('NOT_FOUND', 'This menu item was not found.');
      Object.assign(item, data);
      return copy(item);
    },
    getTab: (id: string) => copy(get(id)),
    openTab(input: OpenTabRequest) {
      const data = OpenTabRequestSchema.parse(input);
      const table = data.tableId ? tables.find((item) => item.id === data.tableId) : undefined;
      if (data.tableId && !table) throw new BarMockError('NOT_FOUND', 'This table was not found.');
      if (data.tableId && [...tabs.values()].some((item) => item.table?.id === data.tableId && item.status === 'OPEN')) {
        throw new BarMockError('TABLE_OCCUPIED', 'This table now has an open tab. Refresh the floor.');
      }
      const member = data.memberId ? mockMemberStore.find((item) => item.id === data.memberId) : undefined;
      if (data.memberId && !member) throw new BarMockError('NOT_FOUND', 'This member was not found.');
      const tab: Tab = {
        id: crypto.randomUUID(), tabNumber: ++tabNumber, status: 'OPEN',
        table: table ? { id: table.id, name: table.name } : null,
        member: member ? { id: member.id, fullName: member.fullName, memberCode: member.memberCode,
          barDiscountPct: member.membership?.status === 'ACTIVE' && member.membership.expiryState !== 'EXPIRED'
            ? plans.find((plan) => plan.code === member.membership?.plan.code)?.barDiscountPct ?? 0 : 0 } : null,
        guestName: member ? null : data.guestName ?? null, openedAt: new Date().toISOString(),
        items: [], subtotalPaise: 0, discountPaise: 0, totalPaise: 0, settledAt: null,
      };
      tabs.set(tab.id, tab);
      return copy(tab);
    },
    addItem(id: string, input: AddTabItemRequest) {
      const tab = open(id);
      const data = AddTabItemRequestSchema.parse(input);
      const item = menu.find((row) => row.id === data.menuItemId && row.isAvailable);
      if (!item) throw new BarMockError('ITEM_UNAVAILABLE', 'This menu item is no longer available.');
      const discountPct = item.discountable ? tab.member?.barDiscountPct ?? 0 : 0;
      tab.items.push({ id: crypto.randomUUID(), menuItemId: item.id, name: item.name, qty: data.qty,
        unitPricePaise: item.pricePaise, discountPct,
        lineTotalPaise: Math.round(item.pricePaise * (100 - discountPct) / 100) * data.qty,
        status: 'PENDING', ticketId: null, note: data.note ?? null });
      return totals(tab);
    },
    removeItem(id: string, itemId: string) {
      const tab = open(id);
      const item = tab.items.find((row) => row.id === itemId);
      if (!item) throw new BarMockError('NOT_FOUND', 'This item was not found.');
      if (item.status !== 'PENDING') throw new BarMockError('ITEM_ALREADY_SENT', 'Sent items cannot be removed here. Ask the owner to void them.');
      item.status = 'VOID';
      return totals(tab);
    },
    send(id: string): SendTabResponse {
      const tab = open(id);
      const pending = tab.items.filter((item) => item.status === 'PENDING');
      if (!pending.length) throw new BarMockError('NOTHING_TO_SEND', 'There are no pending items to send.');
      const newTickets: SendTabResponse['tickets'] = [];
      for (const station of ['BAR', 'KITCHEN']) {
        const items = pending.filter((item) => menu.find((row) => row.id === item.menuItemId)?.station === station);
        if (!items.length) continue;
        const ticket: Ticket = { id: crypto.randomUUID(), ticketNumber: ++ticketNumber,
          tab: { id: tab.id, tabNumber: tab.tabNumber, label: tab.member?.fullName ?? tab.guestName ?? 'Walk-in' },
          table: tab.table ? { name: tab.table.name } : null, station, status: 'NEW',
          createdAt: new Date().toISOString(), minutesWaiting: 0,
          items: items.map(({ name, qty, note }) => ({ name, qty, note })) };
        tickets.push(ticket);
        items.forEach((item) => { item.status = 'SENT'; item.ticketId = ticket.id; });
        newTickets.push({ id: ticket.id, station, status: 'NEW', itemCount: items.length });
      }
      return { tab: copy(tab), tickets: newTickets };
    },
    settle(id: string, input: SettleTabRequest): SettleTabResponse {
      const tab = open(id);
      const data = SettleTabRequestSchema.parse(input);
      if (tab.totalPaise <= 0) throw new BarMockError('EMPTY_TAB', 'Add an item before settling this tab.');
      const payments = data.payments.map((payment) => ({ id: crypto.randomUUID(), method: payment.method,
        amountPaise: payment.amountPaise ?? (data.payments.length === 1 ? tab.totalPaise : 0) }));
      if (payments.reduce((sum, item) => sum + item.amountPaise, 0) !== tab.totalPaise) {
        throw new BarMockError('PAYMENT_MISMATCH', 'Payments must equal the tab total.');
      }
      tab.status = 'SETTLED'; tab.settledAt = new Date().toISOString();
      receipts.push({ tab: copy(tab), payments: copy(payments) });
      return { tab: copy(tab), payments, receipt: { tabNumber: tab.tabNumber,
        totalPaise: tab.totalPaise, discountPaise: tab.discountPaise, paidAt: tab.settledAt } };
    },
    tickets: () => copy(tickets.filter((item) => !['SERVED', 'CANCELLED'].includes(item.status)).map((item) => ({ ...item, minutesWaiting: minutesSince(item.createdAt) }))),
    updateTicket(id: string, input: UpdateTicketStatusRequest) {
      const ticket = tickets.find((item) => item.id === id);
      if (!ticket) throw new BarMockError('NOT_FOUND', 'This ticket was not found.');
      const next = { NEW: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
      if (next[ticket.status as keyof typeof next] !== input.status) throw new BarMockError('INVALID_TICKET_TRANSITION', 'This ticket has already changed. Refresh the board.');
      ticket.status = input.status;
      return copy(ticket);
    },
    earnings(date: string): BarEarnings {
      const rows = receipts.filter(({ tab }) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(tab.settledAt!)) === date);
      const totalPaise = rows.reduce((sum, row) => sum + row.tab.totalPaise, 0);
      const items = new Map<string, { name: string; qty: number; amountPaise: number }>();
      rows.forEach(({ tab }) => tab.items.filter((item) => item.status !== 'VOID').forEach((item) => {
        const previous = items.get(item.name) ?? { name: item.name, qty: 0, amountPaise: 0 };
        items.set(item.name, { name: item.name, qty: previous.qty + item.qty, amountPaise: previous.amountPaise + item.lineTotalPaise });
      }));
      return { date, totalPaise, tabsSettled: rows.length, averageTabPaise: rows.length ? Math.round(totalPaise / rows.length) : 0,
        byMethod: (['CASH', 'CARD', 'UPI'] as const).map((method) => ({ method,
          amountPaise: rows.flatMap((row) => row.payments).filter((payment) => payment.method === method).reduce((sum, item) => sum + item.amountPaise, 0) })),
        byShift: [], topItems: [...items.values()].sort((a, b) => b.qty - a.qty) };
    },
  };
}

export const barMock = createBarMock();

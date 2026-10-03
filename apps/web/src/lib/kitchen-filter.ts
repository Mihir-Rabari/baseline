import type { Ticket } from '@packages/validation';

export type StationFilter = 'ALL' | 'KITCHEN' | 'BAR';
export type StatusFilter = 'ALL' | 'NEW' | 'PREPARING' | 'READY';
export type TimeFilter = 'ALL' | 'UNDER_5' | '5_TO_10' | 'OVER_10';
export type ChannelFilter = 'ALL' | 'TABLE' | 'WALK_IN';

export interface KitchenFilters {
  query: string;
  station: StationFilter;
  status: StatusFilter;
  time: TimeFilter;
  channel: ChannelFilter;
}

export const DEFAULT_KITCHEN_FILTERS: KitchenFilters = {
  query: '',
  station: 'ALL',
  status: 'ALL',
  time: 'ALL',
  channel: 'ALL',
};

export const KITCHEN_STORAGE_KEY = 'bar:kitchen:filters:v1';

export function filterTickets(tickets: Ticket[], filters: KitchenFilters): Ticket[] {
  const q = filters.query.trim().toLowerCase();
  return tickets.filter((ticket) => {
    // Station filter
    if (filters.station !== 'ALL' && ticket.station !== filters.station) {
      return false;
    }
    // Status filter
    if (filters.status !== 'ALL' && ticket.status !== filters.status) {
      return false;
    }
    // Time filter
    if (filters.time === 'UNDER_5' && ticket.minutesWaiting >= 5) {
      return false;
    }
    if (filters.time === '5_TO_10' && (ticket.minutesWaiting < 5 || ticket.minutesWaiting >= 10)) {
      return false;
    }
    if (filters.time === 'OVER_10' && ticket.minutesWaiting < 10) {
      return false;
    }
    // Channel / Table filter
    if (filters.channel === 'TABLE' && !ticket.table) {
      return false;
    }
    if (filters.channel === 'WALK_IN' && ticket.table) {
      return false;
    }
    // Text search (ticket number, tab number, table, customer/guest, items, item notes)
    if (q) {
      const matchTicketNo = String(ticket.ticketNumber).includes(q) || `#${ticket.ticketNumber}`.includes(q);
      const matchTabNo = String(ticket.tab.tabNumber).includes(q) || `tab #${ticket.tab.tabNumber}`.toLowerCase().includes(q);
      const matchLabel = ticket.tab.label.toLowerCase().includes(q);
      const matchTable = ticket.table?.name.toLowerCase().includes(q) ?? false;
      const matchItems = ticket.items.some((item) =>
        item.name.toLowerCase().includes(q) || (item.note && item.note.toLowerCase().includes(q))
      );
      if (!matchTicketNo && !matchTabNo && !matchLabel && !matchTable && !matchItems) {
        return false;
      }
    }
    return true;
  });
}

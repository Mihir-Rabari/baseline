import {
  BarTableListSchema, MenuItemListSchema, MenuItemSchema, TabSchema, SendTabResponseSchema,
  SettleTabResponseSchema, TicketListSchema, TicketSchema, BarEarningsSchema,
  BarTableBookingListSchema, BarTableBookingSchema,
  type OpenTabRequest, type AddTabItemRequest, type SettleTabRequest, type UpdateTicketStatusRequest, type UpdateMenuItemRequest,
  type BarTableBookingListQuery, type CreateBarTableBookingRequest, type UpdateBarTableBookingRequest,
} from '@packages/validation';
import { fetchApi, USE_MOCKS, mock } from '@/lib/api-client';
import { barMock } from '@/lib/mock-bar';

const body = (data: unknown) => JSON.stringify(data);
export const barApi = {
  tables: async () => BarTableListSchema.parse(USE_MOCKS ? await mock(barMock.listTables()) : await fetchApi('/api/v1/bar/tables')),
  menu: async () => MenuItemListSchema.parse(USE_MOCKS ? await mock(barMock.menu()) : await fetchApi('/api/v1/bar/menu')),
  updateMenu: async (id: string, data: UpdateMenuItemRequest) => MenuItemSchema.parse(USE_MOCKS ? await mock(barMock.updateMenu(id, data)) : await fetchApi(`/api/v1/bar/menu/${encodeURIComponent(id)}`, { method: 'PUT', body: body(data) })),
  tab: async (id: string) => TabSchema.parse(USE_MOCKS ? await mock(barMock.getTab(id)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}`)),
  open: async (data: OpenTabRequest) => TabSchema.parse(USE_MOCKS ? await mock(barMock.openTab(data)) : await fetchApi('/api/v1/bar/tabs', { method: 'POST', body: body(data) })),
  add: async (id: string, data: AddTabItemRequest) => TabSchema.parse(USE_MOCKS ? await mock(barMock.addItem(id, data)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/items`, { method: 'POST', body: body(data) })),
  remove: async (id: string, itemId: string) => TabSchema.parse(USE_MOCKS ? await mock(barMock.removeItem(id, itemId)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })),
  send: async (id: string) => SendTabResponseSchema.parse(USE_MOCKS ? await mock(barMock.send(id)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/send`, { method: 'POST', body: '{}' })),
  settle: async (id: string, data: SettleTabRequest) => SettleTabResponseSchema.parse(USE_MOCKS ? await mock(barMock.settle(id, data)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/settle`, { method: 'POST', body: body(data) })),
  tickets: async () => TicketListSchema.parse(USE_MOCKS ? await mock(barMock.tickets()) : await fetchApi('/api/v1/bar/tickets')),
  advance: async (id: string, data: UpdateTicketStatusRequest) => TicketSchema.parse(USE_MOCKS ? await mock(barMock.updateTicket(id, data)) : await fetchApi(`/api/v1/bar/tickets/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: body(data) })),
  earnings: async (date: string) => BarEarningsSchema.parse(USE_MOCKS ? await mock(barMock.earnings(date)) : await fetchApi(`/api/v1/bar/earnings?date=${encodeURIComponent(date)}`)),
  bookings: async (query?: BarTableBookingListQuery) => {
    if (USE_MOCKS) return BarTableBookingListSchema.parse(await mock(barMock.listBookings(query)));
    const params = new URLSearchParams();
    if (query?.date) params.set('date', query.date);
    if (query?.from) params.set('from', query.from);
    if (query?.to) params.set('to', query.to);
    if (query?.tableId) params.set('tableId', query.tableId);
    if (query?.status) params.set('status', query.status);
    const qStr = params.toString() ? `?${params.toString()}` : '';
    return BarTableBookingListSchema.parse(await fetchApi(`/api/v1/bar/bookings${qStr}`));
  },
  booking: async (id: string) => {
    if (USE_MOCKS) return BarTableBookingSchema.parse(await mock(barMock.getBooking(id)));
    return BarTableBookingSchema.parse(await fetchApi(`/api/v1/bar/bookings/${encodeURIComponent(id)}`));
  },
  createBooking: async (data: CreateBarTableBookingRequest) => {
    if (USE_MOCKS) return BarTableBookingSchema.parse(await mock(barMock.createBooking(data)));
    return BarTableBookingSchema.parse(await fetchApi('/api/v1/bar/bookings', { method: 'POST', body: body(data) }));
  },
  updateBooking: async (id: string, data: UpdateBarTableBookingRequest) => {
    if (USE_MOCKS) return BarTableBookingSchema.parse(await mock(barMock.updateBooking(id, data)));
    return BarTableBookingSchema.parse(await fetchApi(`/api/v1/bar/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: body(data) }));
  },
  cancelBooking: async (id: string, reason?: string) => {
    if (USE_MOCKS) return BarTableBookingSchema.parse(await mock(barMock.cancelBooking(id, reason)));
    return BarTableBookingSchema.parse(await fetchApi(`/api/v1/bar/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: body({ reason }) }));
  },
  seatBooking: async (id: string) => {
    if (USE_MOCKS) return BarTableBookingSchema.parse(await mock(barMock.seatBooking(id)));
    return BarTableBookingSchema.parse(await fetchApi(`/api/v1/bar/bookings/${encodeURIComponent(id)}/seat`, { method: 'POST', body: '{}' }));
  },
  checkConflict: (tableId: string, startsAt: string, endsAt: string, excludeId?: string) => {
    return barMock.checkBookingConflict(tableId, startsAt, endsAt, excludeId);
  },
};


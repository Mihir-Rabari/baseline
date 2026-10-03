import {
  BarTableListSchema, MenuItemListSchema, MenuItemSchema, TabSchema, SendTabResponseSchema,
  SettleTabResponseSchema, TicketListSchema, TicketSchema, BarEarningsSchema,
  type OpenTabRequest, type AddTabItemRequest, type SettleTabRequest, type UpdateTicketStatusRequest, type UpdateMenuItemRequest,
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
  send: async (id: string) => SendTabResponseSchema.parse(USE_MOCKS ? await mock(barMock.send(id)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/send`, { method: 'POST' })),
  settle: async (id: string, data: SettleTabRequest) => SettleTabResponseSchema.parse(USE_MOCKS ? await mock(barMock.settle(id, data)) : await fetchApi(`/api/v1/bar/tabs/${encodeURIComponent(id)}/settle`, { method: 'POST', body: body(data) })),
  tickets: async () => TicketListSchema.parse(USE_MOCKS ? await mock(barMock.tickets()) : await fetchApi('/api/v1/bar/tickets')),
  advance: async (id: string, data: UpdateTicketStatusRequest) => TicketSchema.parse(USE_MOCKS ? await mock(barMock.updateTicket(id, data)) : await fetchApi(`/api/v1/bar/tickets/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: body(data) })),
  earnings: async (date: string) => BarEarningsSchema.parse(USE_MOCKS ? await mock(barMock.earnings(date)) : await fetchApi(`/api/v1/bar/earnings?date=${encodeURIComponent(date)}`)),
};


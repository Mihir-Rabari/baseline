import {
  EmployeeListSchema, EmployeeSchema, ShiftListSchema, ShiftSchema, CurrentShiftSchema,
  LeaveRequestPageSchema, LeaveRequestSchema, MyLeavePageSchema, PayrollSummarySchema, SuccessMessageSchema,
  type CreateEmployeeRequest, type UpdateEmployeeRequest, type CreateShiftRequest, type ShiftListQuery,
  type CreateLeaveRequest, type LeaveDecisionRequest, type LeaveStatus,
} from '@packages/validation';
import { fetchApi, USE_MOCKS, mock } from '@/lib/api-client';
import { hrMock } from '@/lib/mock-hr';

const json = (data: unknown) => JSON.stringify(data);
export const hrApi = {
  employees: async () => EmployeeListSchema.parse(USE_MOCKS ? await mock(hrMock.employees()) : await fetchApi('/api/v1/hr/employees')),
  createEmployee: async (data: CreateEmployeeRequest) => EmployeeSchema.parse(USE_MOCKS ? await mock(hrMock.createEmployee(data)) : await fetchApi('/api/v1/hr/employees', { method: 'POST', body: json(data) })),
  updateEmployee: async (id: string, data: UpdateEmployeeRequest) => EmployeeSchema.parse(USE_MOCKS ? await mock(hrMock.updateEmployee(id, data)) : await fetchApi(`/api/v1/hr/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: json(data) })),
  shifts: async (params: ShiftListQuery = {}, own = false) => {
    const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
    return ShiftListSchema.parse(USE_MOCKS ? await mock(hrMock.shifts(params, own)) : await fetchApi(`/api/v1/shifts?${query}`));
  },
  createShift: async (data: CreateShiftRequest) => ShiftSchema.parse(USE_MOCKS ? await mock(hrMock.createShift(data)) : await fetchApi('/api/v1/shifts', { method: 'POST', body: json(data) })),
  deleteShift: async (id: string) => SuccessMessageSchema.parse(USE_MOCKS ? await mock(hrMock.deleteShift(id)) : await fetchApi(`/api/v1/shifts/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  currentShift: async () => CurrentShiftSchema.parse(USE_MOCKS ? await mock(hrMock.currentShift()) : await fetchApi('/api/v1/me/shift/current')),
  clockIn: async (id: string) => ShiftSchema.parse(USE_MOCKS ? await mock(hrMock.clock(id)) : await fetchApi(`/api/v1/shifts/${encodeURIComponent(id)}/clock-in`, { method: 'POST' })),
  clockOut: async (id: string) => ShiftSchema.parse(USE_MOCKS ? await mock(hrMock.clock(id, true)) : await fetchApi(`/api/v1/shifts/${encodeURIComponent(id)}/clock-out`, { method: 'POST' })),
  leave: async (page = 1, own = false, status?: LeaveStatus) => (own ? MyLeavePageSchema : LeaveRequestPageSchema).parse(USE_MOCKS ? await mock(hrMock.leave(page, own, status)) : await fetchApi(`/api/v1/${own ? 'me' : 'hr'}/leave?page=${page}&limit=20${status ? `&status=${status}` : ''}`)),
  requestLeave: async (data: CreateLeaveRequest) => LeaveRequestSchema.parse(USE_MOCKS ? await mock(hrMock.requestLeave(data)) : await fetchApi('/api/v1/me/leave', { method: 'POST', body: json(data) })),
  decide: async (id: string, data: LeaveDecisionRequest) => LeaveRequestSchema.parse(USE_MOCKS ? await mock(hrMock.decide(id, data)) : await fetchApi(`/api/v1/hr/leave/${encodeURIComponent(id)}/decision`, { method: 'POST', body: json(data) })),
  payroll: async (month: string) => PayrollSummarySchema.parse(USE_MOCKS ? await mock(hrMock.payroll(month)) : await fetchApi(`/api/v1/hr/payroll-summary?month=${encodeURIComponent(month)}`)),
};

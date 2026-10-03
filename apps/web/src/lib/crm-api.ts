import { LeadDetailSchema, LeadPageSchema, CrmSummarySchema, LeadListQuerySchema, UpdateLeadRequestSchema, CreateLeadActivityRequestSchema, CreateQuoteRequestSchema, ConvertLeadRequestSchema, type LeadStatus, type LeadListQuery, type LeadDetail, type UpdateLeadRequest, type CreateLeadActivityRequest, type CreateQuoteRequest, type ConvertLeadRequest, type ConvertLeadResponse, type Quote } from '@packages/validation';
import { ApiError, fetchApi, mock, USE_MOCKS } from './api-client';
import plans from '@/mocks/plans.json';
import { mockCreateMember } from './mock-member-operations';
import { clubToday, memberFormSchema } from './member-form';
export function crmFollowUpDate(value: string | null): string { return value ? clubToday(new Date(value)) : ''; }
export function quoteDefaultDate() { const date = new Date(`${clubToday()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 14); return date.toISOString().slice(0, 10); }
const statuses: LeadStatus[] = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'];
const store: LeadDetail[] = Array.from({ length: 8 }, (_, i) => LeadDetailSchema.parse({
  lead: { id: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: ['Riya Kapoor', 'Dev Shah', 'Aanya Patel', 'Kabir Mehta', 'Isha Rao', 'Jay Desai', 'Mira Joshi', 'Om Shah'][i], phone: `98765432${String(i).padStart(2, '0')}`, email: null,
    source: i % 2 ? 'WALK_IN' : 'WEBSITE_ENQUIRY', status: statuses[i % 5], interestedPlan: { id: plans[0].id, code: plans[0].code, name: plans[0].name }, message: 'Interested in membership', assignedTo: null,
    nextFollowUpAt: `${clubToday()}T09:00:00+05:30`, memberId: null, createdAt: new Date().toISOString() }, activities: [], quotes: [] }));
function detail(id: string) { const item = store.find(item => item.lead.id === id); if (!item) throw new ApiError('Lead not found', 404, 'LEAD_NOT_FOUND'); return item; }
function queryString(query: Record<string, unknown>) { const search = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value)); return search.toString(); }
export const crmApi = {
  list: (query: Partial<LeadListQuery>) => {
    query = LeadListQuerySchema.parse(query);
    if (!USE_MOCKS) return fetchApi<ReturnType<typeof LeadPageSchema.parse>>(`/api/v1/crm/leads?${queryString(query)}`);
    const filtered = store.filter(item => (!query.status || item.lead.status === query.status) && (!query.source || item.lead.source === query.source) && (!query.q || `${item.lead.name} ${item.lead.phone ?? ''} ${item.lead.email ?? ''}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.assignedTo || item.lead.assignedTo?.id === query.assignedTo) && (query.dueToday !== 'true' || (!['WON','LOST'].includes(item.lead.status) && crmFollowUpDate(item.lead.nextFollowUpAt) === clubToday())));
    const page = query.page ?? 1, limit = query.limit ?? 20;
    return mock(LeadPageSchema.parse({ data: filtered.slice((page - 1) * limit, page * limit).map(item => ({ ...item.lead, quoteCount: item.quotes.length })), meta: { page, limit, totalItems: filtered.length, totalPages: Math.ceil(filtered.length / limit), hasNextPage: page * limit < filtered.length, hasPrevPage: page > 1 } }));
  },
  summary: () => {
    if (!USE_MOCKS) return fetchApi<ReturnType<typeof CrmSummarySchema.parse>>('/api/v1/crm/summary');
    const active = store.filter(item => !['WON','LOST'].includes(item.lead.status) && item.lead.nextFollowUpAt);
    return mock(CrmSummarySchema.parse({ byStatus: Object.fromEntries(statuses.map(status => [status, store.filter(item => item.lead.status === status).length])), dueToday: active.filter(item => crmFollowUpDate(item.lead.nextFollowUpAt) === clubToday()).length, overdue: active.filter(item => crmFollowUpDate(item.lead.nextFollowUpAt) < clubToday()).length, conversionRatePct: store.filter(item => item.lead.status === 'WON').length / store.length * 100 }));
  },
  detail: (id: string) => USE_MOCKS ? mock(structuredClone(detail(id))) : fetchApi<LeadDetail>(`/api/v1/crm/leads/${encodeURIComponent(id)}`),
  update: async (id: string, data: UpdateLeadRequest) => {
    data = UpdateLeadRequestSchema.parse(data);
    if (!USE_MOCKS) return fetchApi(`/api/v1/crm/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
    const item = detail(id); if (item.lead.status === 'WON') throw new ApiError('Lead is already a member',409,'ALREADY_CONVERTED');
    if(data.assignedTo) throw new ApiError('Assignee not found',404,'NOT_FOUND');
    if(data.assignedTo === null) item.lead.assignedTo = null;
    if(data.status) item.lead.status=data.status;
    if(data.nextFollowUpAt !== undefined) item.lead.nextFollowUpAt=data.nextFollowUpAt;
    item.activities.unshift({id:crypto.randomUUID(),type:'STATUS_CHANGE',body:data.status ?? 'Follow-up updated',actor:null,createdAt:new Date().toISOString()});
    return mock(structuredClone(item.lead));
  },
  note: async (id: string, data: CreateLeadActivityRequest) => {
    data = CreateLeadActivityRequestSchema.parse(data);
    if (!USE_MOCKS) return fetchApi(`/api/v1/crm/leads/${encodeURIComponent(id)}/activities`, { method: 'POST', body: JSON.stringify(data) });
    const note = { id: crypto.randomUUID(), ...data, actor: null, createdAt: new Date().toISOString() }; detail(id).activities.unshift(note); return mock(note);
  },
  quote: async (id: string, data: CreateQuoteRequest) => {
    data = CreateQuoteRequestSchema.parse(data);
    if (!USE_MOCKS) return fetchApi<Quote>(`/api/v1/crm/leads/${encodeURIComponent(id)}/quotes`, { method: 'POST', body: JSON.stringify(data) });
    const plan = plans.find(item => item.id === data.planId && item.isActive); if (!plan) throw new ApiError('Plan not found', 404, 'PLAN_NOT_FOUND');
    const quote: Quote = { id: crypto.randomUUID(), leadId: id, plan: { id: plan.id, name: plan.name, code: plan.code }, amountPaise: data.amountPaise ?? plan.monthlyFeePaise, validUntil: data.validUntil ?? quoteDefaultDate(), status: 'DRAFT', notes: data.notes ?? null, createdAt: new Date().toISOString() }; detail(id).quotes.push(quote); return mock(structuredClone(quote));
  },
  sendQuote: async (id: string) => {
    if (!USE_MOCKS) return fetchApi<Quote>(`/api/v1/crm/quotes/${encodeURIComponent(id)}/send`, { method: 'POST', body: '{}' });
    const quote = store.flatMap(item => item.quotes).find(item => item.id === id); if (!quote) throw new ApiError('Quote not found', 404);
    if(quote.status !== 'DRAFT' || quote.validUntil < clubToday()) throw new ApiError('Quote cannot be sent',409,'QUOTE_STATE_INVALID');
    const lead=detail(quote.leadId);if(lead.lead.status==='WON')throw new ApiError('Lead is already a member',409,'ALREADY_CONVERTED');
    quote.status='SENT';lead.lead.status='QUOTED';lead.activities.unshift({id:crypto.randomUUID(),type:'QUOTE_SENT',body:'Quote sent',actor:null,createdAt:new Date().toISOString()});
    return mock(structuredClone(quote));
  },
  convert: async (id: string, data: ConvertLeadRequest): Promise<ConvertLeadResponse> => {
    data = ConvertLeadRequestSchema.parse(data);
    if (!USE_MOCKS) return fetchApi(`/api/v1/crm/leads/${encodeURIComponent(id)}/convert`, { method: 'POST', body: JSON.stringify(data) });
    const item = detail(id); if (item.lead.status === 'WON' || item.lead.memberId) throw new ApiError('Lead is already a member', 409, 'ALREADY_CONVERTED');
    if(data.quoteId){const quote=item.quotes.find(value=>value.id===data.quoteId&&value.plan.id===data.planId);if(!quote||quote.status!=='ACCEPTED'||quote.validUntil<clubToday())throw new ApiError('Quote is not valid for conversion',422,'QUOTE_INVALID');}
    const phone = data.phone ?? item.lead.phone; if (!phone) throw new ApiError('Add a phone number to register the member', 422);
    const validated=memberFormSchema(plans).safeParse({...data,fullName:item.lead.name,phone,email:item.lead.email ?? undefined});
    if(!validated.success)throw new ApiError(validated.error.issues[0].message,422,data.planId===plans.find(value=>value.code==='JUNIOR')?.id?'JUNIOR_AGE_INVALID':'INVALID_MEMBER');
    const result = mockCreateMember({...validated.data,startsOn:data.startsOn});
    if (!result) throw new ApiError('Plan not found', 404);
    item.lead.status = 'WON'; item.lead.memberId = result.member.id;item.activities.unshift({id:crypto.randomUUID(),type:'CONVERTED',body:'Converted to member',actor:null,createdAt:new Date().toISOString()});return mock({ ...result, lead: structuredClone(item.lead) });
  },
};

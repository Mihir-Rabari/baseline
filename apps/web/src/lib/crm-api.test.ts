import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConvertLeadResponseSchema, LeadDetailSchema, LeadPageSchema } from '@packages/validation';
import plans from '@/mocks/plans.json';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('CRM contract workflows', () => {
  it('filters leads, records notes and quotes, sends and converts once', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true'); const { crmApi } = await import('./crm-api');
    const list = LeadPageSchema.parse(await crmApi.list({ status: 'NEW' })); const id = list.data[0].id;
    expect(list.data.every(item => item.status === 'NEW')).toBe(true);
    await crmApi.note(id, { type: 'NOTE', body: 'Called and agreed to join' });
    const quote = await crmApi.quote(id, { planId: plans[0].id, amountPaise: 120000, validUntil: '2026-12-31' }); await crmApi.sendQuote(quote.id);
    const detail = LeadDetailSchema.parse(await crmApi.detail(id)); expect(detail.activities.some(activity => activity.body === 'Called and agreed to join')).toBe(true); expect(detail.quotes[0].status).toBe('SENT');
    const result = ConvertLeadResponseSchema.parse(await crmApi.convert(id, { planId: plans[0].id, paymentMethod: 'UPI' })); expect(result.lead.status).toBe('WON'); expect(result.lead.memberId).toBe(result.member.id);
    await expect(crmApi.convert(id, { planId: plans[0].id, paymentMethod: 'CASH' })).rejects.toMatchObject({ statusCode: 409 });
    expect((await crmApi.list({ status: 'NEW' })).data.some(item => item.id === id)).toBe(false);
  });
  it('encodes IDs and sends exact real mutation payloads', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false'); vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://club.example');
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch); const { crmApi } = await import('./crm-api');
    await crmApi.update('lead/a', { status: 'CONTACTED' }); await crmApi.note('lead/a', { type: 'NOTE', body: 'Called' }); await crmApi.sendQuote('quote/a');
    expect(fetch.mock.calls[0][0]).toBe('https://club.example/api/v1/crm/leads/lead%2Fa'); expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH', credentials: 'include', body: JSON.stringify({ status: 'CONTACTED' }) }); expect(fetch.mock.calls[2][0]).toBe('https://club.example/api/v1/crm/quotes/quote%2Fa/send');
  });
  it('uses the club day for follow-up filters and excludes won/lost leads from reminders', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS','true');const {crmApi}=await import('./crm-api');const {clubToday}=await import('./member-form');
    const id=(await crmApi.list({status:'NEW'})).data[0].id;
    const instant=new Date(`${clubToday()}T00:30:00+05:30`).toISOString();
    await crmApi.update(id,{nextFollowUpAt:instant});
    expect((await crmApi.list({dueToday:'true'})).data.some(lead=>lead.id===id)).toBe(true);
    expect((await crmApi.list({dueToday:'true'})).data.every(lead=>!['WON','LOST'].includes(lead.status))).toBe(true);
    const summary=await crmApi.summary();expect(summary.overdue).toBe(0);expect(summary.dueToday).toBe((await crmApi.list({dueToday:'true'})).meta.totalItems);
  });
  it('keeps won leads immutable and rejects expired or repeated quote sending', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS','true');const {crmApi,quoteDefaultDate}=await import('./crm-api');
    const won=(await crmApi.list({status:'WON'})).data[0];await expect(crmApi.update(won.id,{status:'NEW'})).rejects.toMatchObject({code:'ALREADY_CONVERTED'});
    const id=(await crmApi.list({status:'NEW'})).data[0].id;const expired=await crmApi.quote(id,{planId:plans[0].id,validUntil:'2000-01-01'});await expect(crmApi.sendQuote(expired.id)).rejects.toMatchObject({code:'QUOTE_STATE_INVALID'});
    const quote=await crmApi.quote(id,{planId:plans[0].id});expect(quote.validUntil).toBe(quoteDefaultDate());await crmApi.sendQuote(quote.id);expect((await crmApi.detail(id)).lead.status).toBe('QUOTED');await expect(crmApi.sendQuote(quote.id)).rejects.toMatchObject({code:'QUOTE_STATE_INVALID'});
  });
  it('rejects invalid Junior conversion and quoted conversion without creating a member',async()=>{
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS','true');const{crmApi}=await import('./crm-api');const{mockMemberStore}=await import('./mock-members');const id=(await crmApi.list({status:'NEW'})).data[0].id;const count=mockMemberStore.length;
    await expect(crmApi.convert(id,{planId:plans[2].id,paymentMethod:'CASH',dateOfBirth:'1990-01-01'})).rejects.toMatchObject({code:'JUNIOR_AGE_INVALID'});
    await expect(crmApi.convert(id,{planId:plans[2].id,paymentMethod:'CASH'})).rejects.toMatchObject({code:'JUNIOR_AGE_INVALID'});
    const quote=await crmApi.quote(id,{planId:plans[0].id});await expect(crmApi.convert(id,{planId:plans[0].id,quoteId:quote.id,paymentMethod:'CASH'})).rejects.toMatchObject({code:'QUOTE_INVALID'});
    expect(mockMemberStore).toHaveLength(count);expect((await crmApi.detail(id)).lead.status).toBe('NEW');
    const valid=await crmApi.convert(id,{planId:plans[0].id,paymentMethod:'CASH',phone:undefined});expect(valid.member.phone).toBeTruthy();
  });
});

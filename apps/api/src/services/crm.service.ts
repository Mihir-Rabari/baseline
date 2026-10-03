import { getEnv } from '@packages/config/env';
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { leads, leadActivities, quotes, plans, users, type DatabaseInstance, type LeadSource } from '@packages/db';
import type { CreateLeadRequest, UpdateLeadRequest, CreateLeadActivityRequest, CreateQuoteRequest, UpdateQuoteRequest, ConvertLeadRequest, LeadListQuery } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { addDays, clubDateOf } from '../lib/club-date.js';
import { MembershipService } from './membership.service.js';
import { NotificationService } from './notification.service.js';
import type { DbExecutor } from './db-types.js';

type LeadInput = Omit<CreateLeadRequest, 'source'> & { source: LeadSource };
export class CrmService {
  private readonly membership: MembershipService;
  constructor(private readonly db: DatabaseInstance, private readonly timeZone: string = getEnv().CLUB_TIMEZONE, membership?: MembershipService) {
    this.membership = membership ?? new MembershipService(db, { timeZone });
  }
  async getLead(id: string, executor: DbExecutor = this.db) {
    const [row] = await executor.select({ lead: leads, plan: { id: plans.id, code: plans.code, name: plans.name }, person: { id: users.id, name: users.name } })
      .from(leads).leftJoin(plans, eq(leads.interestedPlanId, plans.id)).leftJoin(users, eq(leads.assignedTo, users.id)).where(eq(leads.id, id));
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Lead not found');
    const l = row.lead;
    return { id: l.id, name: l.name, phone: l.phone, email: l.email, source: l.source, status: l.status,
      interestedPlan: row.plan, message: l.message, assignedTo: row.person, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
      memberId: l.memberId, createdAt: l.createdAt.toISOString() };
  }
  async createLead(input: LeadInput, actor: string | null = null, executor?: DbExecutor) {
    const create = async (tx: DbExecutor) => {
      if (input.interestedPlanId) {
        const [plan] = await tx.select().from(plans).where(eq(plans.id, input.interestedPlanId));
        if (!plan || !plan.isActive) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
      }
      const [lead] = await tx.insert(leads).values({ name: input.name, phone: input.phone ?? null, email: input.email ?? null,
        source: input.source, interestedPlanId: input.interestedPlanId ?? null, message: input.message ?? null }).returning();
      await new NotificationService(tx).notifyRole(['FRONT_DESK', 'OWNER'], { type: 'NEW_LEAD', title: 'New lead',
        body: lead.name, link: '/crm/leads/' + lead.id, data: { leadId: lead.id } }, 'lead:' + lead.id);
      if (actor) await tx.insert(leadActivities).values({ leadId: lead.id, type: 'NOTE', body: 'Lead created', actorUserId: actor });
      return this.getLead(lead.id, tx);
    };
    return executor ? create(executor) : this.db.transaction(create);
  }
  async list(query: LeadListQuery) {
    const where = and(query.status ? eq(leads.status, query.status) : undefined, query.source ? eq(leads.source, query.source) : undefined,
      query.assignedTo ? eq(leads.assignedTo, query.assignedTo) : undefined,
      query.q ? or(ilike(leads.name, '%' + query.q + '%'), ilike(leads.phone, '%' + query.q + '%'), ilike(leads.email, '%' + query.q + '%')) : undefined,
      query.dueToday === 'true' ? sql`(${leads.nextFollowUpAt} at time zone ${this.timeZone})::date = ${clubDateOf(new Date(), this.timeZone)}::date AND ${leads.status} NOT IN ('WON','LOST')` : undefined);
    const [rows, [total]] = await Promise.all([
      this.db.select({ id: leads.id, quoteCount: sql<number>`(select count(*)::int from quotes where quotes.lead_id = ${leads.id})` }).from(leads).where(where)
        .orderBy(query.order === 'asc' ? asc(leads.createdAt) : desc(leads.createdAt), asc(leads.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(leads).where(where)]);
    const data = await Promise.all(rows.map(async r => ({ ...await this.getLead(r.id), quoteCount: Number(r.quoteCount) })));
    const totalItems = Number(total.n), totalPages = Math.ceil(totalItems / query.limit);
    return { data, meta: { page: query.page, limit: query.limit, totalItems, totalPages, hasNextPage: query.page < totalPages, hasPrevPage: query.page > 1 } };
  }
  async summary() {
    const today = clubDateOf(new Date(), this.timeZone);
    const rows = await this.db.select().from(leads);
    const byStatus = { NEW: 0, CONTACTED: 0, QUOTED: 0, WON: 0, LOST: 0 };
    let dueToday = 0, overdue = 0;
    for (const row of rows) {
      byStatus[row.status]++;
      if (row.nextFollowUpAt && !['WON', 'LOST'].includes(row.status)) {
        const due = clubDateOf(row.nextFollowUpAt, this.timeZone);
        if (due === today) dueToday++; else if (due < today) overdue++;
      }
    }
    return { byStatus, dueToday, overdue, conversionRatePct: rows.length ? byStatus.WON * 100 / rows.length : 0 };
  }
  async detail(id: string) {
    const lead = await this.getLead(id);
    const activities = await this.db.select({ row: leadActivities, actor: { id: users.id, name: users.name } }).from(leadActivities)
      .leftJoin(users, eq(users.id, leadActivities.actorUserId)).where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.createdAt));
    const qs = await this.db.select({ id: quotes.id }).from(quotes).where(eq(quotes.leadId, id)).orderBy(desc(quotes.createdAt));
    return { lead, activities: activities.map(({row, actor}) => ({ id: row.id, type: row.type, body: row.body, actor, createdAt: row.createdAt.toISOString() })),
      quotes: await Promise.all(qs.map(q => this.getQuote(q.id))) };
  }
  async updateLead(id: string, input: UpdateLeadRequest, actor: string) {
    return this.db.transaction(async tx => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
      if (!lead) throw new DomainError('NOT_FOUND', 404, 'Lead not found');
      if (lead.status === 'WON') throw new DomainError('ALREADY_CONVERTED', 409, 'Lead already converted');
      if (input.assignedTo) {
        const [person] = await tx.select().from(users).where(and(eq(users.id, input.assignedTo), eq(users.status, 'ACTIVE')));
        if (!person) throw new DomainError('NOT_FOUND', 404, 'Assignee not found');
      }
      await tx.update(leads).set({ ...input, nextFollowUpAt: input.nextFollowUpAt === undefined ? undefined : input.nextFollowUpAt === null ? null : new Date(input.nextFollowUpAt), updatedAt: new Date() }).where(eq(leads.id, id));
      await tx.insert(leadActivities).values({ leadId: id, type: 'STATUS_CHANGE', body: input.status ?? 'Follow-up updated', actorUserId: actor });
      return this.getLead(id, tx);
    });
  }
  async addActivity(id: string, input: CreateLeadActivityRequest, actor: string) {
    await this.getLead(id);
    const [row] = await this.db.insert(leadActivities).values({ leadId: id, ...input, actorUserId: actor }).returning();
    const [person] = await this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, actor));
    return { id: row.id, type: row.type, body: row.body, actor: person ?? null, createdAt: row.createdAt.toISOString() };
  }
  async getQuote(id: string, executor: DbExecutor = this.db) {
    const [row] = await executor.select({ quote: quotes, plan: { id: plans.id, code: plans.code, name: plans.name } }).from(quotes)
      .innerJoin(plans, eq(plans.id, quotes.planId)).where(eq(quotes.id, id));
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Quote not found');
    return { ...row.quote, plan: row.plan, createdAt: row.quote.createdAt.toISOString() };
  }
  async createQuote(id: string, input: CreateQuoteRequest, actor: string) {
    await this.getLead(id);
    const [plan] = await this.db.select().from(plans).where(and(eq(plans.id, input.planId), eq(plans.isActive, true)));
    if (!plan) throw new DomainError('NOT_FOUND', 404, 'Plan not found');
    const [quote] = await this.db.insert(quotes).values({ leadId: id, planId: plan.id, amountPaise: input.amountPaise ?? plan.monthlyFeePaise,
      validUntil: input.validUntil ?? addDays(clubDateOf(new Date(), this.timeZone), 14), notes: input.notes ?? null, createdBy: actor }).returning();
    return this.getQuote(quote.id);
  }
  async sendQuote(id: string, actor: string) {
    return this.db.transaction(async tx => {
      const [candidate] = await tx.select({ leadId: quotes.leadId }).from(quotes).where(eq(quotes.id, id));
      if (!candidate) throw new DomainError('NOT_FOUND', 404, 'Quote not found');
      await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, candidate.leadId)).for('update');
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (!quote) throw new DomainError('NOT_FOUND', 404, 'Quote not found');
      if (quote.status !== 'DRAFT' || quote.validUntil < clubDateOf(new Date(), this.timeZone)) throw new DomainError('QUOTE_STATE_INVALID', 409, 'Quote cannot be sent');
      const [lead] = await tx.select().from(leads).where(eq(leads.id, quote.leadId)).for('update');
      if (lead.status === 'WON') throw new DomainError('ALREADY_CONVERTED', 409, 'Lead already converted');
      await tx.update(quotes).set({ status: 'SENT' }).where(eq(quotes.id, id));
      await tx.update(leads).set({ status: 'QUOTED', updatedAt: new Date() }).where(eq(leads.id, quote.leadId));
      await tx.insert(leadActivities).values({ leadId: quote.leadId, type: 'QUOTE_SENT', body: 'Quote sent', actorUserId: actor });
      return this.getQuote(id, tx);
    });
  }
  async updateQuote(id: string, input: UpdateQuoteRequest) {
    return this.db.transaction(async tx => {
      const [candidate] = await tx.select({ leadId: quotes.leadId }).from(quotes).where(eq(quotes.id, id));
      if (!candidate) throw new DomainError('NOT_FOUND', 404, 'Quote not found');
      await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, candidate.leadId)).for('update');
      const [quote] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (!quote) throw new DomainError('NOT_FOUND', 404, 'Quote not found');
      if (quote.status !== 'SENT' || quote.validUntil < clubDateOf(new Date(), this.timeZone)) throw new DomainError('QUOTE_STATE_INVALID', 409, 'Quote cannot be changed');
      await tx.update(quotes).set(input).where(eq(quotes.id, id));
      return this.getQuote(id, tx);
    });
  }
  async convert(id: string, input: ConvertLeadRequest, actor: string) {
    return this.db.transaction(async tx => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
      if (!lead) throw new DomainError('NOT_FOUND', 404, 'Lead not found');
      if (lead.memberId || lead.status === 'WON') throw new DomainError('ALREADY_CONVERTED', 409, 'Lead already converted');
      if (input.quoteId) {
        const [quote] = await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).for('update');
        if (!quote || quote.leadId !== id || quote.planId !== input.planId) throw new DomainError('QUOTE_INVALID', 422, 'Quote does not match this lead and plan');
        if (quote.status !== 'ACCEPTED' || quote.validUntil < clubDateOf(new Date(), this.timeZone)) throw new DomainError('QUOTE_INVALID', 422, 'Quote is not valid for conversion');
      }
      const phone = input.phone ?? lead.phone;
      if (!phone) throw new DomainError('PHONE_REQUIRED', 422, 'Phone is required to register a member');
      const result = await this.membership.registerInTransaction(tx, { fullName: lead.name, phone, email: lead.email ?? undefined,
        planId: input.planId, startsOn: input.startsOn, dateOfBirth: input.dateOfBirth, paymentMethod: input.paymentMethod }, actor);
      await tx.update(leads).set({ status: 'WON', memberId: result.memberId, convertedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, id));
      await tx.insert(leadActivities).values({ leadId: id, type: 'CONVERTED', actorUserId: actor, body: 'Converted to member' });
      return { lead: await this.getLead(id, tx), member: await this.membership.getMember(result.memberId, tx), invoice: result.sale.invoice, payment: result.sale.payment };
    });
  }
}

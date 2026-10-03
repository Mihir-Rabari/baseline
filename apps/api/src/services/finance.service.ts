import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { businessClients, invoiceLines, invoices, members, payments, systemSettings, users, type DatabaseInstance, type PaymentMethod } from '@packages/db';
import type {
  BusinessClient,
  BusinessClientListQuery,
  CreateBusinessClientRequest,
  CreateInvoiceRequest,
  Invoice,
  InvoiceDetail,
  InvoiceListQuery,
  LedgerPayment,
  PayInvoiceRequest,
  PayInvoiceResponse,
  PaymentListQuery,
  TaxSummary,
  TaxSummaryQuery,
  UpdateBusinessClientRequest,
} from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import { pageMeta } from '../lib/db-errors.js';
import { PaymentService } from './payment.service.js';
import { MAX_RANGE_DAYS, REVENUE_SOURCES, inclusiveTaxPaise, parseTaxRates } from './report.service.js';
import { addDays, clubDateOf, dayRange, daysBetween } from './time.js';

type InvoiceRow = typeof invoices.$inferSelect;

const DEFAULT_DUE_DAYS = 15;
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Invoices, business clients, the payments ledger and the simplified tax summary (API_CONTRACT.md section 10). */
export class FinanceService {
  constructor(
    private readonly db: DatabaseInstance,
    private readonly timezone: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private today() {
    return clubDateOf(this.now(), this.timezone);
  }

  private async taxRates() {
    const [row] = await this.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'tax.rates')).limit(1);
    return parseTaxRates(row?.value);
  }

  // ------------------------------------------------------------------- invoices

  /** Net paise received for each invoice through `/invoices/:id/pay` (payments minus refunds). */
  private async paidByInvoice(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!ids.length) return result;
    const rows = await this.db
      .select({ id: payments.sourceId, total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` })
      .from(payments)
      .where(and(eq(payments.source, 'INVOICE'), inArray(payments.sourceId, ids)))
      .groupBy(payments.sourceId);
    for (const row of rows) if (row.id) result.set(row.id, Number(row.total));
    return result;
  }

  private async toInvoices(rows: InvoiceRow[]): Promise<Invoice[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const memberIds = [...new Set(rows.map((row) => row.memberId).filter((id): id is string => Boolean(id)))];
    const clientIds = [...new Set(rows.map((row) => row.businessClientId).filter((id): id is string => Boolean(id)))];
    const [lines, paid, memberRows, clientRows] = await Promise.all([
      this.db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, ids)).orderBy(asc(invoiceLines.id)),
      this.paidByInvoice(ids),
      memberIds.length ? this.db.select({ id: members.id, name: members.fullName }).from(members).where(inArray(members.id, memberIds)) : [],
      clientIds.length ? this.db.select({ id: businessClients.id, name: businessClients.companyName }).from(businessClients).where(inArray(businessClients.id, clientIds)) : [],
    ]);
    const memberName = new Map(memberRows.map((row) => [row.id, row.name]));
    const clientName = new Map(clientRows.map((row) => [row.id, row.name]));
    return rows.map((row) => {
      // Membership invoices are born PAID and their money sits in the MEMBERSHIP ledger rows.
      const paidPaise = row.status === 'PAID' ? row.totalPaise : Math.max(0, paid.get(row.id) ?? 0);
      return {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status,
        billTo: row.memberId
          ? { type: 'MEMBER' as const, id: row.memberId, name: memberName.get(row.memberId) ?? 'Unknown member' }
          : { type: 'BUSINESS_CLIENT' as const, id: row.businessClientId!, name: clientName.get(row.businessClientId!) ?? 'Unknown client' },
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        lines: lines
          .filter((line) => line.invoiceId === row.id)
          .map((line) => ({ description: line.description, qty: line.qty, unitPricePaise: line.unitPricePaise, lineTotalPaise: line.lineTotalPaise })),
        subtotalPaise: row.subtotalPaise,
        taxPaise: row.taxPaise,
        totalPaise: row.totalPaise,
        paidPaise,
        balancePaise: row.status === 'VOID' ? 0 : Math.max(0, row.totalPaise - paidPaise),
        notes: row.notes,
      };
    });
  }

  async listInvoices(query: InvoiceListQuery) {
    const today = this.today();
    const where = and(
      query.status ? eq(invoices.status, query.status) : undefined,
      query.memberId ? eq(invoices.memberId, query.memberId) : undefined,
      query.businessClientId ? eq(invoices.businessClientId, query.businessClientId) : undefined,
      query.from ? gte(invoices.issueDate, query.from) : undefined,
      query.to ? lte(invoices.issueDate, query.to) : undefined,
      // Same definition as the owner dashboard: sent, not paid, past its due date.
      query.overdue === 'true' ? and(eq(invoices.status, 'SENT'), lt(invoices.dueDate, today)) : undefined,
      query.overdue === 'false' ? or(sql`${invoices.status} <> 'SENT'`, gte(invoices.dueDate, today)) : undefined
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.createdAt), desc(invoices.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(invoices).where(where),
    ]);
    return { data: await this.toInvoices(rows), meta: pageMeta(query.page, query.limit, Number(total?.n ?? 0)) };
  }

  /** Who owns an invoice, for `:self` authorisation. `memberUserId` is null for business clients. */
  async ownerOf(id: string): Promise<{ exists: boolean; memberUserId: string | null }> {
    const [row] = await this.db
      .select({ id: invoices.id, userId: members.userId })
      .from(invoices)
      .leftJoin(members, eq(members.id, invoices.memberId))
      .where(eq(invoices.id, id))
      .limit(1);
    return { exists: Boolean(row), memberUserId: row?.userId ?? null };
  }

  private async load(id: string): Promise<InvoiceRow> {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Invoice not found.');
    return row;
  }

  async getInvoice(id: string): Promise<InvoiceDetail> {
    const row = await this.load(id);
    const [invoice] = await this.toInvoices([row]);
    const rows = await this.db
      .select({ id: payments.id, amountPaise: payments.amountPaise, method: payments.method, paidAt: payments.paidAt })
      .from(payments)
      .where(and(eq(payments.source, 'INVOICE'), eq(payments.sourceId, id)))
      .orderBy(asc(payments.paidAt), asc(payments.id));
    return { ...invoice, payments: rows.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() })) };
  }

  async createInvoice(input: CreateInvoiceRequest, actorId: string): Promise<Invoice> {
    if (input.memberId) {
      const [member] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, input.memberId)).limit(1);
      if (!member) throw new DomainError('NOT_FOUND', 404, 'Member not found.');
    } else {
      const [client] = await this.db.select({ id: businessClients.id }).from(businessClients).where(eq(businessClients.id, input.businessClientId!)).limit(1);
      if (!client) throw new DomainError('NOT_FOUND', 404, 'Business client not found.');
    }
    const issueDate = input.issueDate ?? this.today();
    const dueDate = input.dueDate ?? addDays(issueDate, DEFAULT_DUE_DAYS);
    if (dueDate < issueDate) {
      throw new DomainError('VALIDATION_ERROR', 400, 'dueDate must not be before issueDate', [
        { field: 'dueDate', message: 'dueDate must not be before issueDate', code: 'INVALID_RANGE' },
      ]);
    }
    const lines = input.lines.map((line) => ({ ...line, lineTotalPaise: line.qty * line.unitPricePaise }));
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 2_000_000_000) {
      throw new DomainError('AMOUNT_TOO_LARGE', 422, 'The invoice total is too large.');
    }
    const taxPaise = inclusiveTaxPaise(subtotal, (await this.taxRates()).INVOICE);
    const created = await this.db.transaction(async (tx) => {
      const seq = await tx.execute<{ n: string }>(sql`select nextval('invoice_number_seq') as n`);
      const invoiceNumber = `INV-${issueDate.slice(0, 4)}-${String(seq[0]!.n).padStart(4, '0')}`;
      const [row] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          memberId: input.memberId ?? null,
          businessClientId: input.businessClientId ?? null,
          status: 'DRAFT',
          issueDate,
          dueDate,
          subtotalPaise: subtotal,
          taxPaise,
          totalPaise: subtotal,
          notes: input.notes ?? null,
          createdBy: actorId,
        })
        .returning();
      await tx.insert(invoiceLines).values(lines.map((line) => ({ invoiceId: row.id, ...line })));
      return row;
    });
    return (await this.toInvoices([created]))[0];
  }

  /** DRAFT to SENT. Email delivery is not wired, so this only records that the invoice went out. */
  async sendInvoice(id: string): Promise<Invoice> {
    const [row] = await this.db
      .update(invoices)
      .set({ status: 'SENT', sentAt: this.now() })
      .where(and(eq(invoices.id, id), eq(invoices.status, 'DRAFT')))
      .returning();
    if (!row) {
      const current = await this.load(id);
      throw new DomainError('INVALID_INVOICE_STATE', 409, `A ${current.status.toLowerCase()} invoice cannot be sent.`);
    }
    return (await this.toInvoices([row]))[0];
  }

  async payInvoice(id: string, input: PayInvoiceRequest, actorId: string): Promise<PayInvoiceResponse> {
    const result = await this.db.transaction(async (tx) => {
      // The row lock serialises concurrent payments, so two clerks cannot both settle the same balance.
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Invoice not found.');
      if (row.status === 'PAID') throw new DomainError('ALREADY_PAID', 409, 'This invoice is already paid.');
      if (row.status === 'VOID') throw new DomainError('INVOICE_VOID', 409, 'A void invoice cannot be paid.');
      if (row.status === 'DRAFT') throw new DomainError('INVOICE_NOT_SENT', 409, 'Send the invoice before taking payment.');
      const ledger = new PaymentService(tx);
      const paid = Math.max(0, await ledger.sumPaid('INVOICE', id));
      const balance = row.totalPaise - paid;
      if (balance <= 0) throw new DomainError('NOTHING_TO_PAY', 409, 'This invoice has no balance to pay.');
      const amount = input.amountPaise ?? balance;
      if (amount > balance) {
        throw new DomainError('AMOUNT_EXCEEDS_BALANCE', 422, 'The amount is more than the balance due.', [
          { field: 'amountPaise', message: `At most ${balance} paise is due`, code: 'AMOUNT_EXCEEDS_BALANCE' },
        ]);
      }
      const payment = await ledger.record({
        source: 'INVOICE',
        sourceId: id,
        amountPaise: amount,
        method: input.method as PaymentMethod,
        memberId: row.memberId,
        receivedBy: actorId,
        reference: input.reference ?? null,
        paidAt: this.now(),
      });
      const settled = amount === balance;
      const [updated] = settled
        ? await tx.update(invoices).set({ status: 'PAID', paidAt: this.now() }).where(eq(invoices.id, id)).returning()
        : [row];
      return { row: updated, payment };
    });
    const [invoice] = await this.toInvoices([result.row]);
    return { invoice, payment: { id: result.payment.id, amountPaise: Math.abs(result.payment.amountPaise), method: result.payment.method } };
  }

  /** Only an invoice nobody has paid can be voided; the reason goes to the audit log by the caller. */
  async voidInvoice(id: string): Promise<Invoice> {
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
      if (!row) throw new DomainError('NOT_FOUND', 404, 'Invoice not found.');
      if (row.status === 'VOID') throw new DomainError('ALREADY_VOID', 409, 'This invoice is already void.');
      if (row.status === 'PAID') throw new DomainError('INVOICE_HAS_PAYMENTS', 409, 'A paid invoice cannot be voided.');
      if ((await new PaymentService(tx).sumPaid('INVOICE', id)) !== 0) {
        throw new DomainError('INVOICE_HAS_PAYMENTS', 409, 'An invoice with payments cannot be voided.');
      }
      const [next] = await tx.update(invoices).set({ status: 'VOID' }).where(eq(invoices.id, id)).returning();
      return next;
    });
    return (await this.toInvoices([updated]))[0];
  }

  // ---------------------------------------------------------- business clients

  /** Amount still owed on SENT invoices, per client. */
  private async openBalances(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!ids.length) return result;
    const sent = await this.db
      .select({ id: invoices.id, clientId: invoices.businessClientId, total: invoices.totalPaise })
      .from(invoices)
      .where(and(inArray(invoices.businessClientId, ids), eq(invoices.status, 'SENT')));
    const paid = await this.paidByInvoice(sent.map((row) => row.id));
    for (const row of sent) {
      const owed = Math.max(0, row.total - Math.max(0, paid.get(row.id) ?? 0));
      result.set(row.clientId!, (result.get(row.clientId!) ?? 0) + owed);
    }
    return result;
  }

  private toClient(row: typeof businessClients.$inferSelect, openBalancePaise: number): BusinessClient {
    return {
      id: row.id,
      companyName: row.companyName,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      gstin: row.gstin,
      billingAddress: row.billingAddress,
      openBalancePaise,
    };
  }

  async listClients(query: BusinessClientListQuery) {
    const where = query.q
      ? or(
          ilike(businessClients.companyName, likePattern(query.q)),
          ilike(businessClients.contactName, likePattern(query.q)),
          ilike(businessClients.email, likePattern(query.q))
        )
      : undefined;
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(businessClients)
        .where(where)
        .orderBy(asc(businessClients.companyName), asc(businessClients.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(businessClients).where(where),
    ]);
    const balances = await this.openBalances(rows.map((row) => row.id));
    return { data: rows.map((row) => this.toClient(row, balances.get(row.id) ?? 0)), meta: pageMeta(query.page, query.limit, Number(total?.n ?? 0)) };
  }

  async createClient(input: CreateBusinessClientRequest): Promise<BusinessClient> {
    const [row] = await this.db.insert(businessClients).values(input).returning();
    return this.toClient(row, 0);
  }

  async updateClient(id: string, input: UpdateBusinessClientRequest): Promise<BusinessClient> {
    const values = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const [row] = Object.keys(values).length
      ? await this.db.update(businessClients).set(values).where(eq(businessClients.id, id)).returning()
      : await this.db.select().from(businessClients).where(eq(businessClients.id, id)).limit(1);
    if (!row) throw new DomainError('NOT_FOUND', 404, 'Business client not found.');
    return this.toClient(row, (await this.openBalances([row.id])).get(row.id) ?? 0);
  }

  // ------------------------------------------------------------ ledger and tax

  async listPayments(query: PaymentListQuery) {
    const where = and(
      query.from ? gte(payments.paidAt, dayRange(query.from, this.timezone).start) : undefined,
      query.to ? lt(payments.paidAt, dayRange(query.to, this.timezone).end) : undefined,
      query.source ? eq(payments.source, query.source as (typeof payments.$inferSelect)['source']) : undefined,
      query.method ? eq(payments.method, query.method) : undefined,
      query.kind ? eq(payments.kind, query.kind as (typeof payments.$inferSelect)['kind']) : undefined
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ payment: payments, userName: users.name, userEmail: users.email })
        .from(payments)
        .leftJoin(users, eq(users.id, payments.receivedBy))
        .where(where)
        .orderBy(desc(payments.paidAt), desc(payments.id))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ n: count() }).from(payments).where(where),
    ]);
    const data: LedgerPayment[] = rows.map(({ payment, userName, userEmail }) => ({
      id: payment.id,
      source: payment.source,
      sourceId: payment.sourceId,
      kind: payment.kind,
      amountPaise: payment.amountPaise,
      method: payment.method,
      receivedBy: payment.receivedBy ? { id: payment.receivedBy, name: userName || userEmail || 'Former user' } : null,
      shiftId: payment.shiftId,
      paidAt: payment.paidAt.toISOString(),
      reference: payment.reference,
    }));
    return { data, meta: pageMeta(query.page, query.limit, Number(total?.n ?? 0)) };
  }

  /** Gross is net of refunds; tax is the inclusive portion at each source's rate (BR-22). */
  async taxSummary(query: TaxSummaryQuery): Promise<TaxSummary> {
    if (daysBetween(query.from, query.to) + 1 > MAX_RANGE_DAYS) {
      throw new DomainError('VALIDATION_ERROR', 400, `The range may be at most ${MAX_RANGE_DAYS} days.`, [
        { field: 'to', message: `At most ${MAX_RANGE_DAYS} days`, code: 'RANGE_TOO_LONG' },
      ]);
    }
    const rates = await this.taxRates();
    const grouped = await this.db
      .select({ source: payments.source, gross: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` })
      .from(payments)
      .where(and(gte(payments.paidAt, dayRange(query.from, this.timezone).start), lt(payments.paidAt, dayRange(query.to, this.timezone).end)))
      .groupBy(payments.source);
    const gross = new Map(grouped.map((row) => [row.source, Number(row.gross)]));
    const rows = REVENUE_SOURCES.filter((source) => (gross.get(source) ?? 0) !== 0).map((source) => {
      const grossPaise = gross.get(source)!;
      const taxPaise = inclusiveTaxPaise(grossPaise, rates[source]);
      return { source, grossPaise, taxRateBp: rates[source], taxPaise, netPaise: grossPaise - taxPaise };
    });
    return {
      from: query.from,
      to: query.to,
      rows,
      totals: {
        grossPaise: rows.reduce((sum, row) => sum + row.grossPaise, 0),
        taxPaise: rows.reduce((sum, row) => sum + row.taxPaise, 0),
        netPaise: rows.reduce((sum, row) => sum + row.netPaise, 0),
      },
      note: 'Simplified: inclusive rates per source',
    };
  }
}

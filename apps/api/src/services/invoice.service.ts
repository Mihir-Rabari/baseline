import { eq, sql } from 'drizzle-orm';
import { invoiceLines, invoices, members, systemSettings } from '@packages/db';
import type { Invoice } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import type { DbExecutor } from './db-types.js';

/** Default MEMBERSHIP tax rate in basis points (BR-22), used when `tax.rates` is not seeded. */
const DEFAULT_MEMBERSHIP_TAX_BP = 1800;

export interface CreatePaidMembershipInvoiceInput {
  memberId: string;
  description: string;
  /** Tax-inclusive amount in paise. */
  amountPaise: number;
  issueDate: string;
  createdBy?: string | null;
  paidAt?: Date;
}

/**
 * Minimal invoice writer. Full invoice features (drafts, sending, business clients, voiding)
 * belong to S-04; this only produces the PAID membership invoice that register/renew need.
 */
export class InvoiceService {
  constructor(private readonly db: DbExecutor) {}

  withExecutor(executor: DbExecutor): InvoiceService {
    return new InvoiceService(executor);
  }

  /** Tax is the inclusive portion: round(amount * rate / (10000 + rate)). */
  static taxPortion(amountPaise: number, rateBp: number): number {
    return Math.round((amountPaise * rateBp) / (10000 + rateBp));
  }

  private async membershipTaxBp(): Promise<number> {
    const [row] = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'tax.rates'))
      .limit(1);
    const rate = (row?.value as Record<string, unknown> | undefined)?.MEMBERSHIP;
    return typeof rate === 'number' && Number.isInteger(rate) && rate >= 0
      ? rate
      : DEFAULT_MEMBERSHIP_TAX_BP;
  }

  async createPaidMembershipInvoice(input: CreatePaidMembershipInvoiceInput): Promise<Invoice> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 0) {
      throw new DomainError('INVALID_AMOUNT', 422, 'Invoice amount must be a non-negative whole number of paise');
    }
    const [member] = await this.db
      .select({ id: members.id, fullName: members.fullName })
      .from(members)
      .where(eq(members.id, input.memberId))
      .limit(1);
    if (!member) throw new DomainError('NOT_FOUND', 404, 'Member not found');

    const taxPaise = InvoiceService.taxPortion(input.amountPaise, await this.membershipTaxBp());
    const seq = await this.db.execute<{ n: string }>(sql`select nextval('invoice_number_seq') as n`);
    const invoiceNumber = `INV-${input.issueDate.slice(0, 4)}-${String(seq[0]!.n).padStart(4, '0')}`;

    const [invoice] = await this.db
      .insert(invoices)
      .values({
        invoiceNumber,
        memberId: member.id,
        status: 'PAID',
        issueDate: input.issueDate,
        dueDate: input.issueDate,
        subtotalPaise: input.amountPaise,
        taxPaise,
        totalPaise: input.amountPaise,
        paidAt: input.paidAt ?? new Date(),
        createdBy: input.createdBy ?? null,
      })
      .returning();
    await this.db.insert(invoiceLines).values({
      invoiceId: invoice.id,
      description: input.description,
      qty: 1,
      unitPricePaise: input.amountPaise,
      lineTotalPaise: input.amountPaise,
    });

    return {
      id: invoice.id,
      invoiceNumber,
      status: 'PAID',
      billTo: { type: 'MEMBER', id: member.id, name: member.fullName },
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      lines: [
        {
          description: input.description,
          qty: 1,
          unitPricePaise: input.amountPaise,
          lineTotalPaise: input.amountPaise,
        },
      ],
      subtotalPaise: invoice.subtotalPaise,
      taxPaise: invoice.taxPaise,
      totalPaise: invoice.totalPaise,
      paidPaise: invoice.totalPaise,
      balancePaise: 0,
      notes: null,
    };
  }
}

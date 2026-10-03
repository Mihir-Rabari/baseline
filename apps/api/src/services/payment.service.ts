import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  employees,
  payments,
  staffShifts,
  type PaymentMethod,
  type PaymentSource,
} from '@packages/db';
import { DomainError } from '../lib/domain-error.js';
import type { DbExecutor } from './db-types.js';

export interface RecordPaymentInput {
  source: PaymentSource;
  sourceId?: string | null;
  /** Positive integer, in paise. */
  amountPaise: number;
  method: PaymentMethod;
  memberId?: string | null;
  receivedBy?: string | null;
  reference?: string | null;
  paidAt?: Date;
}

export type RefundPaymentInput = RecordPaymentInput;

export type PaymentRow = typeof payments.$inferSelect;

function assertPositiveInteger(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new DomainError(
      'INVALID_AMOUNT',
      422,
      'Payment amount must be a positive whole number of paise'
    );
  }
}

/**
 * The payments ledger. Every rupee in the owner dashboard comes from here, so rows are only
 * ever appended: a refund is a new negative row, never an edit or delete of the original.
 */
export class PaymentService {
  constructor(private readonly db: DbExecutor) {}

  /** Returns a copy of the service bound to `executor` (e.g. a transaction). */
  withExecutor(executor: DbExecutor): PaymentService {
    return new PaymentService(executor);
  }

  /**
   * The receiver's currently open shift: the latest clocked-in, not-yet-clocked-out shift of
   * the employee linked to `userId`. Returns null when the user has no employee row or no open
   * shift (owners and members legitimately have none).
   */
  async findOpenShiftId(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .innerJoin(employees, eq(employees.id, staffShifts.employeeId))
      .where(
        and(
          eq(employees.userId, userId),
          isNotNull(staffShifts.clockInAt),
          isNull(staffShifts.clockOutAt)
        )
      )
      .orderBy(desc(staffShifts.clockInAt))
      .limit(1);
    return row?.id ?? null;
  }

  async record(input: RecordPaymentInput): Promise<PaymentRow> {
    assertPositiveInteger(input.amountPaise);
    return this.insertRow(input, 'PAYMENT', input.amountPaise);
  }

  /**
   * Writes a REFUND row with a negative amount. The refund may not exceed what has been net
   * paid for the same source, so a source can never go below zero.
   */
  async refund(input: RefundPaymentInput): Promise<PaymentRow> {
    assertPositiveInteger(input.amountPaise);
    if (input.sourceId) {
      const netPaid = await this.sumPaid(input.source, input.sourceId);
      if (input.amountPaise > netPaid) {
        throw new DomainError(
          'REFUND_EXCEEDS_PAID',
          422,
          'Refund amount exceeds the amount paid for this item'
        );
      }
    }
    return this.insertRow(input, 'REFUND', -input.amountPaise);
  }

  /** Net paise paid for a source (payments minus refunds). */
  async sumPaid(source: PaymentSource, sourceId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)` })
      .from(payments)
      .where(and(eq(payments.source, source), eq(payments.sourceId, sourceId)));
    return Number(row?.total ?? 0);
  }

  private async insertRow(
    input: RecordPaymentInput,
    kind: 'PAYMENT' | 'REFUND',
    signedAmount: number
  ): Promise<PaymentRow> {
    const shiftId = await this.findOpenShiftId(input.receivedBy);
    const [row] = await this.db
      .insert(payments)
      .values({
        source: input.source,
        sourceId: input.sourceId ?? null,
        kind,
        amountPaise: signedAmount,
        method: input.method,
        memberId: input.memberId ?? null,
        receivedBy: input.receivedBy ?? null,
        shiftId,
        reference: input.reference ?? null,
        ...(input.paidAt ? { paidAt: input.paidAt } : {}),
      })
      .returning();
    return row;
  }
}

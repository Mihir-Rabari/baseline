import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { employees, getDb, payments, staffShifts, users } from '@packages/db';
import { PaymentService } from './services/payment.service.js';
import { DomainError } from './lib/domain-error.js';
import { isDatabaseAvailable } from './test-support/database.js';

describe('PaymentService (payments ledger)', () => {
  let hasDatabase = false;
  const db = getDb();
  const service = new PaymentService(db);
  const userIds: string[] = [];
  const sourceIds: string[] = [];

  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({
        email: `m09-pay-${randomUUID()}@example.com`,
        name: 'M09 Payment Tester',
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    userIds.push(u.id);
    return u.id;
  }

  function newSource(): string {
    const id = randomUUID();
    sourceIds.push(id);
    return id;
  }

  beforeAll(async () => {
    hasDatabase = await isDatabaseAvailable();
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    if (sourceIds.length) await db.delete(payments).where(inArray(payments.sourceId, sourceIds));
    // employees.user_id is ON DELETE SET NULL; remove explicitly so shifts cascade away.
    if (userIds.length) {
      await db.delete(employees).where(inArray(employees.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it('record() writes a positive PAYMENT row', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const sourceId = newSource();
    const row = await service.record({
      source: 'SHOP',
      sourceId,
      amountPaise: 150000,
      method: 'UPI',
      reference: 'upi-123',
    });
    expect(row.kind).toBe('PAYMENT');
    expect(row.amountPaise).toBe(150000);
    expect(row.shiftId).toBeNull();
    expect(await service.sumPaid('SHOP', sourceId)).toBe(150000);
  });

  it('refund() writes a negative row and net paid returns to zero', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const sourceId = newSource();
    await service.record({ source: 'COURT', sourceId, amountPaise: 80000, method: 'CASH' });
    const refund = await service.refund({
      source: 'COURT',
      sourceId,
      amountPaise: 80000,
      method: 'CASH',
    });
    expect(refund.kind).toBe('REFUND');
    expect(refund.amountPaise).toBe(-80000);
    expect(await service.sumPaid('COURT', sourceId)).toBe(0);
  });

  it('partial refund leaves the remainder as net paid', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const sourceId = newSource();
    await service.record({ source: 'BAR', sourceId, amountPaise: 50000, method: 'CARD' });
    await service.refund({ source: 'BAR', sourceId, amountPaise: 20000, method: 'CARD' });
    expect(await service.sumPaid('BAR', sourceId)).toBe(30000);
  });

  it('sumPaid() is scoped to the source and id', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const a = newSource();
    const b = newSource();
    await service.record({ source: 'SHOP', sourceId: a, amountPaise: 100, method: 'CASH' });
    await service.record({ source: 'SHOP', sourceId: b, amountPaise: 700, method: 'CASH' });
    expect(await service.sumPaid('SHOP', a)).toBe(100);
    expect(await service.sumPaid('BAR', a)).toBe(0);
    expect(await service.sumPaid('SHOP', randomUUID())).toBe(0);
  });

  it('rejects a refund larger than the net paid amount (cannot go below zero)', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const sourceId = newSource();
    await service.record({ source: 'SHOP', sourceId, amountPaise: 1000, method: 'CASH' });
    await expect(
      service.refund({ source: 'SHOP', sourceId, amountPaise: 1001, method: 'CASH' })
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAID', statusCode: 422 });
    // A double refund is also refused.
    await service.refund({ source: 'SHOP', sourceId, amountPaise: 1000, method: 'CASH' });
    await expect(
      service.refund({ source: 'SHOP', sourceId, amountPaise: 1, method: 'CASH' })
    ).rejects.toBeInstanceOf(DomainError);
    expect(await service.sumPaid('SHOP', sourceId)).toBe(0);
  });

  it('rejects zero, negative and fractional amounts', async () => {
    // Validation happens before any query, so this runs without a database.
    const base = { source: 'SHOP', sourceId: randomUUID(), method: 'CASH' } as const;
    for (const amountPaise of [0, -5, 10.5, Number.NaN]) {
      await expect(service.record({ ...base, amountPaise })).rejects.toMatchObject({
        code: 'INVALID_AMOUNT',
      });
      await expect(service.refund({ ...base, amountPaise })).rejects.toMatchObject({
        code: 'INVALID_AMOUNT',
      });
    }
  });

  it('attaches the receiver\'s open shift', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const userId = await makeUser();
    const [emp] = await db
      .insert(employees)
      .values({
        userId,
        fullName: 'M09 Desk Clerk',
        position: 'Front desk',
        department: 'FRONT_DESK',
        hiredOn: '2026-01-01',
      })
      .returning({ id: employees.id });
    const now = Date.now();
    const [shift] = await db
      .insert(staffShifts)
      .values({
        employeeId: emp.id,
        roleLabel: 'FRONT_DESK',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        clockInAt: new Date(now - 3_000_000),
      })
      .returning({ id: staffShifts.id });

    const sourceId = newSource();
    const row = await service.record({
      source: 'SHOP',
      sourceId,
      amountPaise: 999,
      method: 'CASH',
      receivedBy: userId,
    });
    expect(row.shiftId).toBe(shift.id);
    expect(row.receivedBy).toBe(userId);

    // Refund recorded by the same receiver also carries the shift.
    const refund = await service.refund({
      source: 'SHOP',
      sourceId,
      amountPaise: 999,
      method: 'CASH',
      receivedBy: userId,
    });
    expect(refund.shiftId).toBe(shift.id);

    // Once clocked out there is no open shift any more.
    await db
      .update(staffShifts)
      .set({ clockOutAt: new Date() })
      .where(eq(staffShifts.id, shift.id));
    expect(await service.findOpenShiftId(userId)).toBeNull();
  });

  it('tolerates a receiver with no employee row or no shift', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const userId = await makeUser();
    const row = await service.record({
      source: 'SHOP',
      sourceId: newSource(),
      amountPaise: 500,
      method: 'UPI',
      receivedBy: userId,
    });
    expect(row.shiftId).toBeNull();
    expect(row.receivedBy).toBe(userId);
    expect(await service.findOpenShiftId(null)).toBeNull();
  });
});

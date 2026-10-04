import { describe, it, expect, beforeAll } from 'vitest';
import {
  PricingService,
  WALK_IN_DEFAULTS,
  entitlementsFromMembership,
  priceFor,
  walkInEntitlements,
  type MembershipPlanRow,
  type PriceKind,
} from '../../../../apps/api/src/services/pricing.service.js';
import { isDatabaseAvailable } from '../../../../apps/api/src/test-support/database.js';
import { createMember, createMembership, createPlan, withRollback } from '../../../../apps/api/src/test-support/court-fixtures.js';

// Seed prices (PROJECT_OVERVIEW.md 2.3): Gold 100% off courts, Silver 30%, Junior 50%; tennis 600.00.
const TENNIS = { baseRatePaise: 60000, socialFeePaise: 14000, trialFeePaise: 19900 };
const GOLD = { courtDiscountPct: 100 };
const SILVER = { courtDiscountPct: 30 };
const JUNIOR = { courtDiscountPct: 50 };

describe('priceFor (BR-05)', () => {
  const cases: Array<{
    name: string;
    plan: { courtDiscountPct: number } | null;
    kind: PriceKind;
    expected: { basePricePaise: number; discountPct: number; pricePaise: number };
  }> = [
    { name: 'Gold standard is free', plan: GOLD, kind: 'STANDARD', expected: { basePricePaise: 60000, discountPct: 100, pricePaise: 0 } },
    { name: 'Silver standard', plan: SILVER, kind: 'STANDARD', expected: { basePricePaise: 60000, discountPct: 30, pricePaise: 42000 } },
    { name: 'Junior standard', plan: JUNIOR, kind: 'STANDARD', expected: { basePricePaise: 60000, discountPct: 50, pricePaise: 30000 } },
    { name: 'guest / walk-in pays the base rate', plan: null, kind: 'STANDARD', expected: { basePricePaise: 60000, discountPct: 0, pricePaise: 60000 } },
    { name: 'trial pays the flat trial fee for a guest', plan: null, kind: 'TRIAL', expected: { basePricePaise: 60000, discountPct: 0, pricePaise: 19900 } },
    { name: 'trial ignores any plan discount', plan: SILVER, kind: 'TRIAL', expected: { basePricePaise: 60000, discountPct: 0, pricePaise: 19900 } },
    { name: 'social Gold is free', plan: GOLD, kind: 'SOCIAL', expected: { basePricePaise: 14000, discountPct: 100, pricePaise: 0 } },
    { name: 'social Silver', plan: SILVER, kind: 'SOCIAL', expected: { basePricePaise: 14000, discountPct: 30, pricePaise: 9800 } },
    { name: 'social guest pays the social fee', plan: null, kind: 'SOCIAL', expected: { basePricePaise: 14000, discountPct: 0, pricePaise: 14000 } },
  ];

  it.each(cases)('$name', ({ plan, kind, expected }) => {
    expect(priceFor({ courtType: TENNIS, plan, kind })).toEqual(expected);
  });

  it.each([
    // [base, pct, expected]: round(base * (100 - pct) / 100), halves round up
    [1, 50, 1], // 0.5 -> 1
    [3, 50, 2], // 1.5 -> 2
    [999, 33, 669], // 669.33 -> 669
    [999, 34, 659], // 659.34 -> 659
    [1001, 50, 501], // 500.5 -> 501
    [0, 30, 0],
  ])('rounds to integer paise: base %i at %i%% off -> %i', (base, pct, expected) => {
    const result = priceFor({
      courtType: { baseRatePaise: base, socialFeePaise: 0, trialFeePaise: 0 },
      plan: { courtDiscountPct: pct },
      kind: 'STANDARD',
    });
    expect(Number.isInteger(result.pricePaise)).toBe(true);
    expect(result.pricePaise).toBe(expected);
  });

  it('rejects out-of-range discounts and non-integer money instead of producing a wrong price', () => {
    expect(() => priceFor({ courtType: TENNIS, plan: { courtDiscountPct: 101 }, kind: 'STANDARD' })).toThrow(RangeError);
    expect(() => priceFor({ courtType: TENNIS, plan: { courtDiscountPct: -1 }, kind: 'STANDARD' })).toThrow(RangeError);
    expect(() => priceFor({ courtType: TENNIS, plan: { courtDiscountPct: 12.5 }, kind: 'STANDARD' })).toThrow(RangeError);
    expect(() =>
      priceFor({ courtType: { ...TENNIS, baseRatePaise: 600.5 }, plan: null, kind: 'STANDARD' })
    ).toThrow(RangeError);
  });

  it('PricingService.priceFor delegates to the pure function', () => {
    const service = new PricingService({} as never);
    expect(service.priceFor({ courtType: TENNIS, plan: SILVER, kind: 'STANDARD' }).pricePaise).toBe(42000);
  });
});

describe('entitlementsFromMembership (BR-07)', () => {
  const planOf = (name: string, discount: number, horizon: number): MembershipPlanRow['plan'] => ({
    id: `plan-${name}`,
    code: name.toUpperCase(),
    name,
    courtDiscountPct: discount,
    shopDiscountPct: 10,
    barDiscountPct: 5,
    maxBookingsPerDay: 2,
    bookingHorizonDays: horizon,
  });
  const row = (over: Partial<MembershipPlanRow> = {}): MembershipPlanRow => ({
    membershipId: 'm-1',
    status: 'ACTIVE',
    startsOn: '2026-10-01',
    endsOn: '2026-10-30',
    plan: planOf('Silver', 30, 7),
    ...over,
  });

  it('no membership resolves to walk-in defaults', () => {
    expect(entitlementsFromMembership(null, '2026-10-12')).toEqual(walkInEntitlements());
    expect(entitlementsFromMembership(undefined, '2026-10-12')).toMatchObject({
      isMember: false,
      plan: null,
      courtDiscountPct: WALK_IN_DEFAULTS.courtDiscountPct,
      bookingHorizonDays: 2,
    });
  });

  it('an ACTIVE membership covering the date grants the plan, including both boundary days', () => {
    for (const date of ['2026-10-01', '2026-10-15', '2026-10-30']) {
      expect(entitlementsFromMembership(row(), date)).toMatchObject({
        isMember: true,
        plan: { code: 'SILVER', name: 'Silver' },
        courtDiscountPct: 30,
        bookingHorizonDays: 7,
        membershipExpiresBeforeDate: false,
      });
    }
  });

  it.each(['EXPIRED', 'CANCELLED', 'REPLACED'])('a %s membership is priced as a walk-in', (status) => {
    const result = entitlementsFromMembership(row({ status }), '2026-10-12');
    expect(result.isMember).toBe(false);
    expect(result.courtDiscountPct).toBe(0);
    expect(priceFor({ courtType: TENNIS, plan: result, kind: 'STANDARD' }).pricePaise).toBe(60000);
  });

  it('an ACTIVE membership ending before the session date falls back to walk-in and flags it (BR-07 refusal)', () => {
    const result = entitlementsFromMembership(row(), '2026-10-31');
    expect(result).toMatchObject({ isMember: false, plan: null, courtDiscountPct: 0, membershipExpiresBeforeDate: true, membershipEndsOn: '2026-10-30' });
  });

  it('a membership that has not started yet does not grant the plan', () => {
    const result = entitlementsFromMembership(row(), '2026-09-30');
    expect(result).toMatchObject({ isMember: false, membershipExpiresBeforeDate: false });
  });
});

describe('PricingService.resolveEntitlements (database)', () => {
  let hasDatabase = false;

  beforeAll(async () => {
    hasDatabase = await isDatabaseAvailable();
  });

  it('resolves Gold, Silver, Junior, expired and no-membership members to the right price', async (ctx) => {
    if (!hasDatabase) return ctx.skip();

    await withRollback(async (db) => {
      const service = new PricingService(db);
      const gold = await createPlan(db, { code: 'T_GOLD', courtDiscountPct: 100, bookingHorizonDays: 14 });
      const silver = await createPlan(db, { code: 'T_SILVER', courtDiscountPct: 30, bookingHorizonDays: 7 });
      const junior = await createPlan(db, { code: 'T_JUNIOR', courtDiscountPct: 50, bookingHorizonDays: 7 });

      const goldMember = await createMember(db);
      const silverMember = await createMember(db);
      const juniorMember = await createMember(db);
      const expiredMember = await createMember(db);
      const lapsedMember = await createMember(db);
      const walkInMember = await createMember(db);

      await createMembership(db, { memberId: goldMember.id, planId: gold.id, startsOn: '2026-10-01', endsOn: '2026-10-30' });
      await createMembership(db, { memberId: silverMember.id, planId: silver.id, startsOn: '2026-10-01', endsOn: '2026-10-30' });
      await createMembership(db, { memberId: juniorMember.id, planId: junior.id, startsOn: '2026-10-01', endsOn: '2026-10-30' });
      await createMembership(db, { memberId: expiredMember.id, planId: gold.id, startsOn: '2026-08-01', endsOn: '2026-08-30', status: 'EXPIRED' });
      await createMembership(db, { memberId: lapsedMember.id, planId: silver.id, startsOn: '2026-09-01', endsOn: '2026-10-05' }); // ACTIVE, ends early

      const table: Array<[string, string, number, string]> = [
        ['Gold', goldMember.id, 0, 'MEMBER'],
        ['Silver', silverMember.id, 42000, 'MEMBER'],
        ['Junior', juniorMember.id, 30000, 'MEMBER'],
        ['expired membership gets the walk-in price', expiredMember.id, 60000, 'WALK_IN'],
        ['member without any membership', walkInMember.id, 60000, 'WALK_IN'],
        ['ACTIVE membership that ends before the date', lapsedMember.id, 60000, 'WALK_IN'],
      ];

      for (const [label, memberId, expectedPrice, type] of table) {
        const entitlements = await service.resolveEntitlements(memberId, '2026-10-12');
        const price = service.priceFor({ courtType: TENNIS, plan: entitlements, kind: 'STANDARD' }).pricePaise;
        expect({ label, price, member: entitlements.isMember }).toEqual({ label, price: expectedPrice, member: type === 'MEMBER' });
      }

      const social = await service.resolveEntitlements(goldMember.id, '2026-10-12');
      expect(service.priceFor({ courtType: TENNIS, plan: social, kind: 'SOCIAL' }).pricePaise).toBe(0);
      expect(social).toMatchObject({ plan: { code: 'T_GOLD' }, bookingHorizonDays: 14, maxBookingsPerDay: 2 });

      const lapsed = await service.resolveEntitlements(lapsedMember.id, '2026-10-12');
      expect(lapsed.membershipExpiresBeforeDate).toBe(true);
      expect(lapsed.bookingHorizonDays).toBe(2);

      // Same member, earlier date inside the term: plan applies again.
      expect((await service.resolveEntitlements(lapsedMember.id, '2026-10-04')).isMember).toBe(true);
    });
  });

  it('rejects a malformed date', async (ctx) => {
    if (!hasDatabase) return ctx.skip();
    const service = new PricingService({} as never);
    await expect(service.resolveEntitlements('00000000-0000-4000-8000-000000000000', '12/10/2026')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  });
});

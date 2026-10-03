import { and, eq } from 'drizzle-orm';
import { memberships, plans, type DatabaseInstance } from '@packages/db';
import { DomainError } from '../lib/domain-error.js';

/**
 * PricingService (M-06): the only place that turns a court type + plan into a price.
 *
 * Money is integer paise. BR-05: `price = round(base * (100 - discountPct) / 100)`; the result is
 * snapshotted on the booking by the booking engine, so later plan edits never rewrite history.
 */

export type PriceKind = 'STANDARD' | 'SOCIAL' | 'TRIAL';

export interface CourtTypePricing {
  baseRatePaise: number;
  socialFeePaise: number;
  trialFeePaise: number;
}

export interface PlanPricing {
  courtDiscountPct: number;
}

export interface PriceInput {
  courtType: CourtTypePricing;
  /** `null` for walk-ins, guests and members without a valid membership. */
  plan: PlanPricing | null;
  kind: PriceKind;
}

export interface PriceResult {
  basePricePaise: number;
  discountPct: number;
  pricePaise: number;
}

/** BR-06/BR-04 defaults applied to anyone without a valid membership on the session date. */
export const WALK_IN_DEFAULTS = {
  courtDiscountPct: 0,
  shopDiscountPct: 0,
  barDiscountPct: 0,
  maxBookingsPerDay: 2,
  bookingHorizonDays: 2,
} as const;

export interface EntitlementPlan {
  id: string;
  code: string;
  name: string;
}

export interface Entitlements {
  /** True only when an ACTIVE membership covers the session date (BR-07). */
  isMember: boolean;
  plan: EntitlementPlan | null;
  membershipId: string | null;
  membershipEndsOn: string | null;
  /**
   * True when the member holds an ACTIVE membership that ends before the session date. The
   * booking engine refuses that with `MEMBERSHIP_EXPIRES_BEFORE_SLOT` (BR-07); the price falls
   * back to walk-in so availability grids can still be shown.
   */
  membershipExpiresBeforeDate: boolean;
  courtDiscountPct: number;
  shopDiscountPct: number;
  barDiscountPct: number;
  maxBookingsPerDay: number;
  bookingHorizonDays: number;
}

export interface MembershipPlanRow {
  membershipId: string;
  status: string;
  startsOn: string;
  endsOn: string;
  plan: EntitlementPlan & {
    courtDiscountPct: number;
    shopDiscountPct: number;
    barDiscountPct: number;
    maxBookingsPerDay: number;
    bookingHorizonDays: number;
  };
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}, received ${value}`);
  }
}

/** Pure BR-05 pricing with trial and social variants. */
export function priceFor(input: PriceInput): PriceResult {
  const { courtType, plan, kind } = input;

  if (kind === 'TRIAL') {
    // Trials are a flat promotional fee: no plan discount, the list price is kept for reporting.
    assertIntegerInRange('baseRatePaise', courtType.baseRatePaise, 0, Number.MAX_SAFE_INTEGER);
    assertIntegerInRange('trialFeePaise', courtType.trialFeePaise, 0, Number.MAX_SAFE_INTEGER);
    return {
      basePricePaise: courtType.baseRatePaise,
      discountPct: 0,
      pricePaise: courtType.trialFeePaise,
    };
  }

  const basePricePaise = kind === 'SOCIAL' ? courtType.socialFeePaise : courtType.baseRatePaise;
  const discountPct = plan?.courtDiscountPct ?? 0;
  assertIntegerInRange(kind === 'SOCIAL' ? 'socialFeePaise' : 'baseRatePaise', basePricePaise, 0, Number.MAX_SAFE_INTEGER);
  assertIntegerInRange('courtDiscountPct', discountPct, 0, 100);

  return {
    basePricePaise,
    discountPct,
    pricePaise: Math.round((basePricePaise * (100 - discountPct)) / 100),
  };
}

/** Entitlements for anyone without a valid membership. */
export function walkInEntitlements(): Entitlements {
  return {
    isMember: false,
    plan: null,
    membershipId: null,
    membershipEndsOn: null,
    membershipExpiresBeforeDate: false,
    ...WALK_IN_DEFAULTS,
  };
}

/**
 * Pure BR-07 decision. `row` is the member's ACTIVE membership (if any); only a membership whose
 * term covers `onDate` grants plan entitlements, anything else is priced as a walk-in.
 */
export function entitlementsFromMembership(row: MembershipPlanRow | null | undefined, onDate: string): Entitlements {
  const walkIn = walkInEntitlements();
  if (!row || row.status !== 'ACTIVE') {
    return walkIn;
  }

  // `YYYY-MM-DD` strings compare correctly as plain strings.
  if (row.endsOn < onDate) {
    return { ...walkIn, membershipId: row.membershipId, membershipEndsOn: row.endsOn, membershipExpiresBeforeDate: true };
  }
  if (row.startsOn > onDate) {
    return { ...walkIn, membershipId: row.membershipId, membershipEndsOn: row.endsOn };
  }

  return {
    isMember: true,
    plan: { id: row.plan.id, code: row.plan.code, name: row.plan.name },
    membershipId: row.membershipId,
    membershipEndsOn: row.endsOn,
    membershipExpiresBeforeDate: false,
    courtDiscountPct: row.plan.courtDiscountPct,
    shopDiscountPct: row.plan.shopDiscountPct,
    barDiscountPct: row.plan.barDiscountPct,
    maxBookingsPerDay: row.plan.maxBookingsPerDay,
    bookingHorizonDays: row.plan.bookingHorizonDays,
  };
}

export class PricingService {
  constructor(private readonly db: DatabaseInstance) {}

  priceFor(input: PriceInput): PriceResult {
    return priceFor(input);
  }

  /**
   * Resolves what `memberId` is entitled to on `onDate` (club-local `YYYY-MM-DD`): the plan of the
   * ACTIVE membership covering that date, or the walk-in defaults (BR-07).
   */
  async resolveEntitlements(memberId: string, onDate: string): Promise<Entitlements> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
      throw new DomainError('VALIDATION_ERROR', 400, 'onDate must be a YYYY-MM-DD date');
    }

    const [row] = await this.db
      .select({
        membershipId: memberships.id,
        status: memberships.status,
        startsOn: memberships.startsOn,
        endsOn: memberships.endsOn,
        plan: {
          id: plans.id,
          code: plans.code,
          name: plans.name,
          courtDiscountPct: plans.courtDiscountPct,
          shopDiscountPct: plans.shopDiscountPct,
          barDiscountPct: plans.barDiscountPct,
          maxBookingsPerDay: plans.maxBookingsPerDay,
          bookingHorizonDays: plans.bookingHorizonDays,
        },
      })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      // The partial unique index guarantees at most one ACTIVE membership per member.
      .where(and(eq(memberships.memberId, memberId), eq(memberships.status, 'ACTIVE')))
      .limit(1);

    return entitlementsFromMembership(row, onDate);
  }
}

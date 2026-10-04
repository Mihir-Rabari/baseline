import { and, eq, sql } from 'drizzle-orm';
import { hashPassword } from '@packages/shared/crypto';
import type { DatabaseInstance } from './client.js';
import {
  plans,
  members,
  memberships,
  membershipEvents,
  courtTypes,
  categories,
  DEFAULT_CATEGORIES,
  courts,
  socialWindows,
  products,
  menuItems,
  barTables,
  employees,
  users,
  roles,
  userRoles,
  systemSettings,
} from './schema/index.js';

/**
 * CourtOS demo data (task M-03).
 *
 * Fully idempotent: every insert is keyed on a natural key (`plans.code`,
 * `court_types.code`, `courts.name`, `products.sku`, `menu_items.name`,
 * `bar_tables.name`, `members.member_code`, `users.email`) and existing rows are left
 * untouched, so Owner edits and live stock levels survive a re-seed and a second run
 * yields identical row counts. Credentials are never overwritten.
 */

const log = (message: string) => console.log(`[DB] ${message}`);

export interface SeedCourtOsOptions {
  /** Shared password for the demo users. When empty the demo users are skipped. */
  demoPassword?: string | null;
  /** Club-local date (YYYY-MM-DD) used to anchor membership dates. Defaults to today. */
  today?: string;
}

export const DEMO_USERS = [
  { email: 'owner@courtos.test', name: 'Demo Owner', role: 'OWNER' },
  { email: 'desk@courtos.test', name: 'Demo Front Desk', role: 'FRONT_DESK' },
  { email: 'bar@courtos.test', name: 'Demo Bar Staff', role: 'BAR_STAFF' },
  { email: 'member@courtos.test', name: 'Demo Member', role: 'MEMBER' },
] as const;

const PLANS = [
  { code: 'GOLD', name: 'Gold', description: 'Premium, full access', monthlyFeePaise: 300000, courtDiscountPct: 100, shopDiscountPct: 15, barDiscountPct: 10, maxBookingsPerDay: 2, bookingHorizonDays: 14, minAge: null, maxAge: null, sortOrder: 1 },
  { code: 'SILVER', name: 'Silver', description: 'Standard membership', monthlyFeePaise: 150000, courtDiscountPct: 30, shopDiscountPct: 8, barDiscountPct: 5, maxBookingsPerDay: 2, bookingHorizonDays: 7, minAge: null, maxAge: null, sortOrder: 2 },
  { code: 'JUNIOR', name: 'Junior', description: 'Under 18, discounted', monthlyFeePaise: 80000, courtDiscountPct: 50, shopDiscountPct: 10, barDiscountPct: 5, maxBookingsPerDay: 2, bookingHorizonDays: 7, minAge: null, maxAge: 17, sortOrder: 3 },
] as const;

const COURT_TYPES = [
  { code: 'TENNIS', name: 'Tennis', baseRatePaise: 60000, socialFeePaise: 20000, trialFeePaise: 19900, socialCapacity: 8 },
  { code: 'PADEL', name: 'Padel', baseRatePaise: 80000, socialFeePaise: 25000, trialFeePaise: 19900, socialCapacity: 8 },
  { code: 'BADMINTON', name: 'Badminton', baseRatePaise: 40000, socialFeePaise: 15000, trialFeePaise: 14900, socialCapacity: 12 },
  { code: 'CRICKET_NETS', name: 'Cricket Nets', baseRatePaise: 50000, socialFeePaise: 15000, trialFeePaise: 14900, socialCapacity: 6 },
] as const;

const COURTS = [
  ['TENNIS', 'Tennis Court 1'], ['TENNIS', 'Tennis Court 2'],
  ['PADEL', 'Padel Court 1'], ['PADEL', 'Padel Court 2'],
  ['BADMINTON', 'Badminton Court 1'], ['BADMINTON', 'Badminton Court 2'],
  ['CRICKET_NETS', 'Cricket Net 1'], ['CRICKET_NETS', 'Cricket Net 2'],
] as const;

const SETTINGS = [
  { key: 'club.hours', value: { open: '06:00', close: '22:00' }, description: 'Club opening hours (club-local time)' },
  {
    key: 'club.profile',
    value: { name: 'Baseline Sports Club', tagline: 'Courts, coaching and a bar under one roof.', phone: '+91 98765 43210', address: '14 Cubbon Park Road, Bengaluru 560001' },
    description: 'Public club details shown on the website (name, tagline, phone, address)',
  },
  { key: 'booking.cancel_cutoff_hours', value: 2, description: 'Hours before start after which a cancellation is late' },
  { key: 'tax.rates', value: { COURT: 1800, SHOP: 1800, BAR: 500, MEMBERSHIP: 1800, INVOICE: 1800 }, description: 'Tax rates in basis points per revenue source' },
  { key: 'shop.delivery_fee_paise', value: 5000, description: 'Flat delivery fee for online shop orders, in paise' },
] as const;

type ProductRow = [sku: string, name: string, category: 'RACKET' | 'BALL' | 'SHOE' | 'ACCESSORY' | 'APPAREL', pricePaise: number, stock: number, reorder: number];
// 30 products. Low stock (qty <= reorder level): TEN-BALL-3 (2/10), PAD-BALL-3 (4/8), SHO-RUN-M9 (1/3, the demo item).
const PRODUCTS: ProductRow[] = [
  ['RKT-TEN-PRO', 'Tennis Racket Pro', 'RACKET', 899900, 12, 3],
  ['RKT-TEN-CLUB', 'Tennis Racket Club', 'RACKET', 449900, 15, 3],
  ['RKT-TEN-JR', 'Tennis Racket Junior', 'RACKET', 249900, 10, 3],
  ['RKT-PAD-PRO', 'Padel Racket Pro', 'RACKET', 749900, 8, 2],
  ['RKT-PAD-CLUB', 'Padel Racket Club', 'RACKET', 399900, 10, 2],
  ['RKT-BAD-PRO', 'Badminton Racket Pro', 'RACKET', 299900, 14, 4],
  ['RKT-BAD-CLUB', 'Badminton Racket Club', 'RACKET', 149900, 20, 4],
  ['BAT-CRI-WIL', 'Cricket Bat English Willow', 'RACKET', 1299900, 6, 2],
  ['BAT-CRI-KSH', 'Cricket Bat Kashmir Willow', 'RACKET', 599900, 9, 2],
  ['TEN-BALL-3', 'Tennis Balls (can of 3)', 'BALL', 59900, 2, 10],
  ['PAD-BALL-3', 'Padel Balls (can of 3)', 'BALL', 69900, 4, 8],
  ['SHT-BAD-6', 'Badminton Shuttles (tube of 6)', 'BALL', 79900, 40, 10],
  ['CRI-BALL-RED', 'Cricket Ball Red Leather', 'BALL', 49900, 25, 6],
  ['SHO-RUN-M9', 'Court Shoes Men UK 9', 'SHOE', 549900, 1, 3],
  ['SHO-RUN-M10', 'Court Shoes Men UK 10', 'SHOE', 549900, 6, 3],
  ['SHO-RUN-W6', 'Court Shoes Women UK 6', 'SHOE', 499900, 7, 3],
  ['SHO-RUN-W7', 'Court Shoes Women UK 7', 'SHOE', 499900, 5, 3],
  ['SHO-JR-4', 'Junior Court Shoes UK 4', 'SHOE', 349900, 8, 3],
  ['ACC-GRIP-3', 'Overgrip (pack of 3)', 'ACCESSORY', 29900, 60, 15],
  ['ACC-BAND', 'Wrist Band Pair', 'ACCESSORY', 19900, 45, 10],
  ['ACC-BAG', 'Racket Bag 6-pack', 'ACCESSORY', 349900, 11, 3],
  ['ACC-BOTTLE', 'Club Water Bottle', 'ACCESSORY', 39900, 50, 10],
  ['ACC-TOWEL', 'Sports Towel', 'ACCESSORY', 24900, 35, 10],
  ['ACC-CAP', 'Club Cap', 'ACCESSORY', 29900, 30, 8],
  ['APP-TEE-M', 'Club T-Shirt Men', 'APPAREL', 129900, 25, 6],
  ['APP-TEE-W', 'Club T-Shirt Women', 'APPAREL', 129900, 22, 6],
  ['APP-SHORT-M', 'Sports Shorts Men', 'APPAREL', 149900, 18, 5],
  ['APP-SKIRT-W', 'Tennis Skirt Women', 'APPAREL', 159900, 12, 4],
  ['APP-JKT', 'Club Track Jacket', 'APPAREL', 249900, 9, 3],
  ['APP-SOCK-3', 'Sports Socks (pack of 3)', 'APPAREL', 49900, 40, 10],
];

type MenuRow = [name: string, category: 'DRINK' | 'FOOD' | 'SNACK', station: 'BAR' | 'KITCHEN', pricePaise: number];
const MENU: MenuRow[] = [
  ['Masala Chai', 'DRINK', 'BAR', 6000],
  ['Filter Coffee', 'DRINK', 'BAR', 8000],
  ['Cold Coffee', 'DRINK', 'BAR', 14000],
  ['Fresh Lime Soda', 'DRINK', 'BAR', 9000],
  ['Mango Shake', 'DRINK', 'BAR', 16000],
  ['Tender Coconut Water', 'DRINK', 'BAR', 10000],
  ['Energy Drink', 'DRINK', 'BAR', 15000],
  ['Craft Beer Pint', 'DRINK', 'BAR', 35000],
  ['House Cocktail', 'DRINK', 'BAR', 45000],
  ['Mocktail of the Day', 'DRINK', 'BAR', 22000],
  ['Veg Sandwich', 'FOOD', 'KITCHEN', 14000],
  ['Chicken Club Sandwich', 'FOOD', 'KITCHEN', 22000],
  ['Paneer Tikka Wrap', 'FOOD', 'KITCHEN', 20000],
  ['Chicken Burger', 'FOOD', 'KITCHEN', 24000],
  ['Margherita Pizza', 'FOOD', 'KITCHEN', 28000],
  ['Pasta Arrabbiata', 'FOOD', 'KITCHEN', 26000],
  ['Egg Fried Rice', 'FOOD', 'KITCHEN', 21000],
  ['Dal Rice Bowl', 'FOOD', 'KITCHEN', 18000],
  ['Fruit Salad', 'SNACK', 'KITCHEN', 12000],
  ['French Fries', 'SNACK', 'KITCHEN', 13000],
  ['Peri Peri Fries', 'SNACK', 'KITCHEN', 15000],
  ['Samosa (2 pcs)', 'SNACK', 'KITCHEN', 8000],
  ['Chicken Nuggets', 'SNACK', 'KITCHEN', 19000],
  ['Nachos with Salsa', 'SNACK', 'KITCHEN', 17000],
  ['Protein Bar', 'SNACK', 'BAR', 9000],
];

const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Ishaan', 'Kabir', 'Rohan', 'Siddharth', 'Neha', 'Priya', 'Ananya', 'Diya', 'Kavya', 'Meera', 'Riya', 'Sana', 'Tara', 'Zoya', 'Nikhil', 'Rahul'];
const LAST_NAMES = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Mehta', 'Khan', 'Singh', 'Das'];

const EMPLOYEES = [
  { email: 'owner@courtos.test', fullName: 'Demo Owner', position: 'Club Owner', department: 'MANAGEMENT', salary: 15000000, demoRole: 'OWNER' },
  { email: 'desk@courtos.test', fullName: 'Demo Front Desk', position: 'Front Desk Executive', department: 'FRONT_DESK', salary: 2800000, demoRole: 'FRONT_DESK' },
  { email: 'bar@courtos.test', fullName: 'Demo Bar Staff', position: 'Bartender', department: 'BAR', salary: 2400000, demoRole: 'BAR_STAFF' },
  { email: 'coach@courtos.test', fullName: 'Karan Malhotra', position: 'Head Coach', department: 'COACHING', salary: 4500000, demoRole: null },
  { email: 'ground@courtos.test', fullName: 'Ramesh Yadav', position: 'Groundskeeper', department: 'MAINTENANCE', salary: 1800000, demoRole: null },
] as const;

/** Adds `days` to a YYYY-MM-DD date string (timezone-free calendar arithmetic). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function clubToday(): string {
  const tz = process.env.CLUB_TIMEZONE || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

const MEMBER_COUNT = 40;
const TIER_FOR_INDEX = (i: number): 'GOLD' | 'SILVER' | 'JUNIOR' => (i < 12 ? 'GOLD' : i < 28 ? 'SILVER' : 'JUNIOR');
// Days until membership end. Index 0 is the demo member.
const ENDS_IN_DAYS = (i: number): number => {
  if (i === 0) return 60;
  if ([1, 12, 28].includes(i)) return 3; // one per tier ending in 3 days
  if ([2, 13, 29].includes(i)) return 20; // one per tier ending in 20 days
  return 25 + ((i * 7) % 60);
};

export async function seedCourtOs(db: DatabaseInstance, options: SeedCourtOsOptions = {}): Promise<void> {
  const today = options.today ?? clubToday();
  const demoPassword = options.demoPassword?.trim() ? options.demoPassword : null;

  // 1. Plans
  for (const p of PLANS) {
    await db.insert(plans).values(p).onConflictDoNothing({ target: plans.code });
  }

  // 1b. Product and menu categories
  for (const c of DEFAULT_CATEGORIES) {
    await db.insert(categories).values(c).onConflictDoNothing({ target: [categories.scope, categories.code] });
  }

  // 2. Court types and courts
  for (const t of COURT_TYPES) {
    await db.insert(courtTypes).values(t).onConflictDoNothing({ target: courtTypes.code });
  }
  const typeRows = await db.select({ id: courtTypes.id, code: courtTypes.code }).from(courtTypes);
  const typeId = new Map(typeRows.map((r) => [r.code, r.id]));
  for (const [i, [code, name]] of COURTS.entries()) {
    const courtTypeId = typeId.get(code);
    if (!courtTypeId) throw new Error(`[DB] Unknown court type ${code}`);
    await db.insert(courts).values({ courtTypeId, name, sortOrder: i + 1 }).onConflictDoNothing({ target: courts.name });
  }

  // 3. Friday 18:00-22:00 social window (ISO weekday 5)
  const [window] = await db
    .select({ id: socialWindows.id })
    .from(socialWindows)
    .where(and(eq(socialWindows.weekday, 5), eq(socialWindows.startsTime, '18:00'), eq(socialWindows.endsTime, '22:00')))
    .limit(1);
  if (!window) {
    await db.insert(socialWindows).values({ weekday: 5, startsTime: '18:00', endsTime: '22:00' });
  }

  // 4. Settings (never overwrite values the Owner has edited)
  for (const s of SETTINGS) {
    await db.insert(systemSettings).values({ key: s.key, value: s.value, description: s.description }).onConflictDoNothing({ target: systemSettings.key });
  }

  // 5. Products
  for (const [sku, name, category, pricePaise, stockQty, reorderLevel] of PRODUCTS) {
    await db.insert(products).values({ sku, name, category, pricePaise, stockQty, reorderLevel }).onConflictDoNothing({ target: products.sku });
  }

  // 6. Menu items (no unique constraint on name, so check-then-insert)
  const existingMenu = new Set((await db.select({ name: menuItems.name }).from(menuItems)).map((r) => r.name));
  for (const [i, [name, category, station, pricePaise]] of MENU.entries()) {
    if (existingMenu.has(name)) continue;
    await db.insert(menuItems).values({ name, category, station, pricePaise, sortOrder: i + 1 });
  }

  // 7. Bar tables T1..T10
  for (let i = 1; i <= 10; i++) {
    await db.insert(barTables).values({ name: `T${i}`, seats: i <= 6 ? 4 : i <= 9 ? 6 : 8 }).onConflictDoNothing({ target: barTables.name });
  }

  // 8. Demo users (one per role). Skipped, not failed, without SEED_DEMO_PASSWORD.
  const demoUserIds = new Map<string, string>();
  if (!demoPassword) {
    console.warn('[DB] ⚠️ SEED_DEMO_PASSWORD is not set; skipping demo users (owner, desk, bar, member).');
  } else {
    let passwordHash: string | null = null; // hashed lazily, only if a user must be created
    for (const demo of DEMO_USERS) {
      let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, demo.email)).limit(1);
      if (!user) {
        passwordHash ??= await hashPassword(demoPassword);
        [user] = await db
          .insert(users)
          .values({ email: demo.email, name: demo.name, passwordHash, status: 'ACTIVE', identityType: 'EXTERNAL_USER' })
          .returning({ id: users.id });
      }
      const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, demo.role)).limit(1);
      if (!role) throw new Error(`[DB] Role ${demo.role} not found; seed IAM roles before CourtOS demo data.`);
      await db.insert(userRoles).values({ userId: user.id, roleId: role.id }).onConflictDoNothing();
      demoUserIds.set(demo.email, user.id);
    }
    log('✅ Demo users ensured (owner, desk, bar, member).');
  }

  // 9. Employees (natural key: email). Linked to the demo login when one exists.
  for (const e of EMPLOYEES) {
    const userId = demoUserIds.get(e.email) ?? null;
    const [existing] = await db.select({ id: employees.id, userId: employees.userId }).from(employees).where(eq(employees.email, e.email)).limit(1);
    if (!existing) {
      await db.insert(employees).values({
        userId,
        fullName: e.fullName,
        email: e.email,
        position: e.position,
        department: e.department,
        monthlySalaryPaise: e.salary,
        hiredOn: addDays(today, -400),
      });
    } else if (!existing.userId && userId) {
      await db.update(employees).set({ userId }).where(eq(employees.id, existing.id));
    }
  }

  // 10. Members (natural key: member_code) and one membership each
  const planRows = await db.select({ id: plans.id, code: plans.code }).from(plans);
  const planId = new Map(planRows.map((r) => [r.code, r.id]));
  const demoMemberUserId = demoUserIds.get('member@courtos.test') ?? null;

  for (let i = 0; i < MEMBER_COUNT; i++) {
    const memberCode = `CC-${String(i + 1).padStart(6, '0')}`;
    const tier = TIER_FOR_INDEX(i);
    const isDemo = i === 0;
    const fullName = isDemo ? 'Demo Member' : `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 3) % LAST_NAMES.length]}`;
    const dateOfBirth = tier === 'JUNIOR' ? addDays(today, -365 * (10 + (i % 7)) - 120) : addDays(today, -365 * (22 + (i % 25)) - 45);

    let [member] = await db.select({ id: members.id, userId: members.userId }).from(members).where(eq(members.memberCode, memberCode)).limit(1);
    if (!member) {
      [member] = await db
        .insert(members)
        .values({
          memberCode,
          fullName,
          phone: `9876${String(500000 + i).padStart(6, '0')}`,
          email: isDemo ? 'member@courtos.test' : `member${i + 1}@example.com`,
          dateOfBirth,
          userId: isDemo ? demoMemberUserId : null,
        })
        .returning({ id: members.id, userId: members.userId });
    } else if (isDemo && demoMemberUserId && !member.userId) {
      await db.update(members).set({ userId: demoMemberUserId }).where(eq(members.id, member.id));
    }

    const [hasMembership] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.memberId, member.id)).limit(1);
    if (!hasMembership) {
      const endsOn = addDays(today, ENDS_IN_DAYS(i));
      const pid = planId.get(tier);
      if (!pid) throw new Error(`[DB] Plan ${tier} missing`);
      const [membership] = await db
        .insert(memberships)
        .values({ memberId: member.id, planId: pid, status: 'ACTIVE', startsOn: addDays(endsOn, -30), endsOn })
        .returning({ id: memberships.id });
      await db.insert(membershipEvents).values({ membershipId: membership.id, memberId: member.id, type: 'CREATED', toPlanId: pid, note: 'Demo seed' });
    }
  }
  // Keep member_code_seq ahead of the seeded codes so new registrations never collide.
  await db.execute(sql`SELECT setval('member_code_seq', GREATEST((SELECT last_value FROM member_code_seq), ${MEMBER_COUNT}::bigint))`);

  log('✅ CourtOS demo data seeded (plans, courts, products, menu, tables, employees, members).');
}

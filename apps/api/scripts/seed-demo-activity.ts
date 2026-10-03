/**
 * Fills a development database with realistic CourtOS activity so every screen has data to test:
 * bookings, trials, shop and bar sales, invoices, shifts, leave, leads and two weeks of payments.
 *
 * Almost everything goes through the real API (`app.inject`), so each row passes the same
 * validation, permission and business rules as production traffic. Only history that the API
 * refuses to create (past bookings and shifts, older payments) is inserted directly.
 *
 * Requires the base seed with demo users (`SEED_DEMO_PASSWORD` set, then `pnpm db:seed`).
 * Safe to re-run: it stops when invoices already exist. Pass `--force` to add another batch.
 *
 *   pnpm db:seed:activity
 */
import { eq } from 'drizzle-orm';
import { bookings, courtOccupancies, courts, employees, getDb, members, payments, staffShifts, users } from '@packages/db';
import { buildApp } from '../src/app.js';
import { addDays, clubDateOf, clubWallTimeToInstant } from '../src/services/time.js';

const TZ = process.env.CLUB_TIMEZONE ?? 'Asia/Kolkata';
const PASSWORD = process.env.SEED_DEMO_PASSWORD;
const FORCE = process.argv.includes('--force');
const HOUR = 3_600_000;

if (!PASSWORD) {
  console.error('SEED_DEMO_PASSWORD is not set. Set it (it is read from .env) and run `pnpm db:seed` first.');
  process.exit(1);
}

const app = buildApp();
await app.ready();
const db = getDb();

let ipCounter = 0;
const nextIp = () => `10.99.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

type Actor = { name: string; cookie: string };
type Result = { status: number; json: any };

async function call(actor: Actor | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object): Promise<Result> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: nextIp(),
    headers: actor ? { cookie: actor.cookie } : undefined,
    payload,
  });
  let json: unknown = null;
  try {
    json = res.json();
  } catch {
    json = res.body;
  }
  return { status: res.statusCode, json };
}

/** A call that must succeed; anything else is reported with the server's message. */
async function must(actor: Actor | null, method: Parameters<typeof call>[1], url: string, payload?: object) {
  const res = await call(actor, method, url, payload);
  if (res.status >= 300) throw new Error(`${method} ${url} -> ${res.status} ${res.json?.code ?? ''} ${res.json?.message ?? JSON.stringify(res.json)}`);
  return res.json;
}

let failures = 0;
async function step(title: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    console.log(`  ok   ${title}${note ? `: ${note}` : ''}`);
  } catch (error) {
    failures += 1;
    const cause = (error as { cause?: { message?: string } } | undefined)?.cause?.message;
    console.warn(`  FAIL ${title}: ${error instanceof Error ? error.message.split(String.fromCharCode(10))[0].slice(0, 160) : String(error)}${cause ? ` [${cause}]` : ''}`);
  }
}

async function login(email: string, name: string): Promise<Actor> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`Cannot sign in as ${email} (${res.statusCode}). Run \`pnpm db:seed\` with SEED_DEMO_PASSWORD set first.`);
  return { name, cookie: `app_session=${res.cookies.find((c) => c.name === 'app_session')!.value}` };
}

const today = clubDateOf(new Date(), TZ);
const instantAt = (date: string, hour: number, minute = 0) => clubWallTimeToInstant(date, hour * 60 + minute, TZ);

console.log('Signing in as the demo users...');
const owner = await login('owner@courtos.test', 'owner');
const desk = await login('desk@courtos.test', 'desk');
const bar = await login('bar@courtos.test', 'bar');
const member = await login('member@courtos.test', 'member');

const existing = await call(owner, 'GET', '/invoices?limit=1');
if (!FORCE && existing.json?.meta?.totalItems > 0) {
  console.log('Activity data already exists (invoices found). Re-run with --force to add another batch.');
  await app.close();
  process.exit(0);
}

const [deskUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'desk@courtos.test'));
const [barUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'bar@courtos.test'));
const [deskEmp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, deskUser.id));
const [barEmp] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, barUser.id));
const [demoMember] = await db.select({ id: members.id }).from(members).where(eq(members.email, 'member@courtos.test'));
const memberList = (await must(desk, 'GET', '/members?limit=100')).data as Array<{ id: string; fullName: string; membership: { expiryState: string } | null }>;
const activeMembers = memberList.filter((m) => m.id !== demoMember.id && m.membership && m.membership.expiryState !== 'EXPIRED');
const plans = (await must(desk, 'GET', '/plans')) as Array<{ id: string; code: string }>;
const products = ((await must(desk, 'GET', '/products?limit=100&inStock=true')).data as Array<{ id: string; name: string; stockQty?: number }>).filter((p) => (p.stockQty ?? 0) >= 8);
const menu = (await must(bar, 'GET', '/bar/menu')) as Array<{ id: string; name: string; isAvailable: boolean }>;

console.log('\nBusiness clients and invoices');
let acme = '';
let globex = '';
await step('business clients', async () => {
  acme = (await must(desk, 'POST', '/business-clients', { companyName: 'Acme Sports Pvt Ltd', contactName: 'Priya Nair', email: 'accounts@acme-sports.example', phone: '9810011223', gstin: '29ABCDE1234F1Z5', billingAddress: '12 MG Road, Bengaluru' })).id;
  globex = (await must(desk, 'POST', '/business-clients', { companyName: 'Globex Corporate Wellness', contactName: 'Ravi Kapoor', email: 'ops@globex.example', phone: '9810099887' })).id;
  return '2 created';
});
await step('invoices (sent, overdue, paid, draft)', async () => {
  const send = (id: string) => must(desk, 'POST', `/invoices/${id}/send`);
  const sentMember = await must(desk, 'POST', '/invoices', { memberId: demoMember.id, issueDate: today, dueDate: addDays(today, 10), lines: [{ description: 'Private coaching, 4 sessions', qty: 4, unitPricePaise: 120000 }, { description: 'Racket restringing', qty: 1, unitPricePaise: 90000 }] });
  await send(sentMember.id);
  const overdue = await must(desk, 'POST', '/invoices', { businessClientId: acme, issueDate: addDays(today, -40), dueDate: addDays(today, -25), lines: [{ description: 'Corporate court booking, 10 hours', qty: 10, unitPricePaise: 80000 }], notes: 'Net 15 days' });
  await send(overdue.id);
  await must(desk, 'POST', `/invoices/${overdue.id}/pay`, { method: 'UPI', amountPaise: 300000, reference: 'UPI-ACME-001' });
  const paid = await must(desk, 'POST', '/invoices', { businessClientId: globex, issueDate: addDays(today, -5), dueDate: addDays(today, 10), lines: [{ description: 'Team building day', qty: 1, unitPricePaise: 1500000 }] });
  await send(paid.id);
  await must(desk, 'POST', `/invoices/${paid.id}/pay`, { method: 'CARD' });
  await must(desk, 'POST', '/invoices', { businessClientId: globex, dueDate: addDays(today, 15), lines: [{ description: 'Quarterly membership block, 5 staff', qty: 5, unitPricePaise: 450000 }] });
  return '4 created (1 sent, 1 part-paid and overdue, 1 paid, 1 draft)';
});

console.log('\nBookings');
async function freeSlots(date: string, memberId?: string) {
  const query = memberId ? `?date=${date}&memberId=${memberId}` : `?date=${date}`;
  const availability = await must(desk, 'GET', `/courts/availability${query}`);
  const slots: Array<{ courtId: string; startsAt: string }> = [];
  for (const court of availability.courts as Array<{ courtId: string; mode?: string; slots: Array<{ startsAt: string; status: string }> }>) {
    if (court.mode === 'SOCIAL') continue;
    for (const slot of court.slots) if (slot.status === 'FREE') slots.push({ courtId: court.courtId, startsAt: slot.startsAt });
  }
  return slots;
}
const created: Array<{ id: string; memberId: string }> = [];
await step('desk bookings for members (some paid)', async () => {
  const pays = [{ method: 'UPI' }, undefined, { method: 'CASH' }, undefined, { method: 'CARD' }, undefined];
  for (let i = 0; i < pays.length; i += 1) {
    const person = activeMembers[i];
    // Members without a valid plan can only book 2 days ahead, so keep every date within that.
    const date = addDays(today, 1 + (i % 2));
    const slots = await freeSlots(date, person.id);
    const slot = slots[(i * 7) % Math.max(1, slots.length)];
    const booking = await must(desk, 'POST', '/bookings', { ...slot, memberId: person.id, channel: 'DESK', ...(pays[i] ? { payNow: pays[i] } : {}) });
    created.push({ id: booking.id, memberId: person.id });
  }
  return `${pays.length} created`;
});
await step('walk-in guest booking', async () => {
  const slots = await freeSlots(addDays(today, 1));
  await must(desk, 'POST', '/bookings', { ...slots[slots.length - 3], guest: { name: 'Riya Patel', phone: '9811122233' }, channel: 'PHONE' });
});
await step('demo member books online, then a second slot', async () => {
  const slots = await freeSlots(addDays(today, 2), demoMember.id);
  await must(member, 'POST', '/bookings', { ...slots[2] });
  await must(member, 'POST', '/bookings', { ...slots[slots.length - 5] });
  return '2 upcoming for member@courtos.test';
});
await step('a cancelled booking (desk cancels)', async () => {
  await must(desk, 'POST', `/bookings/${created[1].id}/cancel`, { reason: 'Member asked to cancel' });
});
await step('website trial booking', async () => {
  const slots = (await must(null, 'GET', `/public/availability?date=${addDays(today, 3)}`)).courts as Array<{ courtId: string; slots: Array<{ startsAt: string; status: string }> }>;
  const free = slots.flatMap((c) => c.slots.filter((s) => s.status === 'FREE').map((s) => ({ courtId: c.courtId, startsAt: s.startsAt })));
  await must(null, 'POST', '/public/trial-bookings', { ...free[4], name: 'Arjun Verma', phone: '9822233344', email: 'arjun.verma@example.com' });
});
await step('past bookings for the demo member (history)', async () => {
  const [court] = await db.select({ id: courts.id }).from(courts).where(eq(courts.isActive, true)).limit(1);
  const plan = [
    { daysAgo: 2, hour: 7, status: 'COMPLETED' as const, price: 0 },
    { daysAgo: 6, hour: 18, status: 'COMPLETED' as const, price: 0 },
    { daysAgo: 9, hour: 19, status: 'NO_SHOW' as const, price: 0 },
  ];
  for (const item of plan) {
    const date = addDays(today, -item.daysAgo);
    const startsAt = instantAt(date, item.hour);
    const endsAt = new Date(startsAt.getTime() + HOUR);
    const [row] = await db
      .insert(bookings)
      .values({ courtId: court.id, memberId: demoMember.id, startsAt, endsAt, bookingDate: date, status: item.status, basePricePaise: 80000, discountPct: 100, pricePaise: item.price, paymentStatus: 'WAIVED', channel: 'ONLINE' })
      .returning({ id: bookings.id });
    await db.insert(courtOccupancies).values({ courtId: court.id, startsAt, endsAt, kind: 'BOOKING', bookingId: row.id });
  }
  return '3 past rows (2 completed, 1 no-show)';
});

console.log('\nShop and bar');
await step('counter sales (front desk)', async () => {
  const sale = (items: number[], extra: object) => must(desk, 'POST', '/orders/pos', { items: items.map((i) => ({ productId: products[i].id, qty: 1 + (i % 2) })), ...extra });
  await sale([0, 1], { paymentMethod: 'CASH', customerName: 'Walk-in customer' });
  await sale([2, 3, 4], { paymentMethod: 'UPI', memberId: activeMembers[0].id });
  await sale([5], { paymentMethod: 'CARD' });
  await sale([6, 7], { paymentMethod: 'UPI', memberId: demoMember.id });
  return '4 orders';
});
await step('online pickup order from the demo member', async () => {
  const order = await must(member, 'POST', '/orders/online', { items: [{ productId: products[8].id, qty: 1 }, { productId: products[9].id, qty: 2 }], fulfilment: 'PICKUP', payNow: { method: 'UPI' } });
  await must(desk, 'PATCH', `/orders/${order.id}/status`, { status: 'READY' });
  await must(member, 'POST', '/orders/online', { items: [{ productId: products[10].id, qty: 1 }], fulfilment: 'DELIVERY', deliveryAddress: 'Flat 4B, Palm Residency, Indiranagar' });
  return '1 ready for pickup, 1 placed for delivery';
});
await step('bar tabs (open, settled, in the kitchen)', async () => {
  const items = menu.filter((m) => m.isAvailable);
  const tab = async (name: string, picks: Array<[number, number]>) => {
    const t = await must(bar, 'POST', '/bar/tabs', { guestName: name });
    for (const [i, qty] of picks) await must(bar, 'POST', `/bar/tabs/${t.id}/items`, { menuItemId: items[i].id, qty });
    return t.id as string;
  };
  const settled = await tab('Table 3, birthday group', [[0, 4], [3, 2], [6, 1]]);
  await must(bar, 'POST', `/bar/tabs/${settled}/send`);
  await must(bar, 'POST', `/bar/tabs/${settled}/settle`, { payments: [{ method: 'UPI', reference: 'UPI-BAR-4821' }] });
  const kitchen = await tab('Table 5', [[1, 2], [7, 1]]);
  await must(bar, 'POST', `/bar/tabs/${kitchen}/send`);
  await tab('Counter, Karan', [[2, 1]]);
  const tickets = (await must(bar, 'GET', '/bar/tickets')) as Array<{ id: string; status: string }>;
  const fresh = tickets.find((t) => t.status === 'NEW');
  if (fresh) await must(bar, 'PATCH', `/bar/tickets/${fresh.id}/status`, { status: 'PREPARING' });
  return '1 settled, 1 in the kitchen, 1 open';
});

console.log('\nStaff: shifts and leave');
await step('shifts (running now, upcoming)', async () => {
  const start = new Date(Date.now() - HOUR);
  const mk = (employeeId: string, startsAt: Date, hours: number, roleLabel: string) =>
    must(owner, 'POST', '/shifts', { employeeId, roleLabel, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + hours * HOUR).toISOString() });
  const running = await mk(barEmp.id, start, 8, 'BAR');
  await must(bar, 'POST', `/shifts/${running.id}/clock-in`);
  await mk(deskEmp.id, new Date(Date.now() + 2 * HOUR), 6, 'FRONT_DESK');
  await mk(barEmp.id, instantAt(addDays(today, 1), 16), 8, 'BAR');
  await mk(deskEmp.id, instantAt(addDays(today, 1), 7), 8, 'FRONT_DESK');
  return 'bar is clocked in now; desk starts in 2 hours';
});
await step('past shifts (completed)', async () => {
  for (const [empId, role] of [[barEmp.id, 'BAR'], [deskEmp.id, 'FRONT_DESK']] as const) {
    for (const daysAgo of [1, 2, 3]) {
      const startsAt = instantAt(addDays(today, -daysAgo), role === 'BAR' ? 16 : 7);
      await db.insert(staffShifts).values({ employeeId: empId, roleLabel: role, startsAt, endsAt: new Date(startsAt.getTime() + 8 * HOUR), clockInAt: new Date(startsAt.getTime() + 4 * 60_000), clockOutAt: new Date(startsAt.getTime() + 8 * HOUR + 12 * 60_000) });
    }
  }
  return '6 completed shifts';
});
await step('leave requests (pending, approved, rejected)', async () => {
  await must(bar, 'POST', '/me/leave', { leaveType: 'CASUAL', fromDate: addDays(today, 7), toDate: addDays(today, 8), reason: 'Family function' });
  const sick = await must(desk, 'POST', '/me/leave', { leaveType: 'SICK', fromDate: addDays(today, 14), toDate: addDays(today, 15), reason: 'Dental procedure' });
  await must(owner, 'POST', `/hr/leave/${sick.id}/decision`, { decision: 'APPROVED', note: 'Get well soon' });
  const paid = await must(desk, 'POST', '/me/leave', { leaveType: 'PAID', fromDate: addDays(today, 30), toDate: addDays(today, 34), reason: 'Holiday' });
  await must(owner, 'POST', `/hr/leave/${paid.id}/decision`, { decision: 'REJECTED', note: 'Tournament week, please pick another date' });
  return '1 pending, 1 approved, 1 rejected';
});

console.log('\nLeads');
await step('leads across the funnel', async () => {
  const lead = (data: object) => must(desk, 'POST', '/crm/leads', data);
  const silver = plans.find((p) => p.code === 'SILVER')!;
  await lead({ name: 'Meera Joshi', phone: '9833344455', source: 'WALK_IN', interestedPlanId: silver.id, message: 'Asked about junior coaching for her daughter' });
  const contacted = await lead({ name: 'Sameer Khan', phone: '9833355566', email: 'sameer.khan@example.com', source: 'PHONE' });
  await must(desk, 'PATCH', `/crm/leads/${contacted.id}`, { status: 'CONTACTED' });
  const lost = await lead({ name: 'Tanya Bose', email: 'tanya.bose@example.com', source: 'REFERRAL', message: 'Referred by a member' });
  await must(desk, 'PATCH', `/crm/leads/${lost.id}`, { status: 'LOST', lostReason: 'Joined a club closer to home' });
  const win = await lead({ name: 'Vikram Rao', phone: '9833377788', source: 'WALK_IN', interestedPlanId: silver.id });
  await must(desk, 'POST', `/crm/leads/${win.id}/convert`, { planId: silver.id, paymentMethod: 'UPI' });
  await must(null, 'POST', '/public/enquiries', { name: 'Neha Iyer', email: 'neha.iyer@example.com', message: 'Do you run weekend padel coaching for beginners?', interestedPlanId: silver.id });
  return '5 leads (new, contacted, lost, converted to a member, website enquiry)';
});

console.log('\nTwo weeks of ledger history for the owner dashboard');
await step('historical payments', async () => {
  const rows: Array<typeof payments.$inferInsert> = [];
  const sources = [
    { source: 'COURT' as const, base: 90000, spread: 5 },
    { source: 'SHOP' as const, base: 35000, spread: 4 },
    { source: 'BAR' as const, base: 28000, spread: 6 },
    { source: 'MEMBERSHIP' as const, base: 150000, spread: 2 },
  ];
  const methods = ['CASH', 'UPI', 'CARD', 'UPI'] as const;
  for (let daysAgo = 14; daysAgo >= 1; daysAgo -= 1) {
    const date = addDays(today, -daysAgo);
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    sources.forEach((s, si) => {
      for (let n = 0; n < s.spread * (weekend ? 2 : 1); n += 1) {
        const amount = Math.round((s.base * (0.6 + ((daysAgo * 7 + n * 13 + si * 5) % 9) / 10)) / 100) * 100;
        rows.push({ source: s.source, kind: 'PAYMENT', amountPaise: amount, method: methods[(daysAgo + n + si) % methods.length], paidAt: instantAt(date, 7 + ((n * 3 + si) % 14), (n * 7) % 60) });
      }
    });
    if (daysAgo % 5 === 0) rows.push({ source: 'COURT', kind: 'REFUND', amountPaise: -60000, method: 'UPI', paidAt: instantAt(date, 12, 30) });
  }
  await db.insert(payments).values(rows);
  return `${rows.length} ledger rows`;
});

await app.close();
console.log(failures ? `\nFinished with ${failures} failed step(s); see FAIL lines above.` : '\nDone. Every step succeeded.');
process.exit(failures ? 1 : 0);


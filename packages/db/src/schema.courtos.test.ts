import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;

// Never migrate, truncate, or drop the configured application database. The supplied
// connection is only used to provision a uniquely named disposable test database.
describe.skipIf(!databaseUrl)('CourtOS database integrity', () => {
  const databaseName = `courtos_test_${randomUUID().replaceAll('-', '')}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let created = false;
  let isolatedDatabaseUrl: string;
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.pathname = `/${databaseName}`;
    isolatedDatabaseUrl = isolatedUrl.toString();
    sql = postgres(isolatedDatabaseUrl, { max: 20, onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder });
    await migrate(drizzle(sql), { migrationsFolder });
  });

  afterAll(async () => {
    if (sql) await sql.end();
    if (created) await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    if (admin) await admin.end();
  });

  async function court() {
    const [type] = await sql`INSERT INTO court_types (code, name, base_rate_paise, social_fee_paise, trial_fee_paise)
      VALUES (${randomUUID().slice(0, 32)}, 'Test sport', 60000, 10000, 19900) RETURNING id`;
    const [row] = await sql`INSERT INTO courts (court_type_id, name) VALUES (${type.id}, ${randomUUID()}) RETURNING id`;
    return row.id as string;
  }

  async function member() {
    const [row] = await sql`INSERT INTO members (member_code, full_name, phone)
      VALUES (${randomUUID().slice(0, 16)}, 'Test member', '9000000000') RETURNING id`;
    return row.id as string;
  }

  async function employee() {
    const [row] = await sql`INSERT INTO employees (full_name, position, department, hired_on)
      VALUES ('Test employee', 'Desk', 'FRONT_DESK', '2026-01-01') RETURNING id`;
    return row.id as string;
  }

  it('applies four migrations exactly once and keeps existing foundation tables', async () => {
    const [count] = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    expect(count.count).toBe(4);
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    expect(rows).toHaveLength(47); // 14 foundation tables plus 33 domain tables.
    expect(rows.map((row) => row.tablename)).toEqual(expect.arrayContaining(['users', 'system_settings', 'bookings', 'payments']));
    const sequences = await sql`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`;
    expect(sequences.map((row) => row.sequencename)).toEqual(expect.arrayContaining([
      'member_code_seq', 'invoice_number_seq', 'order_number_seq', 'tab_number_seq',
    ]));
  });

  it('rejects overlapping court use across kinds but permits adjacent half-open slots and other courts', async () => {
    const courtId = await court();
    await sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', 'BOOKING')`;
    await expect(sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, '2026-10-09T18:30:00Z', '2026-10-09T19:30:00Z', 'MAINTENANCE')`).rejects.toMatchObject({ code: '23P01' });
    await sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, '2026-10-09T19:00:00Z', '2026-10-09T20:00:00Z', 'BOOKING')`;
    await sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${await court()}, '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', 'BOOKING')`;
  });

  it('allows exactly one of twenty concurrent attempts to occupy the same court', async () => {
    const courtId = await court();
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => sql`
      INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', 'BOOKING')`));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = attempts.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(19);
    for (const result of failures) expect(result.reason).toMatchObject({ code: '23P01' });
  });

  it.each([
    ['BOOKING', '18:00:00', '18:45:00'],
    ['BOOKING', '18:15:00', '19:15:00'],
    ['BOOKING', '18:00:00.001', '19:00:00.001'],
    ['SOCIAL', '18:00:00', '19:00:00'],
    ['MAINTENANCE', '19:00:00', '18:00:00'],
  ])('rejects malformed %s occupancy %s to %s', async (kind, start, end) => {
    await expect(sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${await court()}, ${`2026-10-09T${start}Z`}, ${`2026-10-09T${end}Z`}, ${kind})`).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts 18:00 IST social play and rejects a club-local half-hour start', async () => {
    const courtId = await court();
    await sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, '2026-10-09T12:30:00Z', '2026-10-09T13:30:00Z', 'SOCIAL')`;
    await expect(sql`INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${await court()}, '2026-10-09T13:00:00Z', '2026-10-09T14:00:00Z', 'SOCIAL')`).rejects.toMatchObject({ code: '23514' });
  });

  it('prevents a member booking overlapping sessions on different courts while permitting cancellation', async () => {
    const memberId = await member();
    const insert = (courtId: string, status: string) => sql`INSERT INTO bookings
      (court_id, member_id, starts_at, ends_at, booking_date, base_price_paise, price_paise, status)
      VALUES (${courtId}, ${memberId}, '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', '2026-10-09', 60000, 60000, ${status})`;
    await insert(await court(), 'CONFIRMED');
    await expect(insert(await court(), 'NO_SHOW')).rejects.toMatchObject({ code: '23P01' });
    await insert(await court(), 'CANCELLED');
  });

  it('rejects negative stock', async () => {
    await expect(sql`INSERT INTO products (sku, name, category, price_paise, stock_qty)
      VALUES (${randomUUID()}, 'Test racket', 'RACKET', 10000, -1)`).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects invalid domain statuses that could bypass partial indexes', async () => {
    await expect(sql`INSERT INTO payments (source, amount_paise, method)
      VALUES ('UNKNOWN', 60000, 'CASH')`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO bookings
      (court_id, guest_name, starts_at, ends_at, booking_date, base_price_paise, price_paise, status)
      VALUES (${await court()}, 'Guest', '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', '2026-10-09', 60000, 60000, 'INVALID')`).rejects.toMatchObject({ code: '23514' });
  });

  it('permits only one active membership and rejects invalid plan discounts', async () => {
    const memberId = await member();
    const [plan] = await sql`INSERT INTO plans (code, name, monthly_fee_paise)
      VALUES (${randomUUID().slice(0, 32)}, 'Test plan', 10000) RETURNING id`;
    const insert = (status: string) => sql`INSERT INTO memberships (member_id, plan_id, starts_on, ends_on, status)
      VALUES (${memberId}, ${plan.id}, '2026-10-01', '2026-10-31', ${status})`;
    await insert('ACTIVE');
    await expect(insert('ACTIVE')).rejects.toMatchObject({ code: '23505' });
    await insert('EXPIRED');
    await expect(sql`UPDATE plans SET court_discount_pct = 101 WHERE id = ${plan.id}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE plans SET bar_discount_pct = -1 WHERE id = ${plan.id}`).rejects.toMatchObject({ code: '23514' });
  });

  it('prevents overlapping shifts and approved inclusive leave dates', async () => {
    const employeeId = await employee();
    await sql`INSERT INTO staff_shifts (employee_id, role_label, starts_at, ends_at)
      VALUES (${employeeId}, 'BAR', '2026-10-09T18:00:00Z', '2026-10-09T20:00:00Z')`;
    await expect(sql`INSERT INTO staff_shifts (employee_id, role_label, starts_at, ends_at)
      VALUES (${employeeId}, 'BAR', '2026-10-09T19:00:00Z', '2026-10-09T21:00:00Z')`).rejects.toMatchObject({ code: '23P01' });
    await sql`INSERT INTO staff_shifts (employee_id, role_label, starts_at, ends_at)
      VALUES (${employeeId}, 'BAR', '2026-10-09T20:00:00Z', '2026-10-09T21:00:00Z')`;
    await sql`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, status)
      VALUES (${employeeId}, 'PAID', '2026-10-10', '2026-10-12', 'APPROVED')`;
    await expect(sql`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, status)
      VALUES (${employeeId}, 'PAID', '2026-10-12', '2026-10-13', 'APPROVED')`).rejects.toMatchObject({ code: '23P01' });
    await sql`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date)
      VALUES (${employeeId}, 'PAID', '2026-10-12', '2026-10-13')`;
    await expect(sql`INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date)
      VALUES (${employeeId}, 'PAID', '2026-10-13', '2026-10-12')`).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects missing contacts, anonymous bookings, zero ledger amounts and missing invoice recipients', async () => {
    await expect(sql`INSERT INTO leads (name, source) VALUES ('No contact', 'WALK_IN')`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO bookings (court_id, starts_at, ends_at, booking_date, base_price_paise, price_paise)
      VALUES (${await court()}, '2026-10-09T18:00:00Z', '2026-10-09T19:00:00Z', '2026-10-09', 60000, 60000)`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO payments (source, amount_paise, method) VALUES ('COURT', 0, 'CASH')`).rejects.toMatchObject({ code: '23514' });
    await sql`INSERT INTO payments (source, kind, amount_paise, method) VALUES ('COURT', 'REFUND', -60000, 'CASH')`;
    await expect(sql`INSERT INTO invoices (invoice_number, issue_date, due_date, subtotal_paise, tax_paise, total_paise)
      VALUES (${randomUUID().slice(0, 24)}, '2026-10-09', '2026-10-10', 10000, 0, 10000)`).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces late-bound foreign keys instead of accepting dangling references', async () => {
    await expect(sql`INSERT INTO payments (source, amount_paise, method, shift_id)
      VALUES ('COURT', 60000, 'CASH', ${randomUUID()})`).rejects.toMatchObject({ code: '23503' });
    await expect(sql`INSERT INTO member_checkins (member_id, booking_id)
      VALUES (${await member()}, ${randomUUID()})`).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects zero and negative item quantities before accepting orphaned line items', async () => {
    await expect(sql`INSERT INTO order_items (order_id, product_id, name_snapshot, qty, unit_price_paise, line_total_paise)
      VALUES (${randomUUID()}, ${randomUUID()}, 'Test product', 0, 10000, 0)`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO tab_items (tab_id, menu_item_id, name_snapshot, qty, unit_price_paise, line_total_paise)
      VALUES (${randomUUID()}, ${randomUUID()}, 'Test menu item', -1, 10000, -10000)`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO invoice_lines (invoice_id, description, qty, unit_price_paise, line_total_paise)
      VALUES (${randomUUID()}, 'Test invoice line', 0, 10000, 0)`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`INSERT INTO invoices
      (invoice_number, member_id, business_client_id, issue_date, due_date, subtotal_paise, tax_paise, total_paise)
      VALUES (${randomUUID().slice(0, 24)}, ${randomUUID()}, ${randomUUID()}, '2026-10-09', '2026-10-10', 10000, 0, 10000)`).rejects.toMatchObject({ code: '23514' });
  });

  it('seeds baseline records twice without duplicate IAM rows or resetting root credentials', async () => {
    const runSeed = () => promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/seed.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl, NODE_ENV: 'test' },
      windowsHide: true,
    });
    const counts = async () => {
      const [row] = await sql`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM permissions) AS permissions,
        (SELECT count(*)::int FROM roles) AS roles,
        (SELECT count(*)::int FROM policies) AS policies,
        (SELECT count(*)::int FROM policy_statements) AS statements,
        (SELECT count(*)::int FROM role_policies) AS role_policies,
        (SELECT count(*)::int FROM system_settings) AS settings`;
      return row;
    };
    await runSeed();
    const firstCounts = await counts();
    const [root] = await sql`SELECT id, password_hash FROM users WHERE identity_type = 'ROOT'`;
    await runSeed();
    expect(await counts()).toEqual(firstCounts);
    const [preserved] = await sql`SELECT id, password_hash FROM users WHERE identity_type = 'ROOT'`;
    expect(preserved).toEqual(root);
  });
});

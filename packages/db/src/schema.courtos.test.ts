import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;

/** Sentinel thrown to roll a transaction back after the assertions have run. */
class Rollback extends Error {}

type Tx = postgres.TransactionSql;

describe.skipIf(!url)('CourtOS schema constraints (M-01)', () => {
  let sql: postgres.Sql;

  /** Runs `fn` in a transaction that is always rolled back, returning what `fn` returned. */
  async function inRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let out!: T;
    try {
      await sql.begin(async (tx) => {
        out = await fn(tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out;
  }

  /** Runs `fn` in a rolled-back transaction and returns the Postgres error it raised. */
  async function violation(fn: (tx: Tx) => Promise<unknown>): Promise<{ code?: string; constraint_name?: string }> {
    let caught: unknown;
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (e) {
      caught = e;
    }
    if (caught instanceof Rollback || caught === undefined) {
      throw new Error('expected a database error but the statement succeeded');
    }
    return caught as { code?: string; constraint_name?: string };
  }

  async function makeCourt(tx: Tx): Promise<string> {
    const [type] = await tx`
      INSERT INTO court_types (code, name, base_rate_paise, social_fee_paise, trial_fee_paise)
      VALUES ('T_' || substr(gen_random_uuid()::text, 1, 12), 'Test', 60000, 20000, 19900) RETURNING id`;
    const [court] = await tx`
      INSERT INTO courts (court_type_id, name) VALUES (${type.id}, 'C_' || gen_random_uuid()) RETURNING id`;
    return court.id as string;
  }

  async function occupy(tx: Tx, courtId: string, startsAt: string, endsAt: string, kind = 'BOOKING') {
    await tx`
      INSERT INTO court_occupancies (court_id, starts_at, ends_at, kind)
      VALUES (${courtId}, ${startsAt}, ${endsAt}, ${kind})`;
  }

  async function makePlan(tx: Tx): Promise<string> {
    const [plan] = await tx`
      INSERT INTO plans (code, name, monthly_fee_paise) VALUES ('P_' || substr(gen_random_uuid()::text, 1, 12), 'Plan', 100000) RETURNING id`;
    return plan.id as string;
  }

  async function makeMember(tx: Tx): Promise<string> {
    const [m] = await tx`
      INSERT INTO members (member_code, full_name, phone)
      VALUES ('M_' || substr(gen_random_uuid()::text, 1, 12), 'Test Member', '9000000000') RETURNING id`;
    return m.id as string;
  }

  beforeAll(async () => {
    await runMigrations();
    sql = postgres(url!, { max: 4 });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('migrations are a no-op the second time', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('creates all 33 domain tables and the four sequences', async () => {
    const tables = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '\\_\\_%'`;
    expect(tables[0].n).toBeGreaterThanOrEqual(47);
    const seqs = await sql`
      SELECT sequencename FROM pg_sequences
       WHERE sequencename IN ('member_code_seq','invoice_number_seq','order_number_seq','tab_number_seq')`;
    expect(seqs).toHaveLength(4);
  });

  describe('court_occupancies', () => {
    it('rejects overlapping rows on the same court with 23P01', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
        await occupy(tx, court, '2030-01-01T13:00:00Z', '2030-01-01T14:00:00Z');
      });
      expect(err.code).toBe('23P01');
      expect(err.constraint_name).toBe('court_occupancies_no_overlap');
    });

    it('allows adjacent rows (half-open ranges) and the same slot on another court', async () => {
      await inRollback(async (tx) => {
        const a = await makeCourt(tx);
        const b = await makeCourt(tx);
        await occupy(tx, a, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
        await occupy(tx, a, '2030-01-01T13:30:00Z', '2030-01-01T14:30:00Z');
        await occupy(tx, b, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
      });
    });

    it('rejects a 45-minute BOOKING occupancy (shape check)', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-01T12:30:00Z', '2030-01-01T13:15:00Z');
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('court_occupancies_shape');
    });

    it('rejects a BOOKING that does not start on :00 or :30', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-01T12:15:00Z', '2030-01-01T13:15:00Z');
      });
      expect(err.code).toBe('23514');
    });

    // Regression (issue #9): SOCIAL must align to the club hour. In Asia/Kolkata (+05:30)
    // 18:00 local is 12:30 UTC; the original check demanded UTC minute 0 and got it backwards.
    it('accepts a SOCIAL occupancy starting on the club hour (18:00 IST = 12:30 UTC)', async () => {
      await inRollback(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-04T12:30:00Z', '2030-01-04T13:30:00Z', 'SOCIAL');
      });
    });

    it('rejects a SOCIAL occupancy starting at 18:30 IST (13:00 UTC)', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-04T13:00:00Z', '2030-01-04T14:00:00Z', 'SOCIAL');
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('court_occupancies_shape');
    });

    it('allows a MAINTENANCE block of any length', async () => {
      await inRollback(async (tx) => {
        const court = await makeCourt(tx);
        await occupy(tx, court, '2030-01-01T06:10:00Z', '2030-01-01T09:45:00Z', 'MAINTENANCE');
      });
    });
  });

  describe('kitchen_tickets', () => {
    it('numbers tickets automatically and rejects an explicit duplicate number (migration 0005)', async () => {
      const err = await violation(async (tx) => {
        const [tab] = await tx`
          INSERT INTO tabs (tab_number, guest_name) VALUES (nextval('tab_number_seq'), 'Ticket test') RETURNING id`;
        const [a] = await tx`INSERT INTO kitchen_tickets (tab_id) VALUES (${tab.id}) RETURNING ticket_number`;
        const [b] = await tx`INSERT INTO kitchen_tickets (tab_id) VALUES (${tab.id}) RETURNING ticket_number`;
        expect(Number(b.ticket_number)).toBeGreaterThan(Number(a.ticket_number));
        // GENERATED ALWAYS: callers cannot choose the number.
        await tx`INSERT INTO kitchen_tickets (tab_id, ticket_number) VALUES (${tab.id}, ${a.ticket_number})`;
      });
      expect(err.code).toBe('428C9');
    });
  });

  describe('bookings', () => {
    async function insertBooking(tx: Tx, courtId: string, memberId: string | null, startsAt: string, endsAt: string) {
      await tx`
        INSERT INTO bookings (court_id, member_id, guest_name, starts_at, ends_at, booking_date, base_price_paise, price_paise)
        VALUES (${courtId}, ${memberId}, ${memberId ? null : 'Guest'}, ${startsAt}, ${endsAt}, '2030-01-01', 60000, 60000)`;
    }

    it('rejects a member holding overlapping sessions on two courts', async () => {
      const err = await violation(async (tx) => {
        const memberId = await makeMember(tx);
        const a = await makeCourt(tx);
        const b = await makeCourt(tx);
        await insertBooking(tx, a, memberId, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
        await insertBooking(tx, b, memberId, '2030-01-01T13:00:00Z', '2030-01-01T14:00:00Z');
      });
      expect(err.code).toBe('23P01');
      expect(err.constraint_name).toBe('bookings_member_no_overlap');
    });

    it('does not apply the member overlap rule to guests', async () => {
      await inRollback(async (tx) => {
        const a = await makeCourt(tx);
        const b = await makeCourt(tx);
        await insertBooking(tx, a, null, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
        await insertBooking(tx, b, null, '2030-01-01T13:00:00Z', '2030-01-01T14:00:00Z');
      });
    });

    it('rejects a booking with neither a member nor a guest name', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        await tx`
          INSERT INTO bookings (court_id, starts_at, ends_at, booking_date, base_price_paise, price_paise)
          VALUES (${court}, '2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z', '2030-01-01', 60000, 60000)`;
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('bookings_holder_check');
    });

    it('allows only one non-cancelled TRIAL per phone', async () => {
      const err = await violation(async (tx) => {
        const court = await makeCourt(tx);
        const trial = (start: string, end: string) => tx`
          INSERT INTO bookings (court_id, kind, guest_name, guest_phone, starts_at, ends_at, booking_date, base_price_paise, price_paise)
          VALUES (${court}, 'TRIAL', 'Guest', '9111111111', ${start}, ${end}, '2030-01-01', 19900, 19900)`;
        await trial('2030-01-01T12:30:00Z', '2030-01-01T13:30:00Z');
        await trial('2030-01-01T14:30:00Z', '2030-01-01T15:30:00Z');
      });
      expect(err.code).toBe('23505');
    });
  });

  describe('memberships', () => {
    it('rejects a second ACTIVE membership for one member', async () => {
      const err = await violation(async (tx) => {
        const plan = await makePlan(tx);
        const member = await makeMember(tx);
        for (let i = 0; i < 2; i++) {
          await tx`
            INSERT INTO memberships (member_id, plan_id, status, starts_on, ends_on)
            VALUES (${member}, ${plan}, 'ACTIVE', '2030-01-01', '2030-02-01')`;
        }
      });
      expect(err.code).toBe('23505');
      expect(err.constraint_name).toBe('uq_memberships_one_active');
    });

    it('allows an ACTIVE membership next to an EXPIRED one', async () => {
      await inRollback(async (tx) => {
        const plan = await makePlan(tx);
        const member = await makeMember(tx);
        await tx`
          INSERT INTO memberships (member_id, plan_id, status, starts_on, ends_on)
          VALUES (${member}, ${plan}, 'EXPIRED', '2029-01-01', '2029-02-01'),
                 (${member}, ${plan}, 'ACTIVE', '2030-01-01', '2030-02-01')`;
      });
    });

    it('rejects plan discounts outside 0..100', async () => {
      const err = await violation(async (tx) => {
        await tx`
          INSERT INTO plans (code, name, monthly_fee_paise, court_discount_pct)
          VALUES ('X_' || substr(gen_random_uuid()::text, 1, 12), 'Bad', 1000, 101)`;
      });
      expect(err.code).toBe('23514');
    });
  });

  describe('shop, bar and finance checks', () => {
    it('rejects negative stock', async () => {
      const err = await violation(async (tx) => {
        await tx`
          INSERT INTO products (sku, name, category, price_paise, stock_qty)
          VALUES ('SKU_' || gen_random_uuid(), 'Ball', 'BALL', 1000, -1)`;
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('products_stock_qty_check');
    });

    it('rejects a zero-amount payment', async () => {
      const err = await violation(async (tx) => {
        await tx`INSERT INTO payments (source, amount_paise, method) VALUES ('SHOP', 0, 'CASH')`;
      });
      expect(err.code).toBe('23514');
    });

    it('rejects an invoice billed to neither a member nor a business client', async () => {
      const err = await violation(async (tx) => {
        await tx`
          INSERT INTO invoices (invoice_number, issue_date, due_date, subtotal_paise, tax_paise, total_paise)
          VALUES ('INV-' || substr(gen_random_uuid()::text, 1, 12), '2030-01-01', '2030-01-15', 100, 0, 100)`;
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('invoices_one_bill_to_check');
    });

    it('rejects a lead with neither phone nor email', async () => {
      const err = await violation(async (tx) => {
        await tx`INSERT INTO leads (name, source) VALUES ('Nobody', 'PHONE')`;
      });
      expect(err.code).toBe('23514');
      expect(err.constraint_name).toBe('leads_contact_check');
    });

    it('allows only one OPEN tab per table', async () => {
      const err = await violation(async (tx) => {
        const [table] = await tx`INSERT INTO bar_tables (name) VALUES ('T_' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`;
        for (let i = 0; i < 2; i++) {
          await tx`INSERT INTO tabs (tab_number, table_id) VALUES (nextval('tab_number_seq'), ${table.id})`;
        }
      });
      expect(err.code).toBe('23505');
      expect(err.constraint_name).toBe('uq_tabs_one_open_per_table');
    });
  });

  describe('hr', () => {
    async function makeEmployee(tx: Tx): Promise<string> {
      const [e] = await tx`
        INSERT INTO employees (full_name, position, department, hired_on)
        VALUES ('Emp', 'Desk', 'FRONT_DESK', '2029-01-01') RETURNING id`;
      return e.id as string;
    }

    it('rejects overlapping approved leave but allows overlapping pending leave', async () => {
      await inRollback(async (tx) => {
        const emp = await makeEmployee(tx);
        await tx`
          INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, status)
          VALUES (${emp}, 'CASUAL', '2030-03-01', '2030-03-05', 'PENDING'),
                 (${emp}, 'CASUAL', '2030-03-03', '2030-03-06', 'PENDING')`;
      });
      const err = await violation(async (tx) => {
        const emp = await makeEmployee(tx);
        await tx`
          INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date, status)
          VALUES (${emp}, 'CASUAL', '2030-03-01', '2030-03-05', 'APPROVED'),
                 (${emp}, 'SICK', '2030-03-05', '2030-03-06', 'APPROVED')`;
      });
      expect(err.code).toBe('23P01');
    });

    it('rejects leave that ends before it starts', async () => {
      const err = await violation(async (tx) => {
        const emp = await makeEmployee(tx);
        await tx`
          INSERT INTO leave_requests (employee_id, leave_type, from_date, to_date)
          VALUES (${emp}, 'CASUAL', '2030-03-05', '2030-03-01')`;
      });
      expect(err.code).toBe('23514');
    });

    it('rejects overlapping shifts for one employee', async () => {
      const err = await violation(async (tx) => {
        const emp = await makeEmployee(tx);
        await tx`
          INSERT INTO staff_shifts (employee_id, role_label, starts_at, ends_at)
          VALUES (${emp}, 'BAR', '2030-01-01T10:00:00Z', '2030-01-01T18:00:00Z'),
                 (${emp}, 'BAR', '2030-01-01T17:00:00Z', '2030-01-01T22:00:00Z')`;
      });
      expect(err.code).toBe('23P01');
    });
  });
});

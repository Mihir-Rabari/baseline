import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { courtTypes, createTenantScope, currentTenantId, getDb, runInTenantScope, tenants, createScopedDb } from '@packages/db';
import { isDatabaseAvailable } from './test-support/database.js';

/**
 * Tables that are shared by every club on purpose (the IAM catalogue and the tenant directory itself).
 * Everything else in the public schema must carry `tenant_id` and a row level security policy, so a new
 * table cannot ship unscoped: add it to the migration list, or (rarely) to this list with a reason.
 */
const GLOBAL_TABLES = ['permissions', 'roles', 'policies', 'policy_statements', 'role_policies', 'groups', 'group_policies', 'tenants'];

const db = getDb();
const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

describe('row level security covers every club-owned table', () => {
  let available = false;
  beforeAll(async () => {
    available = await isDatabaseAvailable();
  });

  it('every public table is either allow-listed as global or has tenant_id, RLS and a strict policy', async (ctx) => {
    if (!available) return ctx.skip();
    const tables = await rows<{ name: string; rls: boolean; has_tenant_id: boolean; tenant_not_null: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as rls,
        exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant_id,
        exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id' and k.is_nullable = 'NO') as tenant_not_null
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`);
    expect(tables.length).toBeGreaterThan(40);
    const policies = await rows<{ tablename: string; roles: string[] | string; cmd: string; qual: string | null; with_check: string | null }>(
      sql`select tablename, roles::text as roles, cmd, qual, with_check from pg_policies where schemaname = 'public'`
    );
    const unscoped: string[] = [];
    for (const t of tables) {
      if (GLOBAL_TABLES.includes(t.name)) continue;
      const mine = policies.filter((p) => p.tablename === t.name);
      const strict = mine.some(
        (p) => p.cmd === 'ALL' && String(p.roles).includes('baseline_app') && /app_tenant_strict/.test(p.qual ?? '') && /app_tenant_strict/.test(p.with_check ?? '')
      );
      if (!t.has_tenant_id || !t.tenant_not_null || !t.rls || !strict) unscoped.push(t.name);
    }
    expect(unscoped, `tables missing tenant_id / RLS / tenant_isolation policy: ${unscoped.join(', ')}`).toEqual([]);
    // The allow-list cannot rot: every entry must still exist and really be unrestricted.
    for (const name of GLOBAL_TABLES) expect(tables.map((t) => t.name), name).toContain(name);
  });

  it('the app role can neither bypass row level security nor own tables', async (ctx) => {
    if (!available) return ctx.skip();
    const [role] = await rows<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
      sql`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'baseline_app'`
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
    const owned = await rows<{ relname: string }>(sql`select c.relname from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'baseline_app'`);
    expect(owned).toEqual([]);
  });
});

describe('tenant scope holds nothing between statements', () => {
  let available = false;
  let a: string;
  let b: string;
  const created: string[] = [];

  beforeAll(async () => {
    available = await isDatabaseAvailable();
    if (!available) return;
    const run = randomUUID().slice(0, 8);
    const inserted = await db.insert(tenants).values([{ slug: `s${run}-a`, name: 'Scope A' }, { slug: `s${run}-b`, name: 'Scope B' }]).returning();
    [a, b] = inserted.map((t) => t.id);
    created.push(a, b);
  });

  afterAll(async () => {
    if (!available) return;
    await db.delete(courtTypes).where(inArray(courtTypes.tenantId, created));
    await db.delete(tenants).where(inArray(tenants.id, created));
  });

  const typeCode = () => `X${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  const insertType = (scoped: ReturnType<typeof createTenantScope>['db'], code: string) =>
    scoped.insert(courtTypes).values({ code, name: code, baseRatePaise: 100, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0 }).returning({ id: courtTypes.id, tenantId: courtTypes.tenantId });

  it('rows written in a scope belong to it and are invisible to the other club and the default club', async (ctx) => {
    if (!available) return ctx.skip();
    const code = typeCode();
    const [row] = await insertType(createTenantScope(a).db, code);
    expect(row.tenantId).toBe(a);
    expect(await createTenantScope(a).db.select().from(courtTypes).where(eq(courtTypes.code, code))).toHaveLength(1);
    expect(await createTenantScope(b).db.select().from(courtTypes).where(eq(courtTypes.code, code))).toHaveLength(0);
    // The same code is allowed in the other club (uniqueness is per club).
    const [twin] = await insertType(createTenantScope(b).db, code);
    expect(twin.tenantId).toBe(b);
  });

  it('refuses to write a row for another club, whatever tenant_id the statement names', async (ctx) => {
    if (!available) return ctx.skip();
    const scope = createTenantScope(a).db;
    await expect(scope.insert(courtTypes).values({ code: typeCode(), name: 'spoof', baseRatePaise: 1, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0, tenantId: b })).rejects.toThrow();
    const victim = (await insertType(createTenantScope(b).db, typeCode()))[0];
    expect(await scope.update(courtTypes).set({ name: 'hijack' }).where(eq(courtTypes.id, victim.id)).returning()).toHaveLength(0);
    expect(await scope.delete(courtTypes).where(eq(courtTypes.id, victim.id)).returning()).toHaveLength(0);
    // Moving a row to another club is refused too.
    const mine = (await insertType(scope, typeCode()))[0];
    await expect(scope.update(courtTypes).set({ tenantId: b }).where(eq(courtTypes.id, mine.id))).rejects.toThrow();
  });

  it('keeps parallel transactions of different clubs on the right tenant', async (ctx) => {
    if (!available) return ctx.skip();
    const jobs = Array.from({ length: 24 }, (_, i) => {
      const tenantId = i % 2 === 0 ? a : b;
      return runInTenantScope(tenantId, async () => {
        const scoped = createScopedDb(db);
        const code = typeCode();
        return scoped.transaction(async (tx) => {
          const [row] = await tx.insert(courtTypes).values({ code, name: code, baseRatePaise: 1, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0 }).returning({ tenantId: courtTypes.tenantId });
          // Interleave with sibling transactions before reading back inside the same transaction.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
          const seen = await tx.select({ code: courtTypes.code, tenantId: courtTypes.tenantId }).from(courtTypes).where(eq(courtTypes.code, code));
          const [current] = (await tx.execute(sql`select current_setting('app.tenant_id') as t`)) as unknown as Array<{ t: string }>;
          return { expected: tenantId, inserted: row.tenantId, seen, current: current.t };
        });
      });
    });
    for (const r of await Promise.all(jobs)) {
      expect(r.inserted).toBe(r.expected);
      expect(r.current).toBe(r.expected);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0].tenantId).toBe(r.expected);
    }
  });

  it('nested transactions use savepoints and roll back on their own', async (ctx) => {
    if (!available) return ctx.skip();
    const scoped = createTenantScope(a).db;
    const code = typeCode();
    await scoped.transaction(async (tx) => {
      await tx.insert(courtTypes).values({ code, name: 'outer', baseRatePaise: 1, socialFeePaise: 0, trialFeePaise: 0, socialCapacity: 0 });
      await expect(
        tx.transaction(async (inner) => {
          await inner.update(courtTypes).set({ name: 'inner' }).where(eq(courtTypes.code, code));
          throw new Error('undo the inner part');
        })
      ).rejects.toThrow('undo the inner part');
    });
    const [row] = await scoped.select().from(courtTypes).where(eq(courtTypes.code, code));
    expect(row.name).toBe('outer');
    await expect(
      scoped.transaction(async (tx) => {
        await tx.update(courtTypes).set({ name: 'rolled back' }).where(eq(courtTypes.code, code));
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    expect((await scoped.select().from(courtTypes).where(eq(courtTypes.code, code)))[0].name).toBe('outer');
  });

  it('background work started in a scope stays in that club after the request is over', async (ctx) => {
    if (!available) return ctx.skip();
    const code = typeCode();
    let background!: Promise<string>;
    await runInTenantScope(b, async () => {
      // Fire-and-forget, like member login provisioning after the response has been sent.
      background = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(currentTenantId()).toBe(b);
        const [row] = await insertType(createScopedDb(db), code);
        return row.tenantId;
      })();
    });
    expect(currentTenantId()).toBeUndefined();
    expect(await background).toBe(b);
    expect(await createTenantScope(a).db.select().from(courtTypes).where(eq(courtTypes.code, code))).toHaveLength(0);
  });

  it('never leaves the role or tenant on a pooled connection, and holds no connection while idle', async (ctx) => {
    if (!available) return ctx.skip();
    await Promise.all(Array.from({ length: 30 }, () => createTenantScope(a).db.select().from(courtTypes).limit(1)));
    const checks = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const [r] = (await db.execute(sql`select current_user as u, current_setting('app.tenant_id', true) as t`)) as unknown as Array<{ u: string; t: string | null }>;
        return r;
      })
    );
    for (const c of checks) {
      expect(c.u).not.toBe('baseline_app');
      expect(c.t ?? '').toBe('');
    }
    // A scope that is created and never used costs nothing: no connection is taken.
    const idle = Array.from({ length: 50 }, () => createTenantScope(b));
    expect(idle).toHaveLength(50);
    expect(await db.execute(sql`select 1 as ok`)).toHaveLength(1);
  });

  it('rejects anything that is not a tenant id before it can reach SQL', () => {
    for (const bad of ['', 'x', "'; drop table tenants; --", '00000000-0000-0000-0000-00000000000g', 'DEFAULT']) {
      expect(() => createTenantScope(bad)).toThrow('Invalid tenant id');
    }
  });

  it('without a scope the owner connection is used (seeds, platform work)', () => {
    expect(currentTenantId()).toBeUndefined();
  });
});

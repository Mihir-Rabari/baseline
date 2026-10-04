import { AsyncLocalStorage } from 'node:async_hooks';
import type postgres from 'postgres';

/**
 * Per-club data isolation.
 *
 * Every club-owned table has row-level security (migration 0017): the `baseline_tenant` role may only
 * see and write rows whose `tenant_id` equals the transaction-local setting `app.tenant_id`. This module
 * makes sure every statement that runs on behalf of a club really executes under that role and setting.
 *
 * A setting made with `SET LOCAL` (or `set_config(..., true)`) only lasts for the transaction, and a pooled
 * connection can serve any caller between two statements. So a scope must never be "set once and
 * forgotten": here each statement (or each explicit transaction) runs inside its own short transaction on
 * a single pinned connection, which first selects the role and the tenant, then runs the work, then
 * commits and gives the connection back with nothing left over. No connection ever keeps a tenant
 * between statements.
 *
 * The scope is carried by `AsyncLocalStorage`, so services keep taking a plain database handle:
 *  - inside `runInTenant(id, fn)` every query is confined to that club;
 *  - inside `runUnscoped(fn)`, and outside any scope (seeds, migrations, scripts), queries run as the
 *    connecting owner, which bypasses row-level security. Only trusted platform code should do this.
 */

/** The Postgres role every club-scoped statement runs as. Created by migration 0017. */
export const TENANT_ROLE = 'baseline_tenant';

interface Scope {
  /** `null` means deliberately unscoped (platform operator / system work). */
  tenantId: string | null;
}

const storage = new AsyncLocalStorage<Scope>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertTenantId(tenantId: string): string {
  if (!UUID.test(tenantId)) throw new Error('Invalid tenant id for database scope.');
  return tenantId.toLowerCase();
}

/** Runs `fn` with every database statement confined to one club. */
export function runInTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId: assertTenantId(tenantId) }, fn);
}

/** Callback form for request hooks: continues the lifecycle (`done`) inside the club's scope. */
export function enterTenant(tenantId: string, done: () => void): void {
  storage.run({ tenantId: assertTenantId(tenantId) }, done);
}

/** Runs `fn` with no club restriction (platform operator work). */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ tenantId: null }, fn);
}

/** The club the current code is confined to, or `null` when unscoped. */
export function currentTenantScope(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

async function applyScope(tx: postgres.TransactionSql, tenantId: string): Promise<void> {
  // Transaction-local on purpose: it vanishes at COMMIT/ROLLBACK, so the pooled connection stays clean.
  await tx.unsafe(`select set_config('role', $1, true), set_config('app.tenant_id', $2, true)`, [TENANT_ROLE, tenantId]);
}

interface LazyQuery extends PromiseLike<unknown> {
  values(): Promise<unknown>;
  catch(onrejected: (reason: unknown) => unknown): Promise<unknown>;
  finally(onfinally: () => void): Promise<unknown>;
}

/**
 * Wraps a postgres.js client so statements issued while a club scope is active run scoped. Anything
 * else (templates, `end`, `options`, ...) passes straight through. Drizzle only needs `unsafe`
 * (optionally `.values()`) and `begin`.
 */
export function scopeClient(sql: postgres.Sql): postgres.Sql {
  const scopedUnsafe = (query: string, params?: unknown[], options?: unknown): LazyQuery => {
    const tenantId = storage.getStore()?.tenantId;
    const raw = sql.unsafe as unknown as (q: string, p?: unknown[], o?: unknown) => PromiseLike<unknown> & { values(): Promise<unknown> };
    if (!tenantId) return raw.call(sql, query, params, options) as unknown as LazyQuery;

    // Wrapped in an object: postgres.js treats an array returned from `begin` as a list of promises,
    // which would strip the row metadata (count, command) off a RowList.
    const run = async (values: boolean): Promise<unknown> => {
      const box = await sql.begin(async (tx) => {
        await applyScope(tx, tenantId);
        const pending = (tx.unsafe as unknown as typeof raw).call(tx, query, params, options);
        return { result: values ? await pending.values() : await pending };
      });
      return (box as unknown as { result: unknown }).result;
    };

    let started: Promise<unknown> | undefined;
    const start = () => (started ??= run(false));
    return {
      then: (onfulfilled, onrejected) => start().then(onfulfilled, onrejected),
      catch: (onrejected) => start().catch(onrejected),
      finally: (onfinally) => start().finally(onfinally),
      values: () => run(true),
    };
  };

  const scopedBegin = (...args: unknown[]): Promise<unknown> => {
    const tenantId = storage.getStore()?.tenantId;
    const begin = sql.begin as unknown as (...a: unknown[]) => Promise<unknown>;
    if (!tenantId) return begin.apply(sql, args);
    const fn = args[args.length - 1] as (tx: postgres.TransactionSql) => unknown;
    const options = args.length > 1 ? [args[0]] : [];
    return begin.apply(sql, [
      ...options,
      async (tx: postgres.TransactionSql) => {
        await applyScope(tx, tenantId);
        return fn(tx);
      },
    ]);
  };

  return new Proxy(sql, {
    get(target, prop) {
      if (prop === 'unsafe') return scopedUnsafe;
      if (prop === 'begin') return scopedBegin;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

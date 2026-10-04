import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from './schema/index.js';
import { getDb, getSql, type DatabaseInstance } from './client.js';

/**
 * Tenant scoped database access.
 *
 * Inside a tenant scope every statement runs in its own transaction that first switches to the
 * `baseline_app` role and sets `app.tenant_id` (both transaction-local). Row level security then makes
 * the database itself refuse to show or change another club's rows, whatever the application code asks
 * for. Nothing is held between statements, so parallel work and work that outlives a request stay
 * correctly confined. Outside a scope (seeds, migrations, platform work) the plain owner connection is
 * used and rows land in the default tenant.
 */
export interface TenantScope {
  tenantId: string;
  db: DatabaseInstance;
}

const storage = new AsyncLocalStorage<TenantScope>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONFINE = "select set_config('role', 'baseline_app', true), set_config('app.tenant_id', $1, true)";

type Runner = postgres.Sql | postgres.TransactionSql;

/**
 * The few members of a postgres.js client that drizzle's postgres-js session touches, each confined to
 * the tenant. Every `unsafe` call is one transaction: confine, then the query, pipelined together.
 */
function scopedClient(sql: postgres.Sql, tenantId: string): postgres.Sql {
  const confine = (tx: Runner) => tx.unsafe(CONFINE, [tenantId]);

  const client = {
    options: sql.options,
    unsafe(query: string, params?: unknown[]) {
      let asValues = false;
      let started: Promise<unknown> | null = null;
      const start = () =>
        (started ??= sql.begin(async (tx) => {
          const pending = tx.unsafe(query, params as never[]);
          if (asValues) pending.values();
          const [, result] = await Promise.all([confine(tx), pending]);
          return result;
        }));
      const handle = {
        values() {
          asValues = true;
          return handle;
        },
        then: (resolve?: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => start().then(resolve, reject),
        catch: (reject?: (reason: unknown) => unknown) => start().catch(reject),
        finally: (done?: () => void) => start().finally(done),
      };
      return handle;
    },
    begin(first: unknown, second?: unknown) {
      const run = (typeof first === 'function' ? first : second) as (tx: postgres.TransactionSql) => Promise<unknown>;
      const mode = typeof first === 'string' ? first : undefined;
      const body = async (tx: postgres.TransactionSql) => {
        await confine(tx);
        return run(tx);
      };
      return mode ? sql.begin(mode, body) : sql.begin(body);
    },
  };
  return client as unknown as postgres.Sql;
}

/** A tenant scope: a database handle confined to `tenantId`. Holds no connection. */
export function createTenantScope(tenantId: string): TenantScope {
  if (!UUID.test(tenantId)) throw new Error('Invalid tenant id');
  return { tenantId, db: drizzle(scopedClient(getSql(), tenantId), { schema }) };
}

/** Runs `fn` with every database call inside it (and in work it spawns) confined to `tenantId`. */
export function runInTenantScope<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(createTenantScope(tenantId), fn);
}

/** Binds a scope to the callback chain (used by the request hook). */
export function enterTenantScope(scope: TenantScope, next: () => void): void {
  storage.run(scope, next);
}

export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/**
 * A database handle that follows the ambient scope: scoped inside `runInTenantScope`/a request, the
 * plain owner connection elsewhere. Services keep one reference to it for their whole life.
 */
export function createScopedDb(base: DatabaseInstance = getDb()): DatabaseInstance {
  return new Proxy(base, {
    get(target, prop) {
      const active = storage.getStore()?.db ?? target;
      const value = Reflect.get(active, prop, active) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(active) : value;
    },
  });
}

import { uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';

/**
 * The owning club of a row. Every club-owned table carries it; Postgres row-level security
 * (see `tenant-scope.ts` and migration 0017) confines each request to its own club's rows.
 *
 * The default is the club of the current request (`app.tenant_id`), or the default club when no
 * request scope is active (seeds, migrations, scripts), so inserts never have to name the tenant.
 */
export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .default(sql`app_tenant_default()`)
    .references(() => tenants.id);

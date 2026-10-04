import { uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * The owning club. The database default comes from the session's `app.tenant_id`, so inserts made inside
 * a request land in that request's tenant without every call site naming it, and row level security
 * refuses any other value. Outside a request (seeds, jobs) it is the default tenant.
 */
export const tenantIdColumn = () => uuid('tenant_id').notNull().default(sql`app_tenant_default()`);

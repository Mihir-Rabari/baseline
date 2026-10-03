import { describe, it, expect } from 'vitest';
import { createDatabaseClient, schema } from './index.js';

describe('Database Module & Client (@packages/db)', () => {
  it('should export foundational system schema tables', () => {
    expect(schema.systemSettings).toBeDefined();
    expect(schema.systemAuditLogs).toBeDefined();
  });

  it('should initialize database client and expose drizzle instance', () => {
    const { db, sql } = createDatabaseClient({
      connectionString: 'postgres://postgres:postgres@localhost:5432/app_db',
    });

    expect(db).toBeDefined();
    expect(sql).toBeDefined();

    // Clean up sql connection pool
    sql.end();
  });
});

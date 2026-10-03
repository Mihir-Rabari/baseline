import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { getEnv } from '@packages/config/env';

export type DatabaseInstance = PostgresJsDatabase<typeof schema>;

let dbClient: postgres.Sql | null = null;
let dbInstance: DatabaseInstance | null = null;

export interface DatabaseConfig {
  connectionString?: string;
  maxConnections?: number;
  ssl?: boolean;
}

export function createDatabaseClient(config?: DatabaseConfig): { db: DatabaseInstance; sql: postgres.Sql } {
  const env = getEnv();
  const connectionString = config?.connectionString || env.DATABASE_URL;

  const sql = postgres(connectionString, {
    max: config?.maxConnections ?? 10,
    ssl: config?.ssl ?? env.DATABASE_SSL,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}, // Suppress notices
  });

  const db = drizzle(sql, { schema });
  return { db, sql };
}

/**
 * Get or initialize the singleton database client
 */
export function getDb(): DatabaseInstance {
  if (!dbInstance) {
    const { db, sql } = createDatabaseClient();
    dbInstance = db;
    dbClient = sql;
  }
  return dbInstance;
}

/**
 * Check database connectivity and latency
 */
export async function checkDatabaseHealth(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const env = getEnv();
    const sql = dbClient || postgres(env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    await sql`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { status: 'ok', latencyMs };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { status: 'error', latencyMs: Date.now() - start, error: errorMsg };
  }
}

/**
 * Close database connection pool
 */
export async function closeDatabase(): Promise<void> {
  if (dbClient) {
    await dbClient.end();
    dbClient = null;
    dbInstance = null;
  }
}

export { schema };

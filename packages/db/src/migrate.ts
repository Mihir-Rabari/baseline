import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from '@packages/config/env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const env = getEnv();
  console.log('[DB] Connecting to PostgreSQL for migration at:', env.DATABASE_URL.replace(/:[^:@]*@/, ':****@'));

  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  const db = drizzle(sql);

  // The drizzle folder is at packages/db/drizzle
  const migrationsFolder = path.resolve(__dirname, '../drizzle');
  console.log('[DB] Running migrations from:', migrationsFolder);

  try {
    await migrate(db, { migrationsFolder });
    console.log('[DB] ✅ Migrations completed successfully.');
  } catch (error) {
    console.error('[DB] ❌ Migration failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

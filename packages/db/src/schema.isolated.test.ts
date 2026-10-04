import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Fresh database migration installation', () => {
  it('installs every migration on an empty isolated database and leaves the journal unchanged on rerun', async () => {
    // The application connection only provisions the disposable database. No
    // migration, seed, truncate, or drop runs against the configured app database.
    const databaseName = `courtos_test_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    let isolated: ReturnType<typeof postgres> | undefined;
    let created = false;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const isolatedUrl = new URL(databaseUrl!);
      isolatedUrl.pathname = `/${databaseName}`;
      isolated = postgres(isolatedUrl.toString(), { max: 1, onnotice: () => {} });
      const db = drizzle(isolated);
      const options = { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) };

      const before = await isolated`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      expect(before).toHaveLength(0);
      await migrate(db, options);
      const firstJournal = await isolated`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
      // One row per journal entry, whatever the count is today.
      const entries = (JSON.parse(readFileSync(fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url)), 'utf8')) as { entries: unknown[] }).entries;
      expect(firstJournal).toHaveLength(entries.length);
      const firstTables = await isolated`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
      expect(firstTables).toHaveLength(60);
      expect(firstTables.map((row) => row.tablename)).toEqual(expect.arrayContaining([
        'users', 'system_settings', 'members', 'bookings', 'court_occupancies', 'payments', 'kitchen_tickets',
      ]));
      const ticketColumn = await isolated`SELECT is_identity, identity_generation FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kitchen_tickets' AND column_name = 'ticket_number'`;
      expect(ticketColumn).toHaveLength(1);
      expect(ticketColumn[0]).toMatchObject({ is_identity: 'YES', identity_generation: 'ALWAYS' });

      const photoColumn = await isolated`SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'photo_url'`;
      expect(photoColumn).toHaveLength(1);
      expect(photoColumn[0].character_maximum_length).toBe(512);

      const documentsTable = await isolated`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employee_documents' ORDER BY column_name`;
      expect(documentsTable.map((row) => row.column_name)).toEqual(expect.arrayContaining(['employee_id', 'storage_key', 'size_bytes']));

      await migrate(db, options);
      expect(await isolated`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(firstJournal);
      expect(await isolated`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).toEqual(firstTables);
    } finally {
      await isolated?.end();
      try {
        if (created) await admin.unsafe(`DROP DATABASE "${databaseName}"`);
      } finally {
        await admin.end();
      }
    }
  });
});

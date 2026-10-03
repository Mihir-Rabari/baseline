import { getDb } from '@packages/db';
import { sql } from 'drizzle-orm';

/**
 * Whether a real Postgres is reachable for this test run.
 *
 * Tests that need a database use this with `it.skipIf` so they are reported as SKIPPED
 * when infrastructure is absent. The alternative — asserting that the status code is one
 * of `[201, 400, 500, 503]` — passes whether the endpoint works or crashes, which makes
 * the test worse than useless: it produces a green tick with no information.
 */
let cached: boolean | undefined;

export async function isDatabaseAvailable(): Promise<boolean> {
  if (cached !== undefined) {
    return cached;
  }

  try {
    await getDb().execute(sql`select 1`);
    cached = true;
  } catch {
    cached = false;
  }

  return cached;
}

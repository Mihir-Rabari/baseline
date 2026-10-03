import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pk = () => uuid('id').defaultRandom().primaryKey();
export const tstz = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => tstz('created_at').defaultNow().notNull();
export const updatedAt = () => tstz('updated_at').defaultNow().notNull();
/** Money in paise. Never a float. */
export const paise = (name: string) => integer(name);

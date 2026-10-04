import { tenantIdColumn } from './_tenant.js';
import { pgTable, varchar, smallint, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, createdAt } from './_columns.js';

/** Which list a category belongs to. */
export type CategoryScope = 'PRODUCT' | 'MENU';

/**
 * Manageable lists (shop product categories, bar menu categories). `products.category` and
 * `menu_items.category` store the `code`; the API validates it against an active row here.
 */
export const categories = pgTable(
  'categories',
  {
    tenantId: tenantIdColumn(),
    id: pk(),
    scope: varchar('scope', { length: 16 }).$type<CategoryScope>().notNull(),
    code: varchar('code', { length: 16 }).notNull(),
    name: varchar('name', { length: 48 }).notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uq_categories_scope_code').on(t.scope, t.code)]
);

/** Rows every club starts with; the seed and migration 0008 both insert these idempotently. */
export const DEFAULT_CATEGORIES: ReadonlyArray<{ scope: CategoryScope; code: string; name: string; sortOrder: number }> = [
  { scope: 'PRODUCT', code: 'RACKET', name: 'Rackets', sortOrder: 1 },
  { scope: 'PRODUCT', code: 'BALL', name: 'Balls', sortOrder: 2 },
  { scope: 'PRODUCT', code: 'SHOE', name: 'Shoes', sortOrder: 3 },
  { scope: 'PRODUCT', code: 'ACCESSORY', name: 'Accessories', sortOrder: 4 },
  { scope: 'PRODUCT', code: 'APPAREL', name: 'Apparel', sortOrder: 5 },
  { scope: 'MENU', code: 'DRINK', name: 'Drinks', sortOrder: 1 },
  { scope: 'MENU', code: 'FOOD', name: 'Food', sortOrder: 2 },
  { scope: 'MENU', code: 'SNACK', name: 'Snacks', sortOrder: 3 },
];

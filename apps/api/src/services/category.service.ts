import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { categories, products, menuItems, type CategoryScope } from '@packages/db';
import type { DbExecutor } from './db-types.js';
import { DomainError } from '../lib/domain-error.js';
import { UNIQUE_VIOLATION, pgCode } from '../lib/db-errors.js';

type CategoryRow = typeof categories.$inferSelect;

const dto = (r: CategoryRow) => ({
  id: r.id,
  scope: r.scope,
  code: r.code,
  name: r.name,
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});

/** Managed lists (product categories, menu categories) that used to be hard-coded enums. */
export class CategoryService {
  constructor(private readonly db: DbExecutor) {}

  async list(scope: CategoryScope, opts: { q?: string; includeInactive?: boolean } = {}) {
    const filters = [eq(categories.scope, scope)];
    if (!opts.includeInactive) filters.push(eq(categories.isActive, true));
    if (opts.q) {
      const esc = String.fromCharCode(92); // LIKE's default escape character
      const like = `%${opts.q.split(esc).join(esc + esc).replace(/[%_]/g, (c) => esc + c)}%`;
      filters.push(or(ilike(categories.name, like), ilike(categories.code, like))!);
    }
    const rows = await this.db
      .select()
      .from(categories)
      .where(and(...filters))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return rows.map(dto);
  }

  async create(scope: CategoryScope, input: { code: string; name: string; sortOrder?: number }) {
    try {
      const [row] = await this.db
        .insert(categories)
        .values({ scope, code: input.code, name: input.name, sortOrder: input.sortOrder ?? 0 })
        .returning();
      return dto(row);
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) {
        throw new DomainError('CONFLICT', 409, `A category with code ${input.code} already exists.`);
      }
      throw error;
    }
  }

  async update(scope: CategoryScope, id: string, patch: { name?: string; sortOrder?: number; isActive?: boolean }) {
    const [current] = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.scope, scope)))
      .limit(1);
    if (!current) throw new DomainError('NOT_FOUND', 404, 'Category not found.');
    const set = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    };
    if (Object.keys(set).length === 0) return dto(current);
    const [row] = await this.db.update(categories).set(set).where(eq(categories.id, id)).returning();
    return dto(row);
  }

  /** Throws 422 unless `code` is an active category in `scope`. */
  async assertUsable(scope: CategoryScope, code: string) {
    const [row] = await this.db
      .select({ isActive: categories.isActive })
      .from(categories)
      .where(and(eq(categories.scope, scope), eq(categories.code, code)))
      .limit(1);
    if (!row) throw new DomainError('VALIDATION_ERROR', 422, `Unknown category ${code}. Add it under categories first.`);
    if (!row.isActive) throw new DomainError('VALIDATION_ERROR', 422, `Category ${code} is switched off. Choose another.`);
  }

  /** How many items use each category; lets the UI warn before switching one off. */
  async usage(scope: CategoryScope): Promise<Record<string, number>> {
    const table = scope === 'PRODUCT' ? products : menuItems;
    const rows = await this.db
      .select({ code: table.category, n: sql<number>`count(*)::int` })
      .from(table)
      .groupBy(table.category);
    return Object.fromEntries(rows.map((r) => [r.code, r.n]));
  }
}

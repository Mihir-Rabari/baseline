/** The Postgres SQLSTATE of an error, looking through drizzle's `cause` wrappers. */
export function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const EXCLUSION_VIOLATION = '23P01';

export function pageMeta(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, totalItems: total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
}

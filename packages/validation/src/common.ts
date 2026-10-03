import { z } from 'zod';

export const IdParamSchema = z.object({
  id: z.string().min(1, 'ID must not be empty'),
});
export type IdParam = z.infer<typeof IdParamSchema>;

export const UuidSchema = z.string().uuid('Invalid UUID identifier');

export const UuidParamSchema = z.object({
  id: UuidSchema,
});
export type UuidParam = z.infer<typeof UuidParamSchema>;

export const NonEmptyStringSchema = z.string().trim().min(1, 'String cannot be blank');

export const EmailSchema = z.string().trim().email('Invalid email address').toLowerCase();

export const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must consist of lowercase alphanumeric characters and single hyphens');

export const IsoDateTimeSchema = z.string().datetime({ message: 'Invalid ISO 8601 datetime format' });

/**
 * Datetime schema for HTTP *responses*.
 *
 * Drizzle hands back `Date` instances for timestamp columns, but the wire format is an
 * ISO 8601 string. This accepts either and always emits the string, so route handlers
 * can return rows straight from the service without hand-mapping every timestamp — and
 * without falling back to `z.any()`, which disables response filtering entirely.
 */
export const IsoDateTimeOutSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

export const NullableIsoDateTimeOutSchema = z
  .union([z.string(), z.date(), z.null()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

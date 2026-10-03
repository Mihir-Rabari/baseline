import { z } from 'zod';
import { UuidSchema } from './common.js';

export const CategoryScopeEnum = z.enum(['PRODUCT', 'MENU']);
export type CategoryScope = z.infer<typeof CategoryScopeEnum>;

/** Stored on products / menu items. Upper-case so existing codes (RACKET, DRINK, ...) stay valid. */
export const CategoryCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use capital letters, digits and underscores');

export const CategorySchema = z.object({
  id: UuidSchema,
  scope: CategoryScopeEnum,
  code: CategoryCodeSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type Category = z.infer<typeof CategorySchema>;
export const CategoryListSchema = z.array(CategorySchema);

/** GET /products/categories and /bar/categories */
export const CategoryListQuerySchema = z.object({
  q: z.string().trim().max(48).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;

export const CreateCategoryRequestSchema = z.object({
  code: CategoryCodeSchema,
  name: z.string().trim().min(1).max(48),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

/** PUT: the code is permanent because products and menu items reference it. */
export const UpdateCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;

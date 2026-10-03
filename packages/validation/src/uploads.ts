import { z } from 'zod';

export const UploadKindEnum = z.enum(['product', 'menu', 'court', 'club', 'employee', 'avatar']);
export type UploadKind = z.infer<typeof UploadKindEnum>;

/** What the API returns for an uploaded image; store `url` on the record. */
export const ImageUploadResponseSchema = z.object({
  url: z.string(),
  key: z.string(),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive(),
});
export type ImageUploadResponse = z.infer<typeof ImageUploadResponseSchema>;

/** An image reference on a record: one of our uploads, or an https URL. Nothing else (no data: or javascript: URLs). */
export const ImageRefSchema = z
  .string()
  .max(512)
  .refine(
    (v) => /^\/api\/v1\/media\/[a-z]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(v) || /^https:\/\/[^\s]+$/.test(v),
    'Use an uploaded image or an https link'
  );

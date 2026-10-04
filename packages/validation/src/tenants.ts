import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';

/**
 * Shared contract for the multi-tenancy work. The control plane (tenant resolution, domains,
 * branding) and the data isolation work both import from here, so change it only by agreement.
 */
export const TenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Use lower-case letters, digits and hyphens');

export const TenantStatusEnum = z.enum(['ACTIVE', 'SUSPENDED']);

export const TenantSchema = z.object({
  id: UuidSchema,
  slug: TenantSlugSchema,
  name: z.string(),
  status: TenantStatusEnum,
});
export type Tenant = z.infer<typeof TenantSchema>;

/** A lower-case hostname with at least one dot, no scheme, port or path. */
export const DomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain such as courts.example.com');

export const DomainStatusEnum = z.enum(['PENDING', 'VERIFIED', 'FAILED']);

export const TenantDomainSchema = z.object({
  id: UuidSchema,
  domain: z.string(),
  kind: z.enum(['PLATFORM', 'CUSTOM']),
  status: DomainStatusEnum,
  verifiedAt: NullableIsoDateTimeOutSchema,
  lastCheckedAt: NullableIsoDateTimeOutSchema,
  lastError: z.string().nullable(),
  createdAt: IsoDateTimeOutSchema,
});
export type TenantDomain = z.infer<typeof TenantDomainSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #1a73e8');

export const TenantBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  primaryColor: HexColorSchema.nullable(),
  secondaryColor: HexColorSchema.nullable(),
  accentColor: HexColorSchema.nullable(),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

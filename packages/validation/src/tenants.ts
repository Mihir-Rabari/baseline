import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { ImageRefSchema } from './uploads.js';

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

// ---- Control plane requests and responses ----

/** POST /tenant/domains */
export const CreateTenantDomainRequestSchema = z.object({ domain: DomainNameSchema });
export type CreateTenantDomainRequest = z.infer<typeof CreateTenantDomainRequestSchema>;

/** A DNS record the club must create to prove it owns the domain and point it at the platform. */
export const DnsRecordSchema = z.object({
  type: z.enum(['TXT', 'CNAME']),
  name: z.string(),
  value: z.string(),
  purpose: z.enum(['ownership', 'routing']),
});
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export const TenantDomainDetailSchema = TenantDomainSchema.extend({ dnsRecords: z.array(DnsRecordSchema) });
export type TenantDomainDetail = z.infer<typeof TenantDomainDetailSchema>;
export const TenantDomainListSchema = z.array(TenantDomainDetailSchema);

/** PUT /tenant/branding: send only what changes; null clears a value. */
export const UpdateTenantBrandingRequestSchema = z
  .object({
    logoUrl: ImageRefSchema.nullable().optional(),
    primaryColor: HexColorSchema.nullable().optional(),
    secondaryColor: HexColorSchema.nullable().optional(),
    accentColor: HexColorSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to change', path: ['primaryColor'] });
export type UpdateTenantBrandingRequest = z.infer<typeof UpdateTenantBrandingRequestSchema>;

/** GET /tenant: what the public site needs to know about the club it is serving. */
export const TenantSiteSchema = z.object({
  slug: z.string(),
  name: z.string(),
  branding: TenantBrandingSchema,
});
export type TenantSite = z.infer<typeof TenantSiteSchema>;

/** POST /platform/tenants (platform operator only) */
export const CreateTenantRequestSchema = z.object({ slug: TenantSlugSchema, name: z.string().trim().min(1).max(120) });
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantSummarySchema = TenantSchema.extend({ platformDomain: z.string().nullable(), createdAt: IsoDateTimeOutSchema });
export type TenantSummary = z.infer<typeof TenantSummarySchema>;
export const TenantSummaryListSchema = z.array(TenantSummarySchema);

/** PUT /platform/tenants/:id/status */
export const UpdateTenantStatusRequestSchema = z.object({ status: TenantStatusEnum });
export type UpdateTenantStatusRequest = z.infer<typeof UpdateTenantStatusRequestSchema>;

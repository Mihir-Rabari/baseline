import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema, NullableIsoDateTimeOutSchema } from './common.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from './pagination.js';
import { DateOnlySchema } from './domain-common.js';

export const NotificationSchema = z.object({
  id: UuidSchema,
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: NullableIsoDateTimeOutSchema,
  createdAt: IsoDateTimeOutSchema,
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = createPaginatedResponseSchema(NotificationSchema);

/** GET /notifications */
export const NotificationListQuerySchema = PaginationQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

/** GET /notifications/unread-count */
export const UnreadCountSchema = z.object({
  count: z.number().int().min(0),
});
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

/** POST /notifications/read-all */
export const ReadAllResponseSchema = z.object({
  updated: z.number().int().min(0),
});
export type ReadAllResponse = z.infer<typeof ReadAllResponseSchema>;

/** POST /admin/jobs/membership-expiry */
export const MembershipExpiryJobRequestSchema = z.object({
  asOf: DateOnlySchema.optional(),
});
export type MembershipExpiryJobRequest = z.infer<typeof MembershipExpiryJobRequestSchema>;

export const MembershipExpiryJobResponseSchema = z.object({
  asOf: DateOnlySchema,
  expired: z.number().int().min(0),
  remindersCreated: z.number().int().min(0),
});
export type MembershipExpiryJobResponse = z.infer<typeof MembershipExpiryJobResponseSchema>;

/** POST /admin/jobs/release-unpaid-orders */
export const ReleaseUnpaidOrdersResponseSchema = z.object({
  released: z.number().int().min(0),
  stockReturned: z.number().int().min(0),
});
export type ReleaseUnpaidOrdersResponse = z.infer<typeof ReleaseUnpaidOrdersResponseSchema>;

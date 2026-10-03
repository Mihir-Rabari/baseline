import { z } from 'zod';

export const HealthSummaryResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  version: z.string(),
});
export type HealthSummaryResponse = z.infer<typeof HealthSummaryResponseSchema>;

export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

export const ReadinessServicesSchema = z.object({
  api: z.enum(['ok', 'degraded', 'down']),
  database: z.enum(['ok', 'degraded', 'down']),
  redis: z.enum(['ok', 'degraded', 'down']),
  storage: z.enum(['ok', 'degraded', 'down']).optional(),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  version: z.string(),
  services: ReadinessServicesSchema,
  details: z
    .object({
      databaseLatencyMs: z.number().optional(),
      redisLatencyMs: z.number().optional(),
      storageLatencyMs: z.number().optional(),
      errors: z.record(z.string()).optional(),
    })
    .optional(),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

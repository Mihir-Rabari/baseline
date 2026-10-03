import { z } from 'zod';

export const SystemInfoResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.string(),
  nodeVersion: z.string(),
  uptime: z.number(),
  timestamp: z.string().datetime(),
  features: z.record(z.boolean()),
});
export type SystemInfoResponse = z.infer<typeof SystemInfoResponseSchema>;

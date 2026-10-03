/**
 * Optional Feature & Infrastructure Integration Toggles
 *
 * Developers can enable/disable capabilities here without breaking runtime stability.
 */
export const FeatureConfig = {
  /**
   * Swagger / OpenAPI Interactive Documentation (/api/docs)
   */
  enableSwagger: true,

  /**
   * Prometheus Metrics Exporter (/metrics)
   */
  enableMetrics: true,

  /**
   * CORS header processing
   */
  enableCors: true,

  /**
   * Fastify rate-limiting middleware
   */
  enableRateLimiting: true,

  /**
   * S3 / MinIO Object Storage integration
   */
  enableStorage: true,

  /**
   * Redis session caching & pub/sub foundation
   */
  enableRedis: true,

  /**
   * Transactional email provider integration (e.g. Resend)
   */
  enableEmail: false,
} as const;

export type FeatureConfigType = typeof FeatureConfig;

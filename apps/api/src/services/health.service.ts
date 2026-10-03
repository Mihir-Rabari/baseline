import { checkDatabaseHealth } from '@packages/db';
import type { IRedisService, IStorageService, ServiceStatus } from '@packages/shared';
import type { ReadinessResponse, HealthSummaryResponse, LivenessResponse } from '../schemas/health.schema.js';
import { AppConfig } from '@packages/config';

export class HealthService {
  constructor(
    private redisService?: IRedisService,
    private storageService?: IStorageService
  ) {}

  public getSummary(): HealthSummaryResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: AppConfig.version,
    };
  }

  public getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  public async getReadiness(): Promise<ReadinessResponse> {
    const errors: Record<string, string> = {};
    let dbStatus: ServiceStatus = 'ok';
    let dbLatency: number | undefined;

    let redisStatus: ServiceStatus = 'ok';
    let redisLatency: number | undefined;

    let storageStatus: ServiceStatus = 'ok';
    let storageLatency: number | undefined;

    // Check DB
    try {
      const dbCheck = await checkDatabaseHealth();
      if (dbCheck.status !== 'ok') {
        dbStatus = 'down';
        errors.database = dbCheck.error || 'Database connection error';
      } else {
        dbLatency = dbCheck.latencyMs;
      }
    } catch (err: unknown) {
      dbStatus = 'down';
      errors.database = err instanceof Error ? err.message : String(err);
    }

    // Check Redis
    if (this.redisService) {
      try {
        const redisCheck = await this.redisService.healthCheck();
        if (redisCheck.status !== 'ok') {
          redisStatus = 'down';
          errors.redis = redisCheck.error || 'Redis connection error';
        } else {
          redisLatency = redisCheck.latencyMs;
        }
      } catch (err: unknown) {
        redisStatus = 'down';
        errors.redis = err instanceof Error ? err.message : String(err);
      }
    }

    // Check Storage (MinIO / S3)
    if (this.storageService) {
      try {
        const storageCheck = await this.storageService.healthCheck();
        if (storageCheck.status !== 'ok') {
          storageStatus = 'degraded';
          errors.storage = storageCheck.error || 'Storage connection error';
        } else {
          storageLatency = storageCheck.latencyMs;
        }
      } catch (err: unknown) {
        storageStatus = 'degraded';
        errors.storage = err instanceof Error ? err.message : String(err);
      }
    }

    const isCriticalDown = dbStatus === 'down' || redisStatus === 'down';
    const isDegraded = storageStatus === 'degraded';

    const overallStatus: 'ok' | 'degraded' | 'error' = isCriticalDown
      ? 'error'
      : isDegraded
      ? 'degraded'
      : 'ok';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: AppConfig.version,
      services: {
        api: 'ok',
        database: dbStatus,
        redis: redisStatus,
        storage: storageStatus,
      },
      details: {
        databaseLatencyMs: dbLatency,
        redisLatencyMs: redisLatency,
        storageLatencyMs: storageLatency,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
      },
    };
  }
}

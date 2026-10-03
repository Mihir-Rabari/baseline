export type ServiceStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
}

export interface ReadinessCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
    redis: ServiceStatus;
    storage?: ServiceStatus;
  };
  details?: {
    databaseLatencyMs?: number;
    redisLatencyMs?: number;
    storageLatencyMs?: number;
    errors?: Record<string, string>;
  };
}

export interface LivenessCheckResponse {
  status: 'ok';
  timestamp: string;
}

export type ReadinessResponse = ReadinessCheckResponse;
export type HealthSummaryResponse = HealthCheckResponse;
export type LivenessResponse = LivenessCheckResponse;

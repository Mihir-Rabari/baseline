export const ApiTags = {
  HEALTH: {
    name: 'Health',
    description: 'Service health check, liveness, and readiness probes',
  },
  SYSTEM: {
    name: 'System',
    description: 'System metadata, diagnostics, and environment info',
  },
  METRICS: {
    name: 'Metrics',
    description: 'Prometheus metrics and observability probes',
  },
} as const;

export type ApiTagKey = keyof typeof ApiTags;

import { AuthConfig } from './auth-config.js';
import { IamConfig } from './iam-config.js';
import { FeatureConfig } from './feature-config.js';

/**
 * Application Constants and Compile-Time Configuration
 * 
 * Non-sensitive application configuration that is baked into the code
 * and separated strictly from runtime secrets/environment variables.
 */
export const AppConfig = {
  name: 'Baseline',
  slug: 'baseline',
  description: 'Production-ready full-stack starter with Fastify, Next.js, PostgreSQL, Redis, and MinIO',
  version: '1.3.0',
  apiVersion: 'v1',
  apiPrefix: '/api',

  // Pagination defaults
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
    defaultPage: 1,
  },

  // Security and limits
  security: {
    maxRequestBodySize: 10 * 1024 * 1024, // 10MB
    rateLimitMax: 100, // requests per window
    rateLimitTimeWindow: 60 * 1000, // 1 minute in ms
  },

  // Feature Flags
  features: FeatureConfig,

  // Auth Configuration (Phase 2)
  auth: {
    registrationEnabled: AuthConfig.registrationEnabled,
    defaultIdentity: AuthConfig.defaultIdentity,
    sessionTtlSeconds: AuthConfig.sessionTtlSeconds,
    cookieName: AuthConfig.cookieName,
    minPasswordLength: AuthConfig.minPasswordLength,
    maxLoginAttempts: AuthConfig.maxLoginAttempts,
    lockoutSeconds: AuthConfig.lockoutSeconds,
    loginAttemptWindowSeconds: AuthConfig.loginAttemptWindowSeconds,
  },

  // IAM Configuration (Phase 2)
  iam: {
    rootEnabled: IamConfig.root.enabled,
    defaultExternalUserPolicy: IamConfig.registration.defaultPolicy,
    defaultRole: IamConfig.registration.defaultRole,
    administratorPolicy: 'AdministratorPolicy',
    adminRoleName: 'ADMIN',
  },
} as const;

export type AppConfigType = typeof AppConfig;

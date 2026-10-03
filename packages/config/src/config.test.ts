import { describe, it, expect } from 'vitest';
import { AppConfig } from './app-config.js';
import { AuthConfig } from './auth-config.js';
import { IamConfig } from './iam-config.js';
import { FeatureConfig } from './feature-config.js';

describe('Configuration Layer Invariants', () => {
  describe('AuthConfig', () => {
    it('should have valid session and password constraints', () => {
      expect(AuthConfig.sessionTtlSeconds).toBeGreaterThan(0);
      expect(AuthConfig.minPasswordLength).toBeGreaterThanOrEqual(8);
      expect(AuthConfig.cookieName).toBe('app_session');
      expect(AuthConfig.defaultIdentity).toBe('EXTERNAL_USER');
    });
  });

  describe('IamConfig', () => {
    it('should define baseline AdministratorPolicy and ExternalUserPolicy', () => {
      expect(IamConfig.policies.AdministratorPolicy).toBeDefined();
      expect(IamConfig.policies.ExternalUserPolicy).toBeDefined();

      const adminStatements = IamConfig.policies.AdministratorPolicy.statements;
      expect(adminStatements[0].effect).toBe('allow');
      expect(adminStatements[0].actions).toContain('admin:access');

      const externalStatements = IamConfig.policies.ExternalUserPolicy.statements;
      expect(externalStatements[0].effect).toBe('allow');
      expect(externalStatements[0].actions).toContain('profile:read:self');
    });

    it('should define baseline ADMIN and USER roles', () => {
      expect(IamConfig.roles.ADMIN).toBeDefined();
      expect(IamConfig.roles.ADMIN.policies).toContain('AdministratorPolicy');

      expect(IamConfig.roles.USER).toBeDefined();
      expect(IamConfig.roles.USER.policies).toContain('ExternalUserPolicy');
    });
  });

  describe('FeatureConfig', () => {
    it('should declare boolean toggles for core features', () => {
      expect(typeof FeatureConfig.enableSwagger).toBe('boolean');
      expect(typeof FeatureConfig.enableMetrics).toBe('boolean');
      expect(typeof FeatureConfig.enableStorage).toBe('boolean');
      expect(typeof FeatureConfig.enableRedis).toBe('boolean');
    });
  });

  describe('AppConfig', () => {
    it('should provide default pagination and security settings', () => {
      expect(AppConfig.pagination.defaultLimit).toBe(20);
      expect(AppConfig.pagination.maxLimit).toBe(100);
      expect(AppConfig.pagination.defaultPage).toBe(1);

      expect(AppConfig.security.maxRequestBodySize).toBe(10 * 1024 * 1024);
      expect(AppConfig.security.rateLimitMax).toBe(100);
    });
  });
});

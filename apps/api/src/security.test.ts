import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import type { FastifyInstance } from 'fastify';

describe('Adversarial & Security API Tests', () => {
  let app: FastifyInstance;
  let hasDatabase = false;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    hasDatabase = await isDatabaseAvailable();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Zero-Trust Input & Privilege Escalation', () => {
    it('POST /api/v1/auth/signup rejects a payload carrying privilege fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: `adversary-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Adversary User',
          role: 'ADMIN', // Client attempting privilege escalation
          identityType: 'ROOT', // Client attempting ROOT bypass
          isSuperuser: true,
        },
      });

      // The signup schema is `.strict()`, so unknown keys are refused outright rather
      // than silently dropped. This is checked before the database is touched, which is
      // why it holds with or without infrastructure running.
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    });

    it('a legitimate signup never yields a ROOT identity or leaks a password hash', async (ctx) => {
      // Explicitly skipped rather than silently passing when no database is running,
      // so the test report distinguishes "verified" from "not run".
      if (!hasDatabase) {
        ctx.skip();
        return;
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: `adversary-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Adversary User',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.user.identityType).toBe('EXTERNAL_USER');
      expect(json.user.passwordHash).toBeUndefined();
    });

    it('should reject malformed session cookie gracefully without 500 error', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: {
          cookie: 'app_session=malformed_token_12345!@#$%^',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('should not leak stack traces or database connection details in error responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/iam/users/non-existent-id-format',
      });

      // Schema validation runs in preValidation, ahead of the auth preHandler, so a
      // malformed UUID is always a 400 regardless of authentication or database state.
      expect(response.statusCode).toBe(400);
      const body = response.body;
      expect(body).not.toContain('postgres://');
      expect(body).not.toContain('password');
      expect(body).not.toContain('node_modules');
      expect(body).not.toContain('at Object.');
    });
  });
});

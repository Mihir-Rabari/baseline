import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createSignupRequestSchema,
  LoginRequestSchema,
  SessionResponseSchema,
  HttpErrorResponseSchema,
} from '@packages/validation';
import { users, policies, userPolicies } from '@packages/db';
import { eq } from 'drizzle-orm';
import {
  hashPassword,
  verifyPassword,
  verifyPasswordDummy,
  getSessionCookieOptions,
  LoginThrottle,
} from '@packages/auth';
import { requireAuthentication } from '@packages/iam';
import { z } from 'zod';

/**
 * True when the browser will treat the web app and the API as different sites, which
 * is what determines whether the session cookie needs `SameSite=None`.
 *
 * Derived from configuration rather than exposed as another env var: if WEB_URL and
 * API_URL are on different hosts, the cookie is cross-site by definition.
 */
function isCrossSiteDeployment(webUrl: string, apiUrl: string): boolean {
  try {
    return new URL(webUrl).hostname !== new URL(apiUrl).hostname;
  } catch {
    return false;
  }
}

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const env = fastify.env;
  const authConfig = fastify.appConfig.auth;
  const isProd = env.NODE_ENV === 'production';
  const cookieOptions = getSessionCookieOptions(
    isProd,
    env.SESSION_TTL_SECONDS,
    env.SESSION_COOKIE_NAME,
    isCrossSiteDeployment(env.WEB_URL, env.API_URL)
  );

  const SignupRequestSchema = createSignupRequestSchema(authConfig.minPasswordLength);

  // Counts failed logins per email, independently of the per-IP rate limiter, so that
  // credential stuffing spread across many source addresses still hits a wall.
  const loginThrottle = new LoginThrottle(fastify.redis, {
    maxAttempts: authConfig.maxLoginAttempts,
    lockoutSeconds: authConfig.lockoutSeconds,
    windowSeconds: authConfig.loginAttemptWindowSeconds,
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/signup - Public Visitor Registration
  // ---------------------------------------------------------------------------
  fastify.post(
    '/auth/signup',
    {
      schema: {
        description: 'Register a new external user account',
        tags: ['Authentication'],
        body: SignupRequestSchema,
        response: {
          201: SessionResponseSchema,
          400: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          409: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Honour the registrationEnabled switch. When public signup is turned off,
      // accounts are created by administrators through the IAM endpoints instead.
      if (!authConfig.registrationEnabled) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Public registration is disabled for this application.',
          code: 'REGISTRATION_DISABLED',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      const { email: rawEmail, password, name } = request.body;
      const email = rawEmail.toLowerCase().trim();

      // 1. Check if user with email already exists
      const [existingUser] = await fastify.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'An account with this email address already exists',
          code: 'USER_ALREADY_EXISTS',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Hash password
      const passwordHash = await hashPassword(password);

      // 3 & 4. Create the account and attach its baseline policy atomically.
      //
      // These were two independent statements. If the policy attachment failed, the
      // user was left created but with no permissions at all — able to log in and do
      // nothing, and unable to sign up again because the email was taken.
      const defaultPolicyName = fastify.appConfig.iam.defaultExternalUserPolicy;

      const newUser = await fastify.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email,
            name: name.trim(),
            passwordHash,
            status: 'ACTIVE',
            // Identity type is fixed server-side; the request schema is `.strict()` so a
            // client cannot even submit this field.
            identityType: 'EXTERNAL_USER',
          })
          .returning();

        const [externalPolicy] = await tx
          .select({ id: policies.id })
          .from(policies)
          .where(eq(policies.name, defaultPolicyName))
          .limit(1);

        if (externalPolicy) {
          await tx
            .insert(userPolicies)
            .values({
              userId: created.id,
              policyId: externalPolicy.id,
            })
            .onConflictDoNothing();
        } else {
          // The seed installs this policy. Its absence means the database was never
          // seeded, or the policy was deleted — worth a loud log, since every account
          // created from here on will have no permissions.
          request.log.error(
            { policy: defaultPolicyName },
            'Default external-user policy is missing; new accounts will have no permissions'
          );
        }

        return created;
      });

      // 5. Create server-side session
      const { sessionToken, session, user } = await fastify.sessionManager.createSession({
        userId: newUser.id,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
        ttlSeconds: env.SESSION_TTL_SECONDS,
      });

      // 6. Set HTTP-only session cookie
      reply.setCookie(cookieOptions.name, sessionToken, {
        path: cookieOptions.path,
        maxAge: cookieOptions.maxAge,
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
      });

      // 7. Log audit events
      await fastify.iamService.logAuditEvent({
        action: 'USER_CREATED',
        actor: newUser.id,
        target: newUser.id,
        details: { email: newUser.email, identityType: newUser.identityType },
      });

      await fastify.iamService.logAuditEvent({
        action: 'LOGIN_SUCCESS',
        actor: newUser.id,
        target: newUser.id,
        details: { method: 'signup', ip: request.ip },
      });

      // 8. Calculate effective permissions
      const effectivePerms = await fastify.iamService.getEffectivePermissions(newUser.id);

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          identityType: user.identityType,
          lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        },
        effectivePermissions: effectivePerms.effectivePermissions,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login - Credential Verification & Session Creation
  // ---------------------------------------------------------------------------
  fastify.post(
    '/auth/login',
    {
      schema: {
        description: 'Authenticate with email and password to create an active session',
        tags: ['Authentication'],
        body: LoginRequestSchema,
        response: {
          200: SessionResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          429: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { email: rawEmail, password } = request.body;
      const email = rawEmail.toLowerCase().trim();

      // 0. Reject while the account is locked out, before touching the database.
      const lockout = await loginThrottle.check(email);
      if (lockout.locked) {
        await fastify.iamService.logAuditEvent({
          action: 'LOGIN_BLOCKED',
          actor: 'anonymous',
          details: { email, reason: 'Account locked after repeated failures', ip: request.ip },
          status: 'failure',
        });

        reply.header('Retry-After', String(lockout.retryAfterSeconds));
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Too many failed login attempts. Try again in ${Math.ceil(lockout.retryAfterSeconds / 60)} minute(s).`,
          code: 'ACCOUNT_LOCKED',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // 1. Fetch user by email
      const [userRecord] = await fastify.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!userRecord) {
        // Spend the same CPU time as a real password check. Returning early here would
        // make "no such account" measurably faster than "wrong password", which is
        // enough to enumerate registered emails.
        await verifyPasswordDummy(password);
        await loginThrottle.recordFailure(email);

        await fastify.iamService.logAuditEvent({
          action: 'LOGIN_FAILURE',
          actor: 'anonymous',
          details: { email, reason: 'User not found', ip: request.ip },
          status: 'failure',
        });

        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Check account status
      if (userRecord.status === 'SUSPENDED') {
        await fastify.iamService.logAuditEvent({
          action: 'LOGIN_FAILURE',
          actor: userRecord.id,
          details: { email, reason: 'Account suspended', ip: request.ip },
          status: 'failure',
        });

        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Your account has been temporarily suspended. Please contact support.',
          code: 'ACCOUNT_SUSPENDED',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      if (userRecord.status === 'DISABLED') {
        await fastify.iamService.logAuditEvent({
          action: 'LOGIN_FAILURE',
          actor: userRecord.id,
          details: { email, reason: 'Account disabled', ip: request.ip },
          status: 'failure',
        });

        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'This account has been disabled.',
          code: 'ACCOUNT_DISABLED',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // 3. Verify password hash
      const isValidPassword = await verifyPassword(password, userRecord.passwordHash);
      if (!isValidPassword) {
        const failure = await loginThrottle.recordFailure(email);
        if (failure.locked) {
          reply.header('Retry-After', String(failure.retryAfterSeconds));
        }

        await fastify.iamService.logAuditEvent({
          action: 'LOGIN_FAILURE',
          actor: userRecord.id,
          details: { email, reason: 'Password mismatch', ip: request.ip },
          status: 'failure',
        });

        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      // 4. Clear the failure counter, then create the session
      await loginThrottle.recordSuccess(email);

      const { sessionToken, session, user } = await fastify.sessionManager.createSession({
        userId: userRecord.id,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
        ttlSeconds: env.SESSION_TTL_SECONDS,
      });

      // 5. Set session cookie
      reply.setCookie(cookieOptions.name, sessionToken, {
        path: cookieOptions.path,
        maxAge: cookieOptions.maxAge,
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
      });

      // 6. Log audit event
      await fastify.iamService.logAuditEvent({
        action: 'LOGIN_SUCCESS',
        actor: user.id,
        target: user.id,
        details: { email: user.email, identityType: user.identityType, ip: request.ip },
      });

      // 7. Calculate effective permissions
      const effectivePerms = await fastify.iamService.getEffectivePermissions(user.id);

      return reply.status(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          identityType: user.identityType,
          lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        },
        effectivePermissions: effectivePerms.effectivePermissions,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/logout - Session Revocation
  // ---------------------------------------------------------------------------
  fastify.post(
    '/auth/logout',
    {
      schema: {
        description: 'Revoke active session and clear authentication cookie',
        tags: ['Authentication'],
        response: {
          200: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const sessionToken = request.cookies[cookieOptions.name];

      if (sessionToken) {
        await fastify.sessionManager.revokeSession(sessionToken);

        if (request.user) {
          await fastify.iamService.logAuditEvent({
            action: 'LOGOUT',
            actor: request.user.id,
            target: request.user.id,
          });
        }
      }

      // Clear cookie
      reply.clearCookie(cookieOptions.name, {
        path: cookieOptions.path,
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
      });

      return reply.status(200).send({
        success: true,
        message: 'Logged out successfully',
      });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/session - Current Session & Identity Verification
  // ---------------------------------------------------------------------------
  fastify.get(
    '/auth/session',
    {
      preHandler: [requireAuthentication()],
      schema: {
        description: 'Get current authenticated identity, session metadata, and effective permissions',
        tags: ['Authentication'],
        response: {
          200: SessionResponseSchema,
          401: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const session = request.session!;

      const effectivePerms = await fastify.iamService.getEffectivePermissions(user.id);

      return reply.status(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          identityType: user.identityType,
          lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        },
        effectivePermissions: effectivePerms.effectivePermissions,
      });
    }
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  UpdateProfileSchema,
  createChangePasswordSchema,
  HttpErrorResponseSchema,
  AuthUserSchema,
} from '@packages/validation';
import { users } from '@packages/db';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '@packages/auth';
import { requirePermission } from '@packages/iam';

export const profileRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Built from config so AuthConfig.minPasswordLength governs password changes too,
  // not just signup.
  const ChangePasswordSchema = createChangePasswordSchema(
    fastify.appConfig.auth.minPasswordLength
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/profile - Get current user profile (profile:read:self)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/profile',
    {
      preHandler: [
        requirePermission('profile:read:self', (req) => ({
          resourceOwnerId: req.user?.id,
        })),
      ],
      schema: {
        description: 'Get current user profile',
        tags: ['Profile'],
        response: {
          200: AuthUserSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;

      const [record] = await fastify.db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      return reply.status(200).send({
        id: record.id,
        email: record.email,
        name: record.name,
        status: record.status as 'ACTIVE' | 'SUSPENDED' | 'DISABLED',
        identityType: record.identityType as 'ROOT' | 'EXTERNAL_USER',
        lastLoginAt: record.lastLoginAt ? record.lastLoginAt.toISOString() : null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/v1/profile - Update current user profile (profile:update:self)
  // ---------------------------------------------------------------------------
  fastify.put(
    '/profile',
    {
      preHandler: [
        requirePermission('profile:update:self', (req) => ({
          resourceOwnerId: req.user?.id,
        })),
      ],
      schema: {
        description: 'Update own user profile name or email',
        tags: ['Profile'],
        body: UpdateProfileSchema,
        response: {
          200: AuthUserSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          409: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { name, email: rawEmail } = request.body;

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (name) updateData.name = name;

      if (rawEmail) {
        const email = rawEmail.toLowerCase().trim();
        if (email !== user.email) {
          const [exists] = await fastify.db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          if (exists) {
            return reply.status(409).send({
              statusCode: 409,
              error: 'Conflict',
              message: 'Email address is already in use by another account',
              code: 'EMAIL_ALREADY_EXISTS',
              requestId: request.id,
              timestamp: new Date().toISOString(),
            });
          }

          updateData.email = email;
        }
      }

      const [updated] = await fastify.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, user.id))
        .returning();

      await fastify.iamService.logAuditEvent({
        action: 'PROFILE_UPDATED',
        actor: user.id,
        target: user.id,
        details: { updatedFields: Object.keys(updateData) },
      });

      return reply.status(200).send({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        status: updated.status as 'ACTIVE' | 'SUSPENDED' | 'DISABLED',
        identityType: updated.identityType as 'ROOT' | 'EXTERNAL_USER',
        lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/profile/change-password - Self Password Change
  // ---------------------------------------------------------------------------
  fastify.post(
    '/profile/change-password',
    {
      preHandler: [
        requirePermission('profile:update:self', (req) => ({
          resourceOwnerId: req.user?.id,
        })),
      ],
      schema: {
        description: 'Change user password',
        tags: ['Profile'],
        body: ChangePasswordSchema,
        response: {
          200: z.object({ success: z.boolean(), message: z.string() }),
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { currentPassword, newPassword } = request.body;

      const [record] = await fastify.db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const isValid = await verifyPassword(currentPassword, record.passwordHash);
      if (!isValid) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Current password does not match',
          code: 'INVALID_CURRENT_PASSWORD',
          requestId: request.id,
          timestamp: new Date().toISOString(),
        });
      }

      const newHash = await hashPassword(newPassword);

      await fastify.db
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await fastify.iamService.logAuditEvent({
        action: 'PASSWORD_CHANGED',
        actor: user.id,
        target: user.id,
      });

      return reply.status(200).send({
        success: true,
        message: 'Password updated successfully',
      });
    }
  );
};

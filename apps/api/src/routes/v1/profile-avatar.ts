import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jsonSchemaTransform, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import { HttpErrorResponseSchema, ProfileAvatarResponseSchema, ProfileAvatarUploadSchema } from '@packages/validation';
import { normalizeAvatarPng } from '../../lib/avatar-png.js';
import { avatarKey, legacyKey } from '../../lib/storage-keys.js';

const legacyAvatarKey = (userId: string) => `profiles/${userId}/avatar.png`;
const versionFor = (image: Buffer) => createHash('sha256').update(image).digest('hex');
const errors = { 400: HttpErrorResponseSchema, 401: HttpErrorResponseSchema, 403: HttpErrorResponseSchema, 503: HttpErrorResponseSchema };

/** The club's own photo; the default club also still reads photos stored before per-club prefixes. */
async function readAvatar(fastify: FastifyInstance, tenantId: string, userId: string): Promise<Buffer | null> {
  const own = await fastify.storage.get(avatarKey(tenantId, userId));
  if (own) return own;
  const legacy = legacyKey(tenantId, legacyAvatarKey(userId));
  return legacy ? fastify.storage.get(legacy) : null;
}

function unavailable(request: FastifyRequest, reply: FastifyReply) {
  request.log.error({ userId: request.user?.id }, 'Profile photo storage unavailable');
  return reply.status(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Profile photo storage is temporarily unavailable. Try again.', code: 'AVATAR_STORAGE_UNAVAILABLE', requestId: request.id, timestamp: new Date().toISOString() });
}

export const profileAvatarRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const ownRead = requirePermission('profile:read:self', (req) => ({ resourceOwnerId: req.user?.id }));
  const ownUpdate = requirePermission('profile:update:self', (req) => ({ resourceOwnerId: req.user?.id }));
  fastify.get('/profile/avatar', {
    preHandler: [ownRead],
    schema: { tags: ['Profile'], security: [{ CookieAuth: [] }], description: 'Get own private profile photo version', response: { 200: ProfileAvatarResponseSchema, ...errors } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const image = await readAvatar(fastify, request.tenantId, request.user!.id);
      return reply.send({ version: image ? versionFor(image) : null });
    } catch { return unavailable(request, reply); }
  });
  fastify.put('/profile/avatar', {
    bodyLimit: 350 * 1024,
    preHandler: [ownUpdate],
    schema: { tags: ['Profile'], security: [{ CookieAuth: [] }], description: 'Replace own profile photo with a static PNG up to 256 KiB and 512 pixels per side', body: ProfileAvatarUploadSchema, response: { 200: ProfileAvatarResponseSchema, ...errors, 413: HttpErrorResponseSchema } },
  }, async (request, reply) => {
    const decoded = Buffer.from(request.body.imageBase64, 'base64');
    const image = decoded.toString('base64') === request.body.imageBase64 ? normalizeAvatarPng(decoded) : null;
    if (!image) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Use a valid static PNG photo up to 256 KiB and 512 pixels per side.', code: 'INVALID_AVATAR', requestId: request.id, timestamp: new Date().toISOString() });
    try {
      await fastify.storage.ensureBucketExists();
      await fastify.storage.upload(avatarKey(request.tenantId, request.user!.id), image, { contentType: 'image/png' });
      return reply.send({ version: versionFor(image) });
    } catch { return unavailable(request, reply); }
  });
  fastify.delete('/profile/avatar', {
    preHandler: [ownUpdate],
    schema: { tags: ['Profile'], security: [{ CookieAuth: [] }], description: 'Remove own profile photo', response: { 200: z.object({ success: z.literal(true) }), ...errors } },
  }, async (request, reply) => {
    try {
      if (!await fastify.storage.delete(avatarKey(request.tenantId, request.user!.id))) return unavailable(request, reply);
      const legacy = legacyKey(request.tenantId, legacyAvatarKey(request.user!.id));
      if (legacy) await fastify.storage.delete(legacy);
      return reply.send({ success: true });
    } catch { return unavailable(request, reply); }
  });
  fastify.get('/profile/avatar/:userId', {
    config: { swaggerTransform: (input) => {
      const result = jsonSchemaTransform(input);
      result.schema.response = { ...result.schema.response, 200: { description: 'Private PNG photo', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } } };
      return result;
    } },
    preHandler: [requirePermission('profile:read:self', (req) => ({ resourceOwnerId: (req.params as { userId: string }).userId }))],
    schema: { tags: ['Profile'], security: [{ CookieAuth: [] }], description: 'Read private profile photo; own account or ROOT only', params: z.object({ userId: z.string().uuid() }).strict(), response: { 200: z.any(), ...errors, 404: HttpErrorResponseSchema } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
    try {
      const image = await readAvatar(fastify, request.tenantId, request.params.userId);
      if (!image) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Profile photo not found', code: 'AVATAR_NOT_FOUND', requestId: request.id, timestamp: new Date().toISOString() });
      return reply.type('image/png').send(image);
    } catch { return unavailable(request, reply); }
  });
};

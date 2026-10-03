import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { systemRoutes } from './system.js';
import { authRoutes } from './auth.js';
import { iamRoutes } from './iam.js';
import { profileRoutes } from './profile.js';
import { notificationRoutes } from './notifications.js';
import { shopRoutes } from './shop.js';

export const v1Routes: FastifyPluginAsyncZod = async (fastify) => {
  await fastify.register(systemRoutes);
  await fastify.register(authRoutes);
  await fastify.register(iamRoutes);
  await fastify.register(profileRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(shopRoutes);
};

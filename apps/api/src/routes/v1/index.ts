import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { systemRoutes } from './system.js';
import { authRoutes } from './auth.js';
import { iamRoutes } from './iam.js';
import { profileRoutes } from './profile.js';
import { courtRoutes } from './courts.js';
import { publicRoutes } from './public.js';
import { notificationRoutes } from './notifications.js';
import { shopRoutes } from './shop.js';
import { memberRoutes } from './members.js';
import { barRoutes } from './bar.js';
import { adminJobRoutes } from './admin-jobs.js';
import { reportRoutes } from './reports.js';

export const v1Routes: FastifyPluginAsyncZod = async (fastify) => {
  await fastify.register(systemRoutes);
  await fastify.register(authRoutes);
  await fastify.register(iamRoutes);
  await fastify.register(profileRoutes);
  await fastify.register(courtRoutes);
  await fastify.register(publicRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(shopRoutes);
  await fastify.register(memberRoutes);
  await fastify.register(barRoutes);
  await fastify.register(adminJobRoutes);
  await fastify.register(reportRoutes);
};

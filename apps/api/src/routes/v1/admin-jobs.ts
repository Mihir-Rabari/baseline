import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requirePermission } from '@packages/iam';
import {
  HttpErrorResponseSchema,
  MembershipExpiryJobRequestSchema,
  MembershipExpiryJobResponseSchema,
} from '@packages/validation';
import { JobService } from '../../services/job.service.js';

/** Manual triggers for the background jobs, so a demo does not have to wait 15 minutes. */
export const adminJobRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const jobs = new JobService(fastify.db);

  fastify.post(
    '/admin/jobs/membership-expiry',
    {
      preHandler: [requirePermission('admin:access')],
      schema: {
        description: 'Run the membership expiry and reminder job now; `asOf` lets a demo jump forward',
        tags: ['Admin'],
        body: MembershipExpiryJobRequestSchema.nullish(),
        response: {
          200: MembershipExpiryJobResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await jobs.runMembershipExpiry(request.body?.asOf);
      request.log.info({ ...result, actorId: request.user!.id }, 'Membership expiry job run manually');
      return reply.status(200).send(result);
    }
  );
};

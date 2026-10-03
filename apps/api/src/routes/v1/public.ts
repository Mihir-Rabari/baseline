import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AvailabilityQuerySchema, AvailabilitySchema, HttpErrorResponseSchema } from '@packages/validation';
import { AvailabilityService } from '../../services/availability.service.js';

const PublicAvailabilityQuerySchema = AvailabilityQuerySchema.omit({ memberId: true });

export const publicRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const availabilityService = new AvailabilityService(fastify.db, fastify.env.CLUB_TIMEZONE);

  // ---------------------------------------------------------------------------
  // GET /api/v1/public/availability - no login, walk-in price, no booking details
  // ---------------------------------------------------------------------------
  fastify.get(
    '/public/availability',
    {
      // Stricter than the global limit: 30 GETs/minute/IP (API_CONTRACT.md section 3).
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        description: 'Public availability grid at walk-in prices (guests may look 2 days ahead)',
        tags: ['Public'],
        querystring: PublicAvailabilityQuerySchema,
        response: {
          200: AvailabilitySchema,
          400: HttpErrorResponseSchema,
          422: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { date, courtTypeId } = request.query;
      const availability = await availabilityService.getAvailability({
        date,
        courtTypeId,
        viewer: { kind: 'PUBLIC' },
      });
      return reply.status(200).send(availability);
    }
  );
};

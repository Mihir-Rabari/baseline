import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { authorize, type IamService } from '@packages/iam';

export type CourtCaller = 'STAFF' | 'MEMBER';

/**
 * Classifies an authenticated caller for court/availability routes (API_CONTRACT.md 5.1, roles MEM, FD, OWN):
 *  - STAFF  holds `bookings:read` (front desk, owner, root).
 *  - MEMBER holds `bookings:read:self` for their own user id.
 * Anyone else (bar staff, plain users) or any suspended/disabled account yields `null` (403), because the
 * policy engine denies every action for non-ACTIVE identities.
 */
export async function resolveCourtCaller(request: FastifyRequest): Promise<CourtCaller | null> {
  if (!request.user) return null;

  if (!request.effectiveStatements) {
    const iam = (request.server as unknown as { iamService: IamService }).iamService;
    request.effectiveStatements = await iam.getUserStatements(request.user.id);
  }
  const statements = request.effectiveStatements;

  if (authorize(request.user, 'bookings:read', statements).allowed) return 'STAFF';
  if (authorize(request.user, 'bookings:read:self', statements, { resourceOwnerId: request.user.id }).allowed) {
    return 'MEMBER';
  }
  return null;
}

/** 401 when logged out, 403 unless the caller is staff or a member. */
export const requireCourtCaller: preHandlerHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.user) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required to access this resource',
      code: 'UNAUTHORIZED',
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  }

  if ((await resolveCourtCaller(request)) === null) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You do not have permission to view court availability',
      code: 'FORBIDDEN',
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
};

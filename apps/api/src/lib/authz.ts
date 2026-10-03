import type { FastifyRequest } from 'fastify';
import { PolicyEngine, type IamService } from '@packages/iam';

/**
 * Evaluates one action for the caller inside a handler, after the route-level guard has run.
 * `ownerId` feeds the `:self` ownership check (Rule 10): a `:self` action only matches when it
 * equals the caller's id, and an owner-less resource must pass `null` so it can never match.
 */
export async function can(request: FastifyRequest, action: string, ownerId?: string | null): Promise<boolean> {
  if (!request.user) return false;
  if (!request.effectiveStatements) {
    const iam = (request.server as unknown as { iamService: IamService }).iamService;
    request.effectiveStatements = await iam.getUserStatements(request.user.id);
  }
  return PolicyEngine.evaluate({
    identity: request.user,
    action,
    statements: request.effectiveStatements,
    context: ownerId === undefined ? undefined : { resourceOwnerId: ownerId ?? '' },
  }).allowed;
}

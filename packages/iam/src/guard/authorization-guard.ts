import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { AuthUser, AuthSession } from '@packages/auth';
import type { PolicyStatement } from '@packages/validation';
import { PolicyEngine, type AuthorizationContext, type IdentitySubject } from '../policy/policy-engine.js';
import type { IamService } from '../service/iam-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    session?: AuthSession;
    effectiveStatements?: PolicyStatement[];
  }
}

/**
 * Fastify pre-handler requiring an authenticated session.
 */
export function requireAuthentication(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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
  };
}

export type ResourceContextExtractor = (
  request: FastifyRequest
) => AuthorizationContext | Promise<AuthorizationContext>;

/**
 * Fastify pre-handler enforcing that the authenticated user possesses a specific permission.
 */
export function requirePermission(
  action: string,
  resourceExtractor?: ResourceContextExtractor
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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

    const iamService = (request.server as unknown as { iamService: IamService }).iamService;
    if (!iamService) {
      request.log.error('IamService not found on Fastify instance');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Authorization engine unavailable',
        code: 'INTERNAL_SERVER_ERROR',
        requestId: request.id,
      });
    }

    // Load policy statements if not already cached on request
    if (!request.effectiveStatements) {
      request.effectiveStatements = await iamService.getUserStatements(request.user.id);
    }

    let resourceContext: AuthorizationContext | undefined;
    if (resourceExtractor) {
      resourceContext = await resourceExtractor(request);
    }

    const decision = PolicyEngine.evaluate({
      identity: request.user,
      action,
      statements: request.effectiveStatements,
      context: resourceContext,
    });

    if (!decision.allowed) {
      request.log.warn({
        userId: request.user.id,
        action,
        reason: decision.reason,
      }, `Permission denied for ${action}`);

      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `You do not have permission to perform '${action}'`,
        code: 'FORBIDDEN',
        requestId: request.id,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Fastify pre-handler enforcing that the authenticated user possesses ANY of the specified permissions.
 */
export function requireAnyPermission(actions: string[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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

    const iamService = (request.server as unknown as { iamService: IamService }).iamService;
    if (!request.effectiveStatements && iamService) {
      request.effectiveStatements = await iamService.getUserStatements(request.user.id);
    }

    const statements = request.effectiveStatements || [];

    const isAnyAllowed = actions.some((action) => {
      const decision = PolicyEngine.evaluate({
        identity: request.user!,
        action,
        statements,
      });
      return decision.allowed;
    });

    if (!isAnyAllowed) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Insufficient permissions. Required one of: ${actions.join(', ')}`,
        code: 'FORBIDDEN',
        requestId: request.id,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Standalone authorization check helper
 */
export function authorize(
  identity: IdentitySubject,
  action: string,
  statements: PolicyStatement[],
  context?: AuthorizationContext
) {
  return PolicyEngine.evaluate({
    identity,
    action,
    statements,
    context,
  });
}

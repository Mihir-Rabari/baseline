import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requirePermission } from '@packages/iam';
import {
  AgentActionParamsSchema,
  AgentActionResultSchema,
  AgentChatBodySchema,
  AgentChatResponseSchema,
  AgentConversationListSchema,
  AgentConversationParamsSchema,
  AgentConversationSchema,
  AgentStatusSchema,
  HttpErrorResponseSchema,
} from '@packages/validation';
import { z } from 'zod';
import { AgentService } from '../../services/agent/agent.service.js';
import { AGENT_PERMISSION_ACT, AGENT_PERMISSION_USE } from '../../services/agent/tools.js';

const errors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  403: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
};

/**
 * Per-user chat throttle. The rate limiter runs before the session is resolved, so the bucket is
 * keyed by a hash of the session cookie (never the raw token) and falls back to the client IP.
 */
function chatRateKey(cookieName: string) {
  return (req: { headers: { cookie?: string }; ip: string }): string => {
    const header = req.headers.cookie ?? '';
    const match = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${cookieName}=`));
    if (!match) return `ip:${req.ip}`;
    return `agent:${createHash('sha256').update(match).digest('hex').slice(0, 24)}`;
  };
}

export const agentRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // The model client and store are read lazily so tests can swap `fastify.agentLlm`.
  const service = new AgentService({
    app: fastify,
    get store() {
      return fastify.agentStore;
    },
    get llm() {
      return fastify.agentLlm;
    },
    maxToolSteps: fastify.env.AGENT_MAX_TOOL_STEPS,
    sessionCookieName: fastify.env.SESSION_COOKIE_NAME,
    clubTimezone: fastify.env.CLUB_TIMEZONE,
  });

  const use = requirePermission(AGENT_PERMISSION_USE);
  const act = requirePermission(AGENT_PERMISSION_ACT);
  const security = [{ CookieAuth: [] as string[] }];

  fastify.get(
    '/agent/status',
    {
      preHandler: [use],
      schema: {
        description: 'Whether the assistant is available, and which tools the caller may use.',
        tags: ['Agent'],
        security,
        response: { 200: AgentStatusSchema, 401: errors[401], 403: errors[403] },
      },
    },
    async (request, reply) => reply.send(await service.status(request))
  );

  fastify.post(
    '/agent/chat',
    {
      preHandler: [use],
      config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: chatRateKey(fastify.env.SESSION_COOKIE_NAME) } },
      schema: {
        description:
          'Send a message to the assistant. Read tools run immediately as the caller; writes are staged as pending actions that must be confirmed.',
        tags: ['Agent'],
        security,
        body: AgentChatBodySchema,
        response: { 200: AgentChatResponseSchema, ...errors, 429: HttpErrorResponseSchema, 503: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await service.chat(request, request.body))
  );

  fastify.post(
    '/agent/actions/:id/confirm',
    {
      preHandler: [use, act],
      schema: {
        description: 'Confirm and execute a pending agent action. Permission is re-checked at confirmation time.',
        tags: ['Agent'],
        security,
        params: AgentActionParamsSchema,
        response: { 200: AgentActionResultSchema, ...errors, 409: HttpErrorResponseSchema, 503: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await service.confirm(request, request.params.id))
  );

  fastify.post(
    '/agent/actions/:id/reject',
    {
      preHandler: [use],
      schema: {
        description: 'Reject a pending agent action; nothing is executed.',
        tags: ['Agent'],
        security,
        params: AgentActionParamsSchema,
        response: { 200: AgentActionResultSchema, ...errors, 409: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => reply.send(await service.reject(request, request.params.id))
  );

  fastify.get(
    '/agent/conversations',
    {
      preHandler: [use],
      schema: {
        description: "The caller's own conversations, newest first.",
        tags: ['Agent'],
        security,
        response: { 200: AgentConversationListSchema, 401: errors[401], 403: errors[403] },
      },
    },
    async (request, reply) => reply.send(await service.listConversations(request))
  );

  fastify.get(
    '/agent/conversations/:id',
    {
      preHandler: [use],
      schema: {
        description: 'One of the caller\'s conversations with its messages and pending actions.',
        tags: ['Agent'],
        security,
        params: AgentConversationParamsSchema,
        response: { 200: AgentConversationSchema, ...errors },
      },
    },
    async (request, reply) => reply.send(await service.getConversation(request, request.params.id))
  );

  fastify.delete(
    '/agent/conversations/:id',
    {
      preHandler: [use],
      schema: {
        description: 'Delete one of the caller\'s conversations.',
        tags: ['Agent'],
        security,
        params: AgentConversationParamsSchema,
        response: { 200: z.object({ deleted: z.literal(true) }), ...errors },
      },
    },
    async (request, reply) => {
      await service.deleteConversation(request, request.params.id);
      return reply.send({ deleted: true as const });
    }
  );
};

---
name: api
description: Fastify route development, Zod type providers, OpenAPI documentation, structured logging, and error responses.
---

# API Development Skill

## 1. When to Use
Use this skill when implementing Fastify REST routes, adding Zod input validation schemas, documenting endpoints in OpenAPI, or configuring API error handling.

## 2. Route Registration Convention
All routes must use `FastifyPluginAsyncZod` from `fastify-type-provider-zod`:
```typescript
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePermission } from '@packages/iam';
import { HttpErrorResponseSchema } from '@packages/validation';

export const featureRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/feature/:id',
    {
      preHandler: [requirePermission('feature:read')],
      schema: {
        tags: ['Feature'],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ id: z.string(), name: z.string() }),
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          403: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      request.log.info({ featureId: request.params.id }, 'Feature retrieved');
      return reply.send({ id: request.params.id, name: 'Sample Feature' });
    }
  );
};
```

## 3. Standard Error Responses & Request Correlation
- Every API response attaches an `x-request-id` header.
- All error responses conform to `HttpErrorResponseSchema` including the matching `requestId`.
- Never expose internal stack traces or connection strings in client error responses.

## 4. OpenAPI Documentation
- Interactive documentation: `/api/docs` (Swagger UI).
- Raw OpenAPI 3.0 specification: `/api/openapi.json`.
- Authentication in OpenAPI is documented as `CookieAuth` (`app_session` cookie).

## 5. Mandatory Testing Expectations
Every new API route requires:
1. **Schema Validation Test**: Verifying invalid parameters return 400 with structured validation details.
2. **Authentication Guard Test**: Verifying unauthenticated requests return 401.
3. **Authorization Guard Test**: Verifying unauthorized roles/users return 403.
4. **Success Test**: Verifying valid requests return expected status codes and matching response schema.
5. **OpenAPI Sync**: Verifying the route appears in `/api/openapi.json`.

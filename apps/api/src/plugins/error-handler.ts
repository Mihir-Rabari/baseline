import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import type { HttpErrorResponse, ErrorDetail } from '@packages/validation';

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || request.headers['x-request-id']?.toString() || 'unknown';

    // Log the error with structured context
    request.log.error({
      err: error,
      requestId,
      method: request.method,
      url: request.url,
    }, error.message);

    // 1. Handle Zod validation errors
    if (error instanceof ZodError) {
      const details: ErrorDetail[] = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
        code: e.code,
      }));

      const response: HttpErrorResponse = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        requestId,
        details,
        timestamp: new Date().toISOString(),
      };

      return reply.status(400).send(response);
    }

    // 2. Handle Fastify schema validation errors
    if ((error as FastifyError).validation) {
      const fastifyErr = error as FastifyError;
      const details: ErrorDetail[] = (fastifyErr.validation || []).map((v) => ({
        field: v.instancePath || (v.params?.issue ? String(v.params.issue) : undefined),
        message: v.message || 'Invalid field',
        code: v.keyword,
      }));

      const response: HttpErrorResponse = {
        statusCode: 400,
        error: 'Bad Request',
        message: fastifyErr.message || 'Schema validation failed',
        code: 'VALIDATION_ERROR',
        requestId,
        details,
        timestamp: new Date().toISOString(),
      };

      return reply.status(400).send(response);
    }

    // 3. Handle HTTP status code errors (Sensible / domain errors / custom codes)
    const statusCode = typeof (error as FastifyError).statusCode === 'number' ? (error as FastifyError).statusCode! : 500;

    // Canonical name and fallback code per status. Any 4xx not listed here is still
    // reported as a client error rather than falling through to the 5xx branch, which
    // previously produced responses like "422 INTERNAL_SERVER_ERROR".
    const STATUS_META: Record<number, { name: string; code: string; fallback: string }> = {
      400: { name: 'Bad Request', code: 'BAD_REQUEST', fallback: 'Malformed request' },
      401: { name: 'Unauthorized', code: 'UNAUTHORIZED', fallback: 'Authentication required' },
      403: { name: 'Forbidden', code: 'FORBIDDEN', fallback: 'Access denied' },
      404: { name: 'Not Found', code: 'NOT_FOUND', fallback: 'Requested resource not found' },
      409: { name: 'Conflict', code: 'CONFLICT', fallback: 'Resource conflict' },
      422: { name: 'Unprocessable Entity', code: 'UNPROCESSABLE_ENTITY', fallback: 'Request could not be processed' },
      429: { name: 'Too Many Requests', code: 'RATE_LIMIT_EXCEEDED', fallback: 'Rate limit exceeded' },
    };

    let errorCode: string;
    let errorName: string;
    let message: string;

    if (statusCode >= 500) {
      errorCode = 'INTERNAL_SERVER_ERROR';
      errorName = 'Internal Server Error';
      // Never surface internal error text outside development: messages routinely carry
      // connection strings, file paths and driver internals.
      const isDev = fastify.env?.NODE_ENV === 'development';
      message = isDev ? error.message : 'An internal server error occurred';
    } else {
      const meta = STATUS_META[statusCode] ?? {
        name: 'Request Error',
        code: 'REQUEST_ERROR',
        fallback: 'Request could not be completed',
      };
      errorName = meta.name;
      message = error.message || meta.fallback;
      // Domain errors (IamError, AuthenticationError, …) carry their own machine-readable
      // code. Prefer it so clients can branch on e.g. PRIVILEGE_ESCALATION_BLOCKED rather
      // than parsing a human-readable message.
      const domainCode = (error as { code?: unknown }).code;
      errorCode =
        typeof domainCode === 'string' && !domainCode.startsWith('FST_') ? domainCode : meta.code;
    }

    const response: HttpErrorResponse = {
      statusCode,
      error: errorName,
      message,
      code: errorCode,
      requestId,
      timestamp: new Date().toISOString(),
    };

    return reply.status(statusCode).send(response);
  });

  // Not Found (404) handler
  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) || request.headers['x-request-id']?.toString() || 'unknown';
    const response: HttpErrorResponse = {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      code: 'ROUTE_NOT_FOUND',
      requestId,
      timestamp: new Date().toISOString(),
    };
    return reply.status(404).send(response);
  });
}

export default fp(errorHandlerPlugin, {
  name: 'app-error-handler',
});

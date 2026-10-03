import { AppConfig, AuthConfig } from '@packages/config';
import { ApiTags } from './tags.js';

export interface OpenApiConfigOptions {
  title?: string;
  description?: string;
  version?: string;
  hostUrl?: string;
}

export function getOpenApiSpecification(options?: OpenApiConfigOptions) {
  return {
    openapi: '3.0.3',
    info: {
      title: options?.title || `${AppConfig.name} API`,
      description: options?.description || AppConfig.description,
      version: options?.version || AppConfig.version,
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: options?.hostUrl || '/',
        description: 'Current Environment Server',
      },
    ],
    tags: Object.values(ApiTags),
    components: {
      securitySchemes: {
        CookieAuth: {
          type: 'apiKey' as const,
          in: 'cookie' as const,
          name: AuthConfig.cookieName || 'app_session',
          description: 'Secure HTTP-only session cookie authentication',
        },
      },
      schemas: {
        HttpErrorResponse: {
          type: 'object' as const,
          required: ['statusCode', 'error', 'message', 'code', 'requestId'],
          properties: {
            statusCode: { type: 'integer' as const, example: 400 },
            error: { type: 'string' as const, example: 'Bad Request' },
            message: { type: 'string' as const, example: 'Validation failed' },
            code: { type: 'string' as const, example: 'VALIDATION_ERROR' },
            requestId: { type: 'string' as const, example: 'req_1725000000000_abc1234' },
            details: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  field: { type: 'string' as const },
                  message: { type: 'string' as const },
                  code: { type: 'string' as const },
                },
              },
            },
            timestamp: { type: 'string' as const, format: 'date-time' },
          },
        },
      },
    },
  };
}

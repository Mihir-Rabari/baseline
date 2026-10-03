import { z } from 'zod';

export const ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const HttpErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  code: z.string(),
  requestId: z.string().optional(),
  details: z.array(ErrorDetailSchema).optional(),
  timestamp: z.string().datetime().optional(),
});
export type HttpErrorResponse = z.infer<typeof HttpErrorResponseSchema>;

export const ValidationErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(400),
  code: z.literal('VALIDATION_ERROR'),
  details: z.array(ErrorDetailSchema),
});
export type ValidationErrorResponse = z.infer<typeof ValidationErrorResponseSchema>;

export const NotFoundErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(404),
  code: z.literal('NOT_FOUND'),
});
export type NotFoundErrorResponse = z.infer<typeof NotFoundErrorResponseSchema>;

export const ConflictErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(409),
  code: z.literal('CONFLICT'),
});
export type ConflictErrorResponse = z.infer<typeof ConflictErrorResponseSchema>;

export const UnauthorizedErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(401),
  code: z.literal('UNAUTHORIZED'),
});
export type UnauthorizedErrorResponse = z.infer<typeof UnauthorizedErrorResponseSchema>;

export const ForbiddenErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(403),
  code: z.literal('FORBIDDEN'),
});
export type ForbiddenErrorResponse = z.infer<typeof ForbiddenErrorResponseSchema>;

export const InternalServerErrorResponseSchema = HttpErrorResponseSchema.extend({
  statusCode: z.literal(500),
  code: z.literal('INTERNAL_SERVER_ERROR'),
});
export type InternalServerErrorResponse = z.infer<typeof InternalServerErrorResponseSchema>;

import { describe, it, expect } from 'vitest';
import {
  PaginationQuerySchema,
  createPaginatedResponseSchema,
  EmailSchema,
  SlugSchema,
  IdParamSchema,
  UuidParamSchema,
  HttpErrorResponseSchema,
} from './index.js';
import { z } from 'zod';

describe('Shared Validation Schemas (@packages/validation)', () => {
  describe('Pagination schemas', () => {
    it('should parse and coerce valid pagination query params', () => {
      const parsed = PaginationQuerySchema.parse({
        page: '2',
        limit: '50',
        order: 'asc',
      });

      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(50);
      expect(parsed.order).toBe('asc');
    });

    it('should enforce default values and bounds', () => {
      const parsed = PaginationQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
      expect(parsed.order).toBe('desc');

      // Max limit is 100
      expect(() => PaginationQuerySchema.parse({ limit: 500 })).toThrow();
    });

    it('should validate structured paginated responses', () => {
      const ItemSchema = z.object({ id: z.string(), name: z.string() });
      const PaginatedSchema = createPaginatedResponseSchema(ItemSchema);

      const valid = PaginatedSchema.parse({
        data: [{ id: '1', name: 'Item 1' }],
        meta: {
          page: 1,
          limit: 20,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });

      expect(valid.data.length).toBe(1);
      expect(valid.meta.totalItems).toBe(1);
    });
  });

  describe('Common field validators', () => {
    it('should validate emails and normalize to lowercase', () => {
      expect(EmailSchema.parse('USER@Example.COM')).toBe('user@example.com');
      expect(() => EmailSchema.parse('invalid-email')).toThrow();
    });

    it('should validate slugs', () => {
      expect(SlugSchema.parse('my-project-123')).toBe('my-project-123');
      expect(() => SlugSchema.parse('Invalid Slug!')).toThrow();
    });

    it('should validate IDs and UUIDs', () => {
      expect(IdParamSchema.parse({ id: 'custom-id-123' })).toEqual({ id: 'custom-id-123' });
      expect(UuidParamSchema.parse({ id: '123e4567-e89b-12d3-a456-426614174000' })).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(() => UuidParamSchema.parse({ id: 'not-a-uuid' })).toThrow();
    });
  });

  describe('HTTP error schemas', () => {
    it('should parse structured HTTP error responses', () => {
      const errorResponse = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        requestId: 'req-abc-123',
        details: [
          {
            field: 'email',
            message: 'Invalid email address',
            code: 'invalid_string',
          },
        ],
      };

      const parsed = HttpErrorResponseSchema.parse(errorResponse);
      expect(parsed.code).toBe('VALIDATION_ERROR');
      expect(parsed.details?.[0].field).toBe('email');
    });
  });
});

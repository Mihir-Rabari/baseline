import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpErrorResponseSchema } from '@packages/validation';
import errorHandler from './plugins/error-handler.js';
import { DomainError } from './lib/domain-error.js';

function pgError(code: string, message = 'duplicate key value violates unique constraint "secret_idx"') {
  return Object.assign(new Error(message), { code, constraint: 'secret_idx' });
}

describe('error handler: DomainError and Postgres mappings', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ genReqId: () => 'req_test_1' });
    await app.register(errorHandler);

    app.get('/slot-taken', async () => {
      throw new DomainError('SLOT_TAKEN', 409, 'That court is already booked for this time.', [
        { field: 'startsAt', message: 'Court is busy 18:00-19:00', code: 'OVERLAP' },
      ]);
    });
    app.get('/daily-limit', async () => {
      throw new DomainError('DAILY_LIMIT_REACHED', 422, 'You already have 2 bookings on this day.');
    });
    app.get('/bad', async () => {
      throw new DomainError('VALIDATION_ERROR', 400, 'Bad input');
    });
    app.get('/share', async () => {
      throw new DomainError('SHARE_LINK_INVALID', 404, 'Share link is invalid.');
    });
    app.get('/pg-exclusion', async () => {
      throw pgError('23P01', 'conflicting key value violates exclusion constraint "court_occupancies_no_overlap"');
    });
    app.get('/pg-unique', async () => {
      throw pgError('23505');
    });
    app.get('/pg-check', async () => {
      throw pgError('23514', 'new row violates check constraint "stock_qty_non_negative"');
    });
    app.get('/pg-wrapped', async () => {
      throw Object.assign(new Error('Failed query: insert into ...'), { cause: pgError('23P01') });
    });
    app.get('/pg-other', async () => {
      throw pgError('42P01', 'relation "secret_table" does not exist');
    });
    app.get('/boom', async () => {
      throw new Error('connection string postgres://user:pw@host/db');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps DomainError 409 with details, requestId and timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/slot-taken' });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(HttpErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'SLOT_TAKEN',
      message: 'That court is already booked for this time.',
      requestId: 'req_test_1',
      details: [{ field: 'startsAt', message: 'Court is busy 18:00-19:00', code: 'OVERLAP' }],
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('maps DomainError 422 and omits details when none are given', async () => {
    const res = await app.inject({ method: 'GET', url: '/daily-limit' });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body).toMatchObject({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: 'DAILY_LIMIT_REACHED',
      requestId: 'req_test_1',
    });
    expect(body.details).toBeUndefined();
    expect(body.timestamp).toBeDefined();
  });

  it('maps DomainError 400 and 404', async () => {
    const bad = await app.inject({ method: 'GET', url: '/bad' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'Bad Request', code: 'VALIDATION_ERROR', requestId: 'req_test_1' });

    const nf = await app.inject({ method: 'GET', url: '/share' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({ error: 'Not Found', code: 'SHARE_LINK_INVALID', requestId: 'req_test_1' });
  });

  it('maps Postgres 23P01 (exclusion) to 409 without leaking the constraint', async () => {
    const res = await app.inject({ method: 'GET', url: '/pg-exclusion' });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body).toMatchObject({ statusCode: 409, error: 'Conflict', code: 'CONFLICT', requestId: 'req_test_1' });
    expect(body.timestamp).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('court_occupancies_no_overlap');
  });

  it('maps Postgres 23505 (unique) to 409 without leaking the constraint', async () => {
    const res = await app.inject({ method: 'GET', url: '/pg-unique' });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body).toMatchObject({ statusCode: 409, code: 'CONFLICT', requestId: 'req_test_1' });
    expect(JSON.stringify(body)).not.toContain('secret_idx');
  });

  it('maps Postgres 23514 (check) to 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/pg-check' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ statusCode: 400, error: 'Bad Request', code: 'VALIDATION_ERROR', requestId: 'req_test_1' });
    expect(JSON.stringify(body)).not.toContain('stock_qty_non_negative');
  });

  it('finds the SQLSTATE on a wrapped cause', async () => {
    const res = await app.inject({ method: 'GET', url: '/pg-wrapped' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('keeps unmapped Postgres errors and unknown errors as sanitised 500s', async () => {
    for (const url of ['/pg-other', '/boom']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', requestId: 'req_test_1' });
      expect(JSON.stringify(body)).not.toContain('postgres://');
      expect(JSON.stringify(body)).not.toContain('secret_table');
    }
  });
});

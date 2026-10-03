import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('empty JSON bodies (regression #76)', () => {
  it('does not 400 on Content-Type: application/json with no body, but still rejects malformed JSON', async () => {
    const app = buildApp();
    app.post('/__echo', async (request) => ({ body: request.body ?? null }));
    await app.ready();
    const empty = await app.inject({ method: 'POST', url: '/__echo', headers: { 'content-type': 'application/json' } });
    expect(empty.statusCode).toBe(200);
    const ok = await app.inject({ method: 'POST', url: '/__echo', payload: { a: 1 } });
    expect(ok.json()).toEqual({ body: { a: 1 } });
    const bad = await app.inject({ method: 'POST', url: '/__echo', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

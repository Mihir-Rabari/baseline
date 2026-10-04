import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, members, systemSettings, users } from '@packages/db';
import { ClubProfileSchema, MemberSchema } from '@packages/validation';
import { buildApp } from './app.js';
import { isDatabaseAvailable } from './test-support/database.js';
import { createMember } from './test-support/court-fixtures.js';
import { makeActor, nextIp, rolesSeeded, type Actor } from './test-support/role-actors.js';

const API = '/api/v1';

describe('Edit endpoints: member details and club profile', () => {
  let app: FastifyInstance;
  let ready = false;
  const db = getDb();
  const userIds: string[] = [];
  const memberIds: string[] = [];
  let owner: Actor;
  let desk: Actor;
  let bar: Actor;
  let member: Actor;
  let targetId = '';
  let savedProfile: unknown;

  const call = (method: 'GET' | 'PATCH' | 'PUT', url: string, actor: Actor | null, payload?: object) =>
    app.inject({ method, url: `${API}${url}`, remoteAddress: nextIp(), headers: actor ? { cookie: actor.cookie } : undefined, payload });

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ready = (await isDatabaseAvailable()) && (await rolesSeeded());
    if (!ready) return;
    [owner, desk, bar, member] = await Promise.all([makeActor(app, 'OWNER', 'edit'), makeActor(app, 'FRONT_DESK', 'edit'), makeActor(app, 'BAR_STAFF', 'edit'), makeActor(app, 'MEMBER', 'edit')]);
    userIds.push(owner.id, desk.id, bar.id, member.id);
    const row = await createMember(db, { fullName: 'Edit Target' });
    targetId = row.id;
    memberIds.push(row.id);
    const [existing] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'club.profile')).limit(1);
    savedProfile = existing?.value;
  }, 60_000);

  afterAll(async () => {
    if (ready) {
      if (savedProfile === undefined) await db.delete(systemSettings).where(eq(systemSettings.key, 'club.profile'));
      else await db.update(systemSettings).set({ value: savedProfile }).where(eq(systemSettings.key, 'club.profile'));
      if (memberIds.length) await db.delete(members).where(inArray(members.id, memberIds));
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    }
    await app.close();
  });

  describe('PATCH /members/:id', () => {
    it('401 without a session', async () => {
      expect((await call('PATCH', `/members/${randomUUID()}`, null, { fullName: 'X' })).statusCode).toBe(401);
    });

    it('adversarial: bar staff and members cannot edit a member', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const actor of [bar, member]) expect((await call('PATCH', `/members/${targetId}`, actor, { fullName: 'Hacked' })).statusCode).toBe(403);
      const [row] = await db.select().from(members).where(eq(members.id, targetId));
      expect(row.fullName).toBe('Edit Target');
    });

    it('front desk edits only the fields sent and the change is returned', async (ctx) => {
      if (!ready) return ctx.skip();
      const res = await call('PATCH', `/members/${targetId}`, desk, { fullName: 'Edited Name', email: 'edited@example.com', dateOfBirth: '1990-04-12', notes: 'Prefers mornings' });
      expect(res.statusCode).toBe(200);
      expect(MemberSchema.parse(res.json())).toMatchObject({ id: targetId, fullName: 'Edited Name', email: 'edited@example.com', dateOfBirth: '1990-04-12' });
      const phoneBefore = (await db.select().from(members).where(eq(members.id, targetId)))[0].phone;
      const second = await call('PATCH', `/members/${targetId}`, desk, { phone: '+919811122233' });
      expect(second.json()).toMatchObject({ fullName: 'Edited Name', phone: '+919811122233' });
      expect(phoneBefore).not.toBe('+919811122233');
      const [row] = await db.select().from(members).where(eq(members.id, targetId));
      expect(row.notes).toBe('Prefers mornings');
    });

    it('400 for a malformed phone, email or date; 404 for an unknown member; an empty body changes nothing', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const bad of [{ phone: '12' }, { email: 'nope' }, { dateOfBirth: '1990-02-30' }, { fullName: '' }]) expect((await call('PATCH', `/members/${targetId}`, desk, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      expect((await call('PATCH', `/members/${randomUUID()}`, desk, { fullName: 'X' })).statusCode).toBe(404);
      expect((await call('PATCH', '/members/not-a-uuid', desk, { fullName: 'X' })).statusCode).toBe(400);
      expect((await call('PATCH', `/members/${targetId}`, desk, {})).statusCode).toBe(200);
    });
  });

  describe('PUT /club/profile', () => {
    it('401 without a session', async () => {
      expect((await call('PUT', '/club/profile', null, { name: 'X' })).statusCode).toBe(401);
    });

    it('adversarial: front desk, bar staff and members cannot change the public club details', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const actor of [desk, bar, member]) expect((await call('PUT', '/club/profile', actor, { name: 'Hijacked Club' })).statusCode).toBe(403);
      const pub = await call('GET', '/public/club', null);
      expect(pub.json().name).not.toBe('Hijacked Club');
    });

    it('400 for an empty body, a blank name and an over-long tagline', async (ctx) => {
      if (!ready) return ctx.skip();
      for (const bad of [{}, { name: '  ' }, { tagline: 'x'.repeat(201) }, { phone: 'x'.repeat(33) }]) expect((await call('PUT', '/club/profile', owner, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    });

    it('owner changes some fields, keeps the rest, and the public site shows the result', async (ctx) => {
      if (!ready) return ctx.skip();
      const first = await call('PUT', '/club/profile', owner, { name: 'Edit Test Club', tagline: 'First tagline', phone: '+91 90000 00001', address: '1 Test Street' });
      expect(ClubProfileSchema.parse(first.json())).toEqual({ name: 'Edit Test Club', tagline: 'First tagline', phone: '+91 90000 00001', address: '1 Test Street', logoUrl: null });
      const second = await call('PUT', '/club/profile', owner, { tagline: 'Second tagline' });
      expect(second.json()).toEqual({ name: 'Edit Test Club', tagline: 'Second tagline', phone: '+91 90000 00001', address: '1 Test Street', logoUrl: null });
      const pub = await call('GET', '/public/club', null);
      expect(pub.json()).toMatchObject({ name: 'Edit Test Club', tagline: 'Second tagline', phone: '+91 90000 00001', address: '1 Test Street' });
    });
  });
});

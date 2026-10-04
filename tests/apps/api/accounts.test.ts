import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, invoices, members, passwordSetupTokens, payments, userRoles, users, roles } from '@packages/db';
import { verifyPassword } from '@packages/auth';
import { buildApp } from '../../../apps/api/src/app.js';
import { isDatabaseAvailable } from '../../../apps/api/src/test-support/database.js';
import { createMember } from '../../../apps/api/src/test-support/court-fixtures.js';
import { makeActor, nextIp, rolesSeeded } from '../../../apps/api/src/test-support/role-actors.js';
import { AccountService } from '../../../apps/api/src/services/account.service.js';
import { EmailService, type OutgoingEmail } from '../../../apps/api/src/services/email.service.js';

const API = '/api/v1';
const HOUR = 3_600_000;

/** An email service that records what it was asked to send and never leaves the process. */
class RecordingEmail extends EmailService {
  sent: OutgoingEmail[] = [];
  constructor() { super({ apiKey: 'unused', from: 'Club <noreply@vedlabs.tech>', enabled: true, log: { info: () => undefined, warn: () => undefined } }); }
  override async send(email: OutgoingEmail) { this.sent.push(email); return { sent: true as const, id: 'recorded' }; }
}

describe('Member logins, welcome and reset links (accounts)', () => {
  let app: FastifyInstance;
  let ready = false;
  const db = getDb();
  const userIds: string[] = [];
  const memberIds: string[] = [];
  let mail: RecordingEmail;
  let now = new Date();
  let accounts: AccountService;
  const revoked: string[] = [];

  const call = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url: `${API}${url}`, remoteAddress: nextIp(), payload });
  const emailOf = () => `acct-${randomUUID().slice(0, 8)}@vedlabs.tech`;
  const tokenFromMail = (index = -1) => /token=([a-f0-9]+)/.exec(mail.sent.at(index)!.text)![1];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ready = (await isDatabaseAvailable()) && (await rolesSeeded());
    if (!ready) return;
    mail = new RecordingEmail();
    accounts = new AccountService(db, {
      email: mail, sessions: { revokeAllUserSessions: async (id: string) => { revoked.push(id); } }, webUrl: 'https://club.example/', clubName: async () => 'Test Club',
      defaultPolicy: app.appConfig.iam.defaultExternalUserPolicy, defaultRole: app.appConfig.iam.defaultRole, minPasswordLength: 8, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => now,
    });
  }, 60_000);

  afterAll(async () => {
    if (ready) {
      if (memberIds.length) {
        await db.delete(invoices).where(inArray(invoices.memberId, memberIds));
        await db.delete(payments).where(inArray(payments.memberId, memberIds));
        await db.delete(members).where(inArray(members.id, memberIds));
      }
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    }
    await app.close();
  });

  async function newMember(email: string | null, extra: { userId?: string } = {}) {
    const row = await createMember(db, { fullName: 'Acct Test', ...extra });
    if (email) await db.update(members).set({ email }).where(eq(members.id, row.id));
    memberIds.push(row.id);
    return row.id;
  }
  const userOf = async (memberId: string) => {
    const [m] = await db.select().from(members).where(eq(members.id, memberId));
    if (m.userId) userIds.push(m.userId);
    return m.userId;
  };

  describe('provisioning a login for a registered member', () => {
    it('creates the account, gives it the MEMBER role, links it and emails a link (never a password)', async (ctx) => {
      if (!ready) return ctx.skip();
      const email = emailOf();
      const memberId = await newMember(email);
      mail.sent = [];
      expect(await accounts.provisionMemberLogin({ id: memberId, fullName: 'Acct Test', email, planName: 'Silver' })).toEqual({ created: true });
      const userId = (await userOf(memberId))!;
      expect(userId).toBeTruthy();
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(user).toMatchObject({ email, status: 'ACTIVE', identityType: 'EXTERNAL_USER' });
      const assigned = await db.select({ name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
      expect(assigned.map((r) => r.name)).toContain('MEMBER');
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({ to: email });
      expect(mail.sent[0].html).toContain('https://club.example/set-password?token=');
      expect(mail.sent[0].subject).toContain('Test Club');
      // The unusable placeholder password cannot be guessed: it is random and never leaves the process.
      expect(await verifyPassword('password', user.passwordHash)).toBe(false);
    });

    it('does nothing for a missing email, a reserved test domain, an existing login, or an email another account owns', async (ctx) => {
      if (!ready) return ctx.skip();
      mail.sent = [];
      expect(await accounts.provisionMemberLogin({ id: await newMember(null), fullName: 'A', email: null })).toEqual({ created: false, reason: 'NO_EMAIL' });
      expect(await accounts.provisionMemberLogin({ id: await newMember('demo@example.com'), fullName: 'A', email: 'demo@example.com' })).toEqual({ created: false, reason: 'UNDELIVERABLE_EMAIL' });
      const owner = await makeActor(app, 'MEMBER', 'acct');
      userIds.push(owner.id);
      // Signed-up test users have example.com addresses; give this one a real domain so the clash is about ownership.
      await db.update(users).set({ email: emailOf() }).where(eq(users.id, owner.id));
      const [owned] = await db.select().from(users).where(eq(users.id, owner.id));
      const withLogin = await newMember(emailOf(), { userId: owner.id });
      expect((await accounts.provisionMemberLogin({ id: withLogin, fullName: 'A', email: emailOf() })).reason).toBe('ALREADY_HAS_LOGIN');
      const clash = await newMember(owned.email);
      expect(await accounts.provisionMemberLogin({ id: clash, fullName: 'A', email: owned.email })).toEqual({ created: false, reason: 'EMAIL_IN_USE' });
      expect((await db.select().from(members).where(eq(members.id, clash)))[0].userId).toBeNull(); // never linked to a stranger's account
      expect(mail.sent).toHaveLength(0);
    });

    it('provisioning twice for the same member creates one account', async (ctx) => {
      if (!ready) return ctx.skip();
      const email = emailOf();
      const memberId = await newMember(email);
      const results = await Promise.all([accounts.provisionMemberLogin({ id: memberId, fullName: 'A', email }), accounts.provisionMemberLogin({ id: memberId, fullName: 'A', email })]);
      await userOf(memberId);
      expect(results.filter((r) => r.created).length).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
    });
  });

  describe('choosing a password with a link', () => {
    async function memberWithLink() {
      const email = emailOf();
      const memberId = await newMember(email);
      mail.sent = [];
      await accounts.provisionMemberLogin({ id: memberId, fullName: 'Link Test', email });
      const userId = (await userOf(memberId))!;
      return { email, userId, token: tokenFromMail() };
    }

    it('sets the password once, then the link is dead and other sessions are signed out', async (ctx) => {
      if (!ready) return ctx.skip();
      const { userId, token } = await memberWithLink();
      expect(await accounts.checkToken(token)).toBe(true);
      await accounts.setPassword(token, 'A-new-password-1');
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      expect(await verifyPassword('A-new-password-1', user.passwordHash)).toBe(true);
      expect(revoked).toContain(userId);
      expect(await accounts.checkToken(token)).toBe(false);
      await expect(accounts.setPassword(token, 'Another-password-2')).rejects.toMatchObject({ code: 'INVALID_LINK', statusCode: 400 });
    });

    it('rejects an unknown, expired or too-short use and keeps the link alive after a short password', async (ctx) => {
      if (!ready) return ctx.skip();
      const { token } = await memberWithLink();
      await expect(accounts.setPassword('f'.repeat(64), 'A-new-password-1')).rejects.toMatchObject({ code: 'INVALID_LINK' });
      await expect(accounts.setPassword(token, 'short')).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(await accounts.checkToken(token)).toBe(true);
      now = new Date(Date.now() + 73 * HOUR);
      expect(await accounts.checkToken(token)).toBe(false);
      await expect(accounts.setPassword(token, 'A-new-password-1')).rejects.toMatchObject({ code: 'INVALID_LINK' });
      now = new Date();
    });

    it('a newer link replaces the older one', async (ctx) => {
      if (!ready) return ctx.skip();
      const { userId, token } = await memberWithLink();
      const newer = await accounts.issueToken(userId, 'WELCOME', HOUR);
      expect(await accounts.checkToken(token)).toBe(false);
      expect(await accounts.checkToken(newer)).toBe(true);
    });

    it('only the hash of a link is stored', async (ctx) => {
      if (!ready) return ctx.skip();
      const { userId, token } = await memberWithLink();
      const rows = await db.select().from(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId));
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });

  describe('forgot password', () => {
    it('emails a reset link to a real account, nothing to an unknown address or a suspended one, never to root', async (ctx) => {
      if (!ready) return ctx.skip();
      const person = await makeActor(app, 'MEMBER', 'forgot');
      userIds.push(person.id);
      const [row] = await db.select().from(users).where(eq(users.id, person.id));
      await db.update(users).set({ email: `forgot-${randomUUID().slice(0, 8)}@vedlabs.tech` }).where(eq(users.id, person.id));
      const [updated] = await db.select().from(users).where(eq(users.id, person.id));
      expect(updated.email).not.toBe(row.email);
      mail.sent = [];
      await accounts.requestReset('nobody-here@vedlabs.tech');
      await accounts.requestReset('  ' + updated.email.toUpperCase() + ' ');
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({ to: updated.email });
      expect(mail.sent[0].html).toContain('Reset your password');
      await accounts.setPassword(tokenFromMail(), 'Reset-password-9');
      expect(await verifyPassword('Reset-password-9', (await db.select().from(users).where(eq(users.id, person.id)))[0].passwordHash)).toBe(true);

      await db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, person.id));
      mail.sent = [];
      await accounts.requestReset(updated.email);
      expect(mail.sent).toHaveLength(0);

      const [root] = await db.select().from(users).where(eq(users.identityType, 'ROOT')).limit(1);
      if (root) { await accounts.requestReset(root.email); expect(mail.sent).toHaveLength(0); }
    });
  });

  describe('HTTP routes', () => {
    it('forgot answers the same for known and unknown emails and rejects a malformed one', async (ctx) => {
      if (!ready) return ctx.skip();
      const unknown = await call('POST', '/auth/password/forgot', { email: 'nobody-at-all@vedlabs.tech' });
      const known = await call('POST', '/auth/password/forgot', { email: 'owner@courtos.test' });
      expect(unknown.statusCode).toBe(200);
      expect(known.statusCode).toBe(200);
      expect(unknown.json()).toEqual(known.json());
      expect((await call('POST', '/auth/password/forgot', { email: 'nope' })).statusCode).toBe(400);
      expect((await call('POST', '/auth/password/forgot', {})).statusCode).toBe(400);
    });

    it('setup: 400 for a bad link, 400 for a short password, 200 with a valid link, then the link cannot be reused', async (ctx) => {
      if (!ready) return ctx.skip();
      const person = await makeActor(app, 'MEMBER', 'route');
      userIds.push(person.id);
      const token = await app.accountService.issueToken(person.id, 'WELCOME', HOUR);
      const bad = await call('POST', '/auth/password/setup', { token: 'z'.repeat(64), password: 'Long-enough-1' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().code).toBe('INVALID_LINK');
      expect((await call('POST', '/auth/password/setup', { token, password: 'short' })).statusCode).toBe(400);
      expect((await call('POST', '/auth/password/setup', { token: 'tiny', password: 'Long-enough-1' })).statusCode).toBe(400);
      const check = await call('GET', `/auth/password/check?token=${token}`);
      expect(check.json()).toEqual({ valid: true });
      const ok = await call('POST', '/auth/password/setup', { token, password: 'Long-enough-1' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ success: true });
      expect((await call('POST', '/auth/password/setup', { token, password: 'Another-long-2' })).json().code).toBe('INVALID_LINK');
      expect((await call('GET', `/auth/password/check?token=${token}`)).json()).toEqual({ valid: false });
      const [email] = (await db.select({ email: users.email }).from(users).where(eq(users.id, person.id)));
      const login = await call('POST', '/auth/login', { email: email.email, password: 'Long-enough-1' });
      expect(login.statusCode).toBe(200);
    });

    it('registering a member with a real email creates a login; a demo address does not', async (ctx) => {
      if (!ready) return ctx.skip();
      const desk = await makeActor(app, 'FRONT_DESK', 'reg');
      userIds.push(desk.id);
      const plans = await app.inject({ method: 'GET', url: `${API}/plans`, headers: { cookie: desk.cookie } });
      const plan = plans.json()[0];
      const register = async (email: string) => {
        const res = await app.inject({ method: 'POST', url: `${API}/members`, remoteAddress: nextIp(), headers: { cookie: desk.cookie }, payload: { fullName: 'Reg Test', phone: `+9198${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, email, planId: plan.id, paymentMethod: 'CASH' } });
        expect(res.statusCode, res.body).toBe(201);
        memberIds.push(res.json().member.id);
        return res.json().member.id as string;
      };
      const real = await register(emailOf());
      const demo = await register(`demo-${randomUUID().slice(0, 6)}@example.com`);
      await new Promise((resolve) => setTimeout(resolve, 400)); // provisioning runs in the background
      expect((await db.select().from(members).where(eq(members.id, real)))[0].userId).not.toBeNull();
      expect((await db.select().from(members).where(eq(members.id, demo)))[0].userId).toBeNull();
      await userOf(real);
    });
  });
});

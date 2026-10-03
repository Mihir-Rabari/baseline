import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { members, passwordSetupTokens, policies, roles, userPolicies, userRoles, users, type DatabaseInstance } from '@packages/db';
import { generateSessionToken, hashPassword, hashSessionToken, type SessionManager } from '@packages/auth';
import { DomainError } from '../lib/domain-error.js';
import { EmailService } from './email.service.js';
import { accountCreatedEmail, passwordResetEmail, welcomeMemberEmail } from './email-templates.js';

export const WELCOME_LINK_HOURS = 72;
export const RESET_LINK_MINUTES = 60;

interface Logger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface AccountDeps {
  email: EmailService;
  sessions: Pick<SessionManager, 'revokeAllUserSessions'>;
  webUrl: string;
  clubName: () => Promise<string>;
  defaultPolicy: string;
  defaultRole?: string;
  minPasswordLength: number;
  log: Logger;
  now?: () => Date;
}

const invalidLink = () => new DomainError('INVALID_LINK', 400, 'This link is not valid any more. Ask for a new one.');

/**
 * Logins for people the club registers, and the one-time links that let anyone set or reset a
 * password. Passwords are never emailed: a person gets a link that works once and expires, and the
 * database keeps only a hash of it.
 */
export class AccountService {
  constructor(private readonly db: DatabaseInstance, private readonly deps: AccountDeps) {}

  private now() {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private url(path: string, token?: string) {
    return `${this.deps.webUrl.replace(/\/+$/, '')}${path}${token ? `?token=${token}` : ''}`;
  }

  /** Creates a link that works once. Earlier unused links for the same person and purpose stop working. */
  async issueToken(userId: string, purpose: 'WELCOME' | 'RESET', ttlMs: number): Promise<string> {
    const token = generateSessionToken();
    await this.db.transaction(async (tx) => {
      await tx.update(passwordSetupTokens).set({ usedAt: this.now() })
        .where(and(eq(passwordSetupTokens.userId, userId), eq(passwordSetupTokens.purpose, purpose), isNull(passwordSetupTokens.usedAt)));
      await tx.insert(passwordSetupTokens).values({ userId, tokenHash: hashSessionToken(token), purpose, expiresAt: new Date(this.now().getTime() + ttlMs) });
    });
    return token;
  }

  /**
   * Gives a newly registered member a login and emails them how to choose a password. It does
   * nothing (and says why) when the member has no deliverable email, already has a login, or the
   * email already belongs to another account. Callers should not wait for it.
   */
  async provisionMemberLogin(member: { id: string; fullName: string; email: string | null; planName?: string | null }): Promise<{ created: boolean; reason?: string }> {
    const email = member.email?.toLowerCase().trim();
    if (!email) return { created: false, reason: 'NO_EMAIL' };
    if (!EmailService.isDeliverable(email)) return { created: false, reason: 'UNDELIVERABLE_EMAIL' };
    const passwordHash = await hashPassword(randomBytes(32).toString('hex')); // unusable until the person sets their own
    const outcome = await this.db.transaction(async (tx) => {
      // The member row is locked, so two requests for the same member cannot both create an account.
      const [row] = await tx.select({ userId: members.userId }).from(members).where(eq(members.id, member.id)).for('update');
      if (!row) return { reason: 'MEMBER_NOT_FOUND' as const };
      if (row.userId) return { reason: 'ALREADY_HAS_LOGIN' as const };
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      // An existing account with this email might belong to someone else, so it is never linked automatically.
      if (taken) return { reason: 'EMAIL_IN_USE' as const };
      const [created] = await tx.insert(users).values({ email, name: member.fullName.trim(), passwordHash, status: 'ACTIVE', identityType: 'EXTERNAL_USER' }).returning({ id: users.id });
      const [policy] = await tx.select({ id: policies.id }).from(policies).where(eq(policies.name, this.deps.defaultPolicy)).limit(1);
      if (policy) await tx.insert(userPolicies).values({ userId: created.id, policyId: policy.id }).onConflictDoNothing();
      if (this.deps.defaultRole) {
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.name, this.deps.defaultRole)).limit(1);
        if (role) await tx.insert(userRoles).values({ userId: created.id, roleId: role.id }).onConflictDoNothing();
      }
      await tx.update(members).set({ userId: created.id }).where(eq(members.id, member.id));
      return { userId: created.id };
    });
    if ('reason' in outcome) return { created: false, reason: outcome.reason };
    const userId = outcome.userId;
    const token = await this.issueToken(userId, 'WELCOME', WELCOME_LINK_HOURS * 3_600_000);
    const clubName = await this.deps.clubName();
    const result = await this.deps.email.send({
      to: email,
      ...welcomeMemberEmail({ clubName, name: member.fullName, loginEmail: email, setPasswordUrl: this.url('/set-password', token), validHours: WELCOME_LINK_HOURS, planName: member.planName }),
    });
    this.deps.log.info({ memberId: member.id, userId, emailSent: result.sent }, 'Member login created');
    return { created: true };
  }

  /** The confirmation email for someone who created their own account on the website. */
  async sendAccountCreated(user: { name: string; email: string }, planName?: string | null): Promise<void> {
    const clubName = await this.deps.clubName();
    await this.deps.email.send({ to: user.email, ...accountCreatedEmail({ clubName, name: user.name, loginEmail: user.email, loginUrl: this.url('/login'), planName }) });
  }

  /** Always resolves the same way, so the response never reveals which emails have accounts. */
  async requestReset(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    const [user] = await this.db.select({ id: users.id, name: users.name, status: users.status, identityType: users.identityType }).from(users).where(eq(users.email, email)).limit(1);
    // The root account is never reset by email.
    if (!user || user.status !== 'ACTIVE' || user.identityType === 'ROOT') return;
    const token = await this.issueToken(user.id, 'RESET', RESET_LINK_MINUTES * 60_000);
    const clubName = await this.deps.clubName();
    await this.deps.email.send({ to: email, ...passwordResetEmail({ clubName, name: user.name, resetUrl: this.url('/set-password', token), validMinutes: RESET_LINK_MINUTES }) });
  }

  /** Uses a link once to set a new password, and signs the person out everywhere else. */
  async setPassword(token: string, password: string): Promise<void> {
    if (password.length < this.deps.minPasswordLength) {
      throw new DomainError('VALIDATION_ERROR', 400, `Password must be at least ${this.deps.minPasswordLength} characters long`, [
        { field: 'password', message: `At least ${this.deps.minPasswordLength} characters`, code: 'TOO_SHORT' },
      ]);
    }
    const passwordHash = await hashPassword(password);
    const userId = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(passwordSetupTokens).where(eq(passwordSetupTokens.tokenHash, hashSessionToken(token))).for('update');
      if (!row || row.usedAt || row.expiresAt.getTime() <= this.now().getTime()) throw invalidLink();
      const [user] = await tx.select({ status: users.status, identityType: users.identityType }).from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || user.status !== 'ACTIVE' || user.identityType === 'ROOT') throw invalidLink();
      await tx.update(users).set({ passwordHash, updatedAt: this.now() }).where(eq(users.id, row.userId));
      await tx.update(passwordSetupTokens).set({ usedAt: this.now() }).where(and(eq(passwordSetupTokens.userId, row.userId), isNull(passwordSetupTokens.usedAt)));
      return row.userId;
    });
    await this.deps.sessions.revokeAllUserSessions(userId);
  }

  /** Whether a link would still work, so the page can say so before asking for a password. */
  async checkToken(token: string): Promise<boolean> {
    const [row] = await this.db.select({ usedAt: passwordSetupTokens.usedAt, expiresAt: passwordSetupTokens.expiresAt }).from(passwordSetupTokens)
      .where(eq(passwordSetupTokens.tokenHash, hashSessionToken(token))).limit(1);
    return Boolean(row && !row.usedAt && row.expiresAt.getTime() > this.now().getTime());
  }
}

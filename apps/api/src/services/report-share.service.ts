import { and, desc, eq, isNull } from 'drizzle-orm';
import { reportShares } from '@packages/db';
import { generateSessionToken, hashSessionToken } from '@packages/auth';
import type { CreateReportShareRequest, CreateReportShareResponse, ReportRange, ReportShare } from '@packages/validation';
import { DomainError } from '../lib/domain-error.js';
import type { DbExecutor } from './db-types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const invalidLink = () => new DomainError('SHARE_LINK_INVALID', 404, 'This link has expired or was revoked.');

/**
 * Read-only dashboard share links. The raw token is returned once at creation; only its SHA-256
 * hash is stored (like session tokens), so a database leak cannot be replayed as a link.
 */
export class ReportShareService {
  constructor(
    private readonly db: DbExecutor,
    private readonly webUrl: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(input: CreateReportShareRequest, actorId: string): Promise<CreateReportShareResponse> {
    const token = generateSessionToken();
    const defaultRange: ReportRange = input.defaultRange ?? 'month';
    const expiresAt = new Date(this.now().getTime() + input.expiresInDays * DAY_MS);
    const [row] = await this.db
      .insert(reportShares)
      .values({ tokenHash: hashSessionToken(token), defaultRange, customFrom: input.from ?? null, customTo: input.to ?? null, expiresAt, createdBy: actorId })
      .returning({ id: reportShares.id });
    return {
      id: row.id,
      url: `${this.webUrl.replace(/\/+$/, '')}/share/${token}`,
      token,
      defaultRange,
      from: input.from ?? null,
      to: input.to ?? null,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Newest first. Never includes the token or its hash. */
  async list(): Promise<ReportShare[]> {
    const rows = await this.db.select().from(reportShares).orderBy(desc(reportShares.createdAt), desc(reportShares.id));
    return rows.map((row) => ({
      id: row.id,
      from: row.customFrom,
      to: row.customTo,
      defaultRange: row.defaultRange,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Sets `revokedAt` once; revoking an already revoked link keeps the original time. */
  async revoke(id: string): Promise<void> {
    const revoked = await this.db
      .update(reportShares)
      .set({ revokedAt: this.now() })
      .where(and(eq(reportShares.id, id), isNull(reportShares.revokedAt)))
      .returning({ id: reportShares.id });
    if (revoked.length) return;
    const [existing] = await this.db.select({ id: reportShares.id }).from(reportShares).where(eq(reportShares.id, id)).limit(1);
    if (!existing) throw new DomainError('NOT_FOUND', 404, 'Share link not found.');
  }

  /** Unknown, revoked and expired tokens are indistinguishable to the caller (404 SHARE_LINK_INVALID). */
  async resolve(token: string): Promise<{ defaultRange: ReportRange; from: string | null; to: string | null; expiresAt: string }> {
    const [row] = await this.db
      .select()
      .from(reportShares)
      .where(eq(reportShares.tokenHash, hashSessionToken(token)))
      .limit(1);
    if (!row || row.revokedAt || row.expiresAt.getTime() <= this.now().getTime()) throw invalidLink();
    return { defaultRange: row.defaultRange, from: row.customFrom, to: row.customTo, expiresAt: row.expiresAt.toISOString() };
  }
}

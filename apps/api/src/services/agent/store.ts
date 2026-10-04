import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import {
  agentActions,
  agentConversations,
  agentMessages,
  type AgentActionStatusValue,
  type DatabaseInstance,
} from '@packages/db';

export interface ToolCallSummary {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallSummary[];
  createdAt: Date;
}

export interface ActionRecord {
  id: string;
  conversationId: string;
  userId: string;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
  status: AgentActionStatusValue;
  resultSummary: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Persistence boundary for the agent. Every read that returns user data takes the owning
 * `userId`, so a conversation or action belonging to someone else is simply "not found".
 */
export interface AgentStore {
  createConversation(userId: string, title: string): Promise<ConversationRecord>;
  getConversation(userId: string, id: string): Promise<ConversationRecord | null>;
  listConversations(userId: string, limit: number): Promise<ConversationRecord[]>;
  deleteConversation(userId: string, id: string): Promise<boolean>;
  touchConversation(id: string): Promise<void>;
  addMessage(conversationId: string, role: 'user' | 'assistant', content: string, toolCalls: ToolCallSummary[]): Promise<MessageRecord>;
  /** Oldest-first; with `limit`, the most recent `limit` messages. */
  listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  createAction(input: {
    conversationId: string;
    userId: string;
    tool: string;
    summary: string;
    input: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<ActionRecord>;
  getAction(userId: string, id: string): Promise<ActionRecord | null>;
  listActions(conversationId: string, userId: string): Promise<ActionRecord[]>;
  /** Atomically PENDING -> `to`, only if still pending and (when `requireUnexpired`) not expired. Returns the row or null. */
  claimPending(userId: string, id: string, to: 'CONFIRMED' | 'REJECTED', now: Date, requireUnexpired: boolean): Promise<ActionRecord | null>;
  resolve(id: string, status: AgentActionStatusValue, resultSummary: string | null): Promise<ActionRecord | null>;
}

export class DrizzleAgentStore implements AgentStore {
  constructor(private readonly db: DatabaseInstance) {}

  async createConversation(userId: string, title: string) {
    const [row] = await this.db.insert(agentConversations).values({ userId, title }).returning();
    return row as ConversationRecord;
  }

  async getConversation(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(agentConversations)
      .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
      .limit(1);
    return (row as ConversationRecord | undefined) ?? null;
  }

  async listConversations(userId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.userId, userId))
      .orderBy(desc(agentConversations.updatedAt))
      .limit(limit);
    return rows as ConversationRecord[];
  }

  async deleteConversation(userId: string, id: string) {
    const rows = await this.db
      .delete(agentConversations)
      .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
      .returning({ id: agentConversations.id });
    return rows.length > 0;
  }

  async touchConversation(id: string) {
    await this.db.update(agentConversations).set({ updatedAt: new Date() }).where(eq(agentConversations.id, id));
  }

  async addMessage(conversationId: string, role: 'user' | 'assistant', content: string, toolCalls: ToolCallSummary[]) {
    const [row] = await this.db.insert(agentMessages).values({ conversationId, role, content, toolCalls }).returning();
    return row as MessageRecord;
  }

  async listMessages(conversationId: string, limit?: number) {
    if (limit === undefined) {
      const rows = await this.db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.conversationId, conversationId))
        .orderBy(asc(agentMessages.createdAt));
      return rows as MessageRecord[];
    }
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit);
    return (rows as MessageRecord[]).reverse();
  }

  async createAction(input: Parameters<AgentStore['createAction']>[0]) {
    const [row] = await this.db.insert(agentActions).values(input).returning();
    return row as ActionRecord;
  }

  async getAction(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.id, id), eq(agentActions.userId, userId)))
      .limit(1);
    return (row as ActionRecord | undefined) ?? null;
  }

  async listActions(conversationId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.conversationId, conversationId), eq(agentActions.userId, userId)))
      .orderBy(asc(agentActions.createdAt));
    return rows as ActionRecord[];
  }

  async claimPending(userId: string, id: string, to: 'CONFIRMED' | 'REJECTED', now: Date, requireUnexpired: boolean) {
    const conditions = [eq(agentActions.id, id), eq(agentActions.userId, userId), eq(agentActions.status, 'PENDING')];
    if (requireUnexpired) conditions.push(gt(agentActions.expiresAt, now));
    const [row] = await this.db
      .update(agentActions)
      .set({ status: to, resolvedAt: now })
      .where(and(...conditions))
      .returning();
    return (row as ActionRecord | undefined) ?? null;
  }

  async resolve(id: string, status: AgentActionStatusValue, resultSummary: string | null) {
    const [row] = await this.db
      .update(agentActions)
      .set({ status, resultSummary, resolvedAt: new Date() })
      .where(eq(agentActions.id, id))
      .returning();
    return (row as ActionRecord | undefined) ?? null;
  }
}

/** In-memory store with identical semantics; used by tests that run without Postgres. */
export class MemoryAgentStore implements AgentStore {
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages: MessageRecord[] = [];
  readonly actions = new Map<string, ActionRecord>();
  private tick = 0;
  private clock() {
    return new Date(Date.UTC(2026, 0, 1) + this.tick++);
  }

  async createConversation(userId: string, title: string) {
    const rec = { id: randomUUID(), userId, title, updatedAt: this.clock() };
    this.conversations.set(rec.id, rec);
    return rec;
  }
  async getConversation(userId: string, id: string) {
    const rec = this.conversations.get(id);
    return rec && rec.userId === userId ? rec : null;
  }
  async listConversations(userId: string, limit: number) {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
  async deleteConversation(userId: string, id: string) {
    const rec = this.conversations.get(id);
    if (!rec || rec.userId !== userId) return false;
    this.conversations.delete(id);
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i].conversationId === id) this.messages.splice(i, 1);
    for (const [aid, a] of this.actions) if (a.conversationId === id) this.actions.delete(aid);
    return true;
  }
  async touchConversation(id: string) {
    const rec = this.conversations.get(id);
    if (rec) rec.updatedAt = this.clock();
  }
  async addMessage(conversationId: string, role: 'user' | 'assistant', content: string, toolCalls: ToolCallSummary[]) {
    const rec: MessageRecord = { id: randomUUID(), conversationId, role, content, toolCalls, createdAt: this.clock() };
    this.messages.push(rec);
    return rec;
  }
  async listMessages(conversationId: string, limit?: number) {
    const all = this.messages.filter((m) => m.conversationId === conversationId);
    return limit === undefined ? all : all.slice(-limit);
  }
  async createAction(input: Parameters<AgentStore['createAction']>[0]) {
    const rec: ActionRecord = { id: randomUUID(), ...input, status: 'PENDING', resultSummary: null, createdAt: this.clock() };
    this.actions.set(rec.id, rec);
    return rec;
  }
  async getAction(userId: string, id: string) {
    const rec = this.actions.get(id);
    return rec && rec.userId === userId ? rec : null;
  }
  async listActions(conversationId: string, userId: string) {
    return [...this.actions.values()].filter((a) => a.conversationId === conversationId && a.userId === userId);
  }
  async claimPending(userId: string, id: string, to: 'CONFIRMED' | 'REJECTED', now: Date, requireUnexpired: boolean) {
    const rec = this.actions.get(id);
    if (!rec || rec.userId !== userId || rec.status !== 'PENDING') return null;
    if (requireUnexpired && rec.expiresAt.getTime() <= now.getTime()) return null;
    rec.status = to;
    return rec;
  }
  async resolve(id: string, status: AgentActionStatusValue, resultSummary: string | null) {
    const rec = this.actions.get(id);
    if (!rec) return null;
    rec.status = status;
    rec.resultSummary = resultSummary;
    return rec;
  }
}


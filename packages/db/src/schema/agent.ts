import { pgTable, varchar, text, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { pk, tstz, createdAt, updatedAt } from './_columns.js';
import { tenantId } from './_tenant.js';

export type AgentMessageRole = 'user' | 'assistant';
export type AgentActionStatusValue = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED' | 'FAILED';

/** One chat thread between a user and the Baseline agent. Strictly private to `userId`. */
export const agentConversations = pgTable(
  'agent_conversations',
  {
    tenantId: tenantId(),
    id: pk(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_agent_conversations_user').on(t.userId, t.updatedAt)]
);

export const agentMessages = pgTable(
  'agent_messages',
  {
    tenantId: tenantId(),
    id: pk(),
    conversationId: uuid('conversation_id')
      .references(() => agentConversations.id, { onDelete: 'cascade' })
      .notNull(),
    role: varchar('role', { length: 12 }).$type<AgentMessageRole>().notNull(),
    content: text('content').notNull(),
    /** [{ tool, summary, ok }] — summaries only, never raw tool payloads. */
    toolCalls: jsonb('tool_calls').$type<Array<{ tool: string; summary: string; ok: boolean }>>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('idx_agent_messages_conversation').on(t.conversationId, t.createdAt)]
);

/** A staged write awaiting the user's explicit confirmation. */
export const agentActions = pgTable(
  'agent_actions',
  {
    tenantId: tenantId(),
    id: pk(),
    conversationId: uuid('conversation_id')
      .references(() => agentConversations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tool: varchar('tool', { length: 64 }).notNull(),
    summary: text('summary').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 12 }).$type<AgentActionStatusValue>().notNull().default('PENDING'),
    resultSummary: text('result_summary'),
    expiresAt: tstz('expires_at').notNull(),
    resolvedAt: tstz('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_agent_actions_conversation').on(t.conversationId, t.status)]
);


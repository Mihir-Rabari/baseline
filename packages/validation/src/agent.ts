import { z } from 'zod';
import { UuidSchema, IsoDateTimeOutSchema } from './common.js';

/**
 * Baseline AI agent contract.
 *
 * The agent acts strictly *as the signed-in caller*: every tool it runs is executed through the
 * normal API route guards with the caller's own session, so it can never read or change anything
 * the caller could not. Read tools run immediately; write tools are staged as a pending action
 * the user must confirm.
 */

export const AGENT_MAX_MESSAGE_LENGTH = 4000;

export const AgentRoleSchema = z.enum(['user', 'assistant']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentToolCallSchema = z.object({
  /** Tool name, e.g. "bookings.list". */
  tool: z.string(),
  /** Short human-readable description of what the call did or will do. */
  summary: z.string(),
  ok: z.boolean(),
});
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AgentMessageSchema = z.object({
  id: UuidSchema,
  role: AgentRoleSchema,
  content: z.string(),
  /** Read tools the assistant used to produce this message (never contains raw payloads). */
  toolCalls: z.array(AgentToolCallSchema),
  createdAt: IsoDateTimeOutSchema,
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentActionStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED']);
export type AgentActionStatus = z.infer<typeof AgentActionStatusSchema>;

/** A write the agent wants to perform; nothing happens until the user confirms it. */
export const AgentPendingActionSchema = z.object({
  id: UuidSchema,
  tool: z.string(),
  /** Plain-language description of the change, e.g. "Cancel booking BK-1042 for Court 2". */
  summary: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: AgentActionStatusSchema,
  /** Outcome text once confirmed/failed; null while pending. */
  resultSummary: z.string().nullable(),
  expiresAt: IsoDateTimeOutSchema,
  createdAt: IsoDateTimeOutSchema,
});
export type AgentPendingAction = z.infer<typeof AgentPendingActionSchema>;

/** POST /agent/chat */
export const AgentChatBodySchema = z.object({
  conversationId: UuidSchema.optional(),
  message: z.string().trim().min(1).max(AGENT_MAX_MESSAGE_LENGTH),
});
export type AgentChatBody = z.infer<typeof AgentChatBodySchema>;

export const AgentChatResponseSchema = z.object({
  conversationId: UuidSchema,
  /** The assistant's reply for this turn. */
  reply: AgentMessageSchema,
  /** Writes awaiting the user's confirmation (empty when the agent only read data). */
  pendingActions: z.array(AgentPendingActionSchema),
});
export type AgentChatResponse = z.infer<typeof AgentChatResponseSchema>;

/** POST /agent/actions/:id/confirm and /reject */
export const AgentActionParamsSchema = z.object({ id: UuidSchema });
export const AgentActionResultSchema = z.object({
  action: AgentPendingActionSchema,
  /** Follow-up assistant message describing the outcome, appended to the conversation. */
  reply: AgentMessageSchema,
});
export type AgentActionResult = z.infer<typeof AgentActionResultSchema>;

/** GET /agent/conversations */
export const AgentConversationSummarySchema = z.object({
  id: UuidSchema,
  title: z.string(),
  updatedAt: IsoDateTimeOutSchema,
});
export const AgentConversationListSchema = z.object({
  data: z.array(AgentConversationSummarySchema),
});

/** GET /agent/conversations/:id */
export const AgentConversationParamsSchema = z.object({ id: UuidSchema });
export const AgentConversationSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  messages: z.array(AgentMessageSchema),
  pendingActions: z.array(AgentPendingActionSchema),
  updatedAt: IsoDateTimeOutSchema,
});
export type AgentConversation = z.infer<typeof AgentConversationSchema>;

/** GET /agent/status — lets the UI hide the launcher when the agent is unavailable. */
export const AgentStatusSchema = z.object({
  enabled: z.boolean(),
  /** Tool names the caller may use (already filtered by the caller's permissions). */
  tools: z.array(z.object({ name: z.string(), description: z.string(), write: z.boolean() })),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;


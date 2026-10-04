import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can } from '../../lib/authz.js';

/**
 * Declarative tool registry for the Baseline agent.
 *
 * A tool is nothing but a description of an *existing* API route. Executing a tool calls that
 * route through `fastify.inject()` carrying the caller's own session cookie, so every route
 * guard, validator and tenant scope applies exactly as if the user had made the request. The
 * agent therefore can never exceed the caller's permissions; `requiredPermission` is only used
 * to hide tools the caller could not use anyway and to fail fast.
 */

export const AGENT_PERMISSION_USE = 'agent:use';
export const AGENT_PERMISSION_ACT = 'agent:act';

/** Largest tool result (in characters) handed back to the model. */
export const MAX_TOOL_RESULT_CHARS = 8 * 1024;

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface AgentTool {
  /** Stable identifier, e.g. "bookings.mine". */
  name: string;
  description: string;
  /** JSON Schema shown to the model. */
  inputSchema: Record<string, unknown>;
  /** Authoritative runtime validation of whatever the model sends. */
  validator: z.ZodType<Record<string, unknown>>;
  /** Writes are never executed by the model: they are staged and need user confirmation. */
  write: boolean;
  /** Caller needs ANY of these. Permissions ending in ":self" are evaluated with the caller as owner. */
  requiredPermission: string[];
  method: ToolMethod;
  /** Path under /api/v1 with {param} placeholders filled from the input; the rest becomes query (GET) or JSON body. */
  path: string;
  /** One-line, human-readable description of this call. */
  summarize(input: Record<string, unknown>): string;
}

const uuid = z.string().uuid();
const limit = z.number().int().min(1).max(20).optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}
const LIMIT_PROP = { type: 'integer', minimum: 1, maximum: 20, description: 'Max rows to return (default 20)' };
const ID_PROP = { type: 'string', format: 'uuid' };
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;

export const AGENT_TOOLS: readonly AgentTool[] = [
  // ----- reads ---------------------------------------------------------------------------
  {
    name: 'profile.get',
    description: "Get the signed-in user's own profile (name, email, status).",
    inputSchema: schema({}),
    validator: strict({}),
    write: false,
    requiredPermission: ['profile:read:self'],
    method: 'GET',
    path: '/profile',
    summarize: () => 'Read your profile',
  },
  {
    name: 'notifications.list',
    description: "List the signed-in user's notifications, newest first.",
    inputSchema: schema({ unread: { type: 'string', enum: ['true', 'false'] }, limit: LIMIT_PROP }),
    validator: strict({ unread: z.enum(['true', 'false']).optional(), limit }),
    write: false,
    requiredPermission: ['notifications:read:self'],
    method: 'GET',
    path: '/notifications',
    summarize: (i) => (i.unread === 'true' ? 'List unread notifications' : 'List notifications'),
  },
  {
    name: 'notifications.unread_count',
    description: 'Count the signed-in user\'s unread notifications.',
    inputSchema: schema({}),
    validator: strict({}),
    write: false,
    requiredPermission: ['notifications:read:self'],
    method: 'GET',
    path: '/notifications/unread-count',
    summarize: () => 'Count unread notifications',
  },
  {
    name: 'bookings.mine',
    description: "List the signed-in member's own court bookings (upcoming by default).",
    inputSchema: schema({ scope: { type: 'string', enum: ['upcoming', 'past'] }, limit: LIMIT_PROP }),
    validator: strict({ scope: z.enum(['upcoming', 'past']).optional(), limit }),
    write: false,
    requiredPermission: ['bookings:read:self'],
    method: 'GET',
    path: '/me/bookings',
    summarize: (i) => `List your ${i.scope === 'past' ? 'past' : 'upcoming'} bookings`,
  },
  {
    name: 'bookings.list',
    description: 'Staff: list club bookings, optionally filtered by date (YYYY-MM-DD), status or court.',
    inputSchema: schema({
      date: { type: 'string', description: 'YYYY-MM-DD' },
      status: { type: 'string' },
      courtId: ID_PROP,
      limit: LIMIT_PROP,
    }),
    validator: strict({ date: dateOnly.optional(), status: z.string().max(32).optional(), courtId: uuid.optional(), limit }),
    write: false,
    requiredPermission: ['bookings:read'],
    method: 'GET',
    path: '/bookings',
    summarize: (i) => `List club bookings${i.date ? ` on ${String(i.date)}` : ''}`,
  },
  {
    name: 'courts.list',
    description: 'List the club courts with sport and list price.',
    inputSchema: schema({}),
    validator: strict({}),
    write: false,
    requiredPermission: ['profile:read:self'],
    method: 'GET',
    path: '/courts',
    summarize: () => 'List courts',
  },
  {
    name: 'courts.availability',
    description: 'Court availability grid for one club date (YYYY-MM-DD).',
    inputSchema: schema({ date: { type: 'string', description: 'YYYY-MM-DD' }, courtTypeId: ID_PROP }, ['date']),
    validator: strict({ date: dateOnly, courtTypeId: uuid.optional() }),
    write: false,
    requiredPermission: ['bookings:read:self', 'bookings:read'],
    method: 'GET',
    path: '/courts/availability',
    summarize: (i) => `Check court availability on ${String(i.date)}`,
  },
  {
    name: 'members.search',
    description: 'Staff: type-ahead search of members by name, phone or member code (min 2 characters).',
    inputSchema: schema({ q: { type: 'string', minLength: 2 }, limit: LIMIT_PROP }, ['q']),
    validator: strict({ q: z.string().trim().min(2).max(100), limit }),
    write: false,
    requiredPermission: ['members:read'],
    method: 'GET',
    path: '/members/lookup',
    summarize: (i) => `Search members for "${String(i.q).slice(0, 40)}"`,
  },
  {
    name: 'orders.mine',
    description: "List the signed-in user's own shop orders.",
    inputSchema: schema({ limit: LIMIT_PROP }),
    validator: strict({ limit }),
    write: false,
    requiredPermission: ['orders:read:self'],
    method: 'GET',
    path: '/me/orders',
    summarize: () => 'List your orders',
  },
  {
    name: 'orders.list',
    description: 'Staff: list shop orders.',
    inputSchema: schema({ limit: LIMIT_PROP }),
    validator: strict({ limit }),
    write: false,
    requiredPermission: ['orders:read'],
    method: 'GET',
    path: '/orders',
    summarize: () => 'List shop orders',
  },
  {
    name: 'crm.leads',
    description: 'Staff: list CRM leads, optionally by status or free-text query.',
    inputSchema: schema({
      status: { type: 'string', enum: ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'] },
      q: { type: 'string' },
      limit: LIMIT_PROP,
    }),
    validator: strict({
      status: z.enum(['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST']).optional(),
      q: z.string().trim().max(100).optional(),
      limit,
    }),
    write: false,
    requiredPermission: ['crm:read'],
    method: 'GET',
    path: '/crm/leads',
    summarize: (i) => `List CRM leads${i.status ? ` (${String(i.status)})` : ''}`,
  },
  {
    name: 'crm.summary',
    description: 'Staff: CRM pipeline summary (counts by status, follow-ups due, conversion rate).',
    inputSchema: schema({}),
    validator: strict({}),
    write: false,
    requiredPermission: ['crm:read'],
    method: 'GET',
    path: '/crm/summary',
    summarize: () => 'Read the CRM summary',
  },
  {
    name: 'reports.overview',
    description: 'Owner: live club snapshot (upcoming bookings, staff on shift, open orders, latest payments).',
    inputSchema: schema({}),
    validator: strict({}),
    write: false,
    requiredPermission: ['reports:read'],
    method: 'GET',
    path: '/reports/overview',
    summarize: () => 'Read the owner overview report',
  },

  // ----- writes (staged; need explicit user confirmation) ---------------------------------
  {
    name: 'notifications.mark_all_read',
    description: 'Mark ALL of the signed-in user\'s notifications as read. Requires user confirmation.',
    inputSchema: schema({}),
    validator: strict({}),
    write: true,
    requiredPermission: ['notifications:update:self'],
    method: 'POST',
    path: '/notifications/read-all',
    summarize: () => 'Mark all your notifications as read',
  },
  {
    name: 'notifications.mark_read',
    description: 'Mark one notification as read. Requires user confirmation.',
    inputSchema: schema({ id: ID_PROP }, ['id']),
    validator: strict({ id: uuid }),
    write: true,
    requiredPermission: ['notifications:update:self'],
    method: 'POST',
    path: '/notifications/{id}/read',
    summarize: () => 'Mark a notification as read',
  },
  {
    name: 'bookings.cancel',
    description:
      'Cancel a court booking (own booking, or any booking for staff). Cancellation cutoff and refund rules are applied by the system. Requires user confirmation.',
    inputSchema: schema({ id: ID_PROP, reason: { type: 'string', maxLength: 500 } }, ['id']),
    validator: strict({ id: uuid, reason: z.string().trim().max(500).optional() }),
    write: true,
    requiredPermission: ['bookings:cancel:self', 'bookings:cancel'],
    method: 'POST',
    path: '/bookings/{id}/cancel',
    summarize: (i) => `Cancel booking ${String(i.id)}${i.reason ? ` (reason: ${String(i.reason).slice(0, 80)})` : ''}`,
  },
  {
    name: 'profile.update_name',
    description: "Change the signed-in user's display name. Requires user confirmation.",
    inputSchema: schema({ name: { type: 'string', minLength: 1, maxLength: 120 } }, ['name']),
    validator: strict({ name: z.string().trim().min(1).max(120) }),
    write: true,
    requiredPermission: ['profile:update:self'],
    method: 'PUT',
    path: '/profile',
    summarize: (i) => `Change your display name to "${String(i.name).slice(0, 60)}"`,
  },
  {
    name: 'crm.lead_create',
    description: 'Staff: create a CRM lead (needs a phone or an email). Requires user confirmation.',
    inputSchema: schema(
      {
        name: { type: 'string', maxLength: 200 },
        phone: { type: 'string' },
        email: { type: 'string' },
        source: { type: 'string', enum: ['WALK_IN', 'PHONE', 'REFERRAL'] },
        message: { type: 'string', maxLength: 2000 },
      },
      ['name', 'source']
    ),
    validator: strict({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(32).optional(),
      email: z.string().trim().email().max(254).optional(),
      source: z.enum(['WALK_IN', 'PHONE', 'REFERRAL']),
      message: z.string().trim().max(2000).optional(),
    }),
    write: true,
    requiredPermission: ['crm:manage'],
    method: 'POST',
    path: '/crm/leads',
    summarize: (i) => `Create CRM lead "${String(i.name).slice(0, 60)}"`,
  },
  {
    name: 'crm.lead_note',
    description: 'Staff: add a note, call or email log to a CRM lead. Requires user confirmation.',
    inputSchema: schema(
      { id: ID_PROP, type: { type: 'string', enum: ['NOTE', 'CALL', 'EMAIL'] }, body: { type: 'string', maxLength: 4000 } },
      ['id', 'type', 'body']
    ),
    validator: strict({ id: uuid, type: z.enum(['NOTE', 'CALL', 'EMAIL']), body: z.string().trim().min(1).max(4000) }),
    write: true,
    requiredPermission: ['crm:manage'],
    method: 'POST',
    path: '/crm/leads/{id}/activities',
    summarize: (i) => `Add a ${String(i.type).toLowerCase()} to lead ${String(i.id)}: "${String(i.body).slice(0, 80)}"`,
  },
];

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Anthropic tool names allow only [a-zA-Z0-9_-]; registry names use dots. */
export const toWireName = (name: string) => name.replace(/\./g, '__');
export const fromWireName = (wire: string) => wire.replace(/__/g, '.');

/** Whether the caller holds at least one of the tool's permissions (and `agent:act` for writes). */
export async function canUseTool(request: FastifyRequest, tool: AgentTool): Promise<boolean> {
  const user = request.user;
  if (!user) return false;
  if (tool.write && !(await can(request, AGENT_PERMISSION_ACT))) return false;
  for (const permission of tool.requiredPermission) {
    if (await can(request, permission, permission.endsWith(':self') ? user.id : undefined)) return true;
  }
  return false;
}

export async function listAllowedTools(request: FastifyRequest): Promise<AgentTool[]> {
  const out: AgentTool[] = [];
  for (const tool of AGENT_TOOLS) if (await canUseTool(request, tool)) out.push(tool);
  return out;
}

export interface ToolExecution {
  ok: boolean;
  status: number;
  /** Shaped, size-capped text for the model / for the stored result summary. */
  text: string;
  truncated: boolean;
}

export interface ToolCaller {
  /** Exact `name=value` session cookie pair of the caller. */
  cookie: string;
  ip: string;
  requestId: string;
}

export function truncateForModel(text: string, max = MAX_TOOL_RESULT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n...[truncated: result exceeded ${max} characters]`, truncated: true };
}

/** Drops fields that must never reach the model even if a route returned them. */
function stripSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|hash|cookie|apikey/i.test(k)) continue;
      out[k] = stripSensitive(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Runs a (validated) tool call through the real API as the caller. The caller must already have
 * validated `input` with `tool.validator`.
 */
export async function executeTool(
  app: FastifyInstance,
  tool: AgentTool,
  input: Record<string, unknown>,
  caller: ToolCaller
): Promise<ToolExecution> {
  const rest: Record<string, unknown> = { ...input };
  const url = tool.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = rest[key];
    delete rest[key];
    return encodeURIComponent(String(value));
  });

  const query: Record<string, string> = {};
  let payload: Record<string, unknown> | undefined;
  if (tool.method === 'GET') {
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) query[k] = String(v);
  } else {
    payload = rest;
  }

  const response = await app.inject({
    method: tool.method,
    url: `/api/v1${url}`,
    query,
    remoteAddress: caller.ip,
    headers: { cookie: caller.cookie, 'x-request-id': caller.requestId, 'x-agent-tool': tool.name },
    ...(payload ? { payload } : {}),
  });

  let parsed: unknown;
  try {
    parsed = response.body ? JSON.parse(response.body) : null;
  } catch {
    parsed = null;
  }

  if (response.statusCode >= 200 && response.statusCode < 300) {
    const shaped = truncateForModel(JSON.stringify(stripSensitive(parsed)));
    return { ok: true, status: response.statusCode, text: shaped.text, truncated: shaped.truncated };
  }

  const err = (parsed ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code : 'ERROR';
  const message = response.statusCode >= 500 ? 'The system could not complete that request.' : typeof err.message === 'string' ? err.message : 'Request failed.';
  return {
    ok: false,
    status: response.statusCode,
    text: truncateForModel(`HTTP ${response.statusCode} ${code}: ${message}`, 500).text,
    truncated: false,
  };
}

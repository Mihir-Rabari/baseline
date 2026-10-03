---
name: authorization
description: Identity and Access Management, policy evaluation engine, declarative route guards, and permissions.
---

# Authorization & IAM Skill

## 1. When to Use
Use this skill when defining permissions, roles, groups, IAM policies, policy evaluation statements, route guards, or resource ownership checks.

## 2. Policy Evaluation Invariants
1. **Superuser ROOT Authority**: If `identity.identityType === 'ROOT'`, access is unconditionally granted across all actions.
2. **Explicit Deny Precedence**: If any statement (direct, role, or group) contains `effect: 'deny'` matching the requested action, access is immediately blocked.
3. **Allow Statements & Ownership**: If an allow statement matches:
   - For `:self` actions (e.g. `profile:update:self`), verify `context.resourceOwnerId === identity.id`.
4. **Implicit Deny**: If no matching statement is found, access is denied by default.

## 3. Policy Condition Operators
`PolicyStatement.conditions` supports exactly four operators, each mapping a context key to the value(s) it must satisfy. The canonical list lives in `SUPPORTED_CONDITION_OPERATORS` (`@packages/validation`, `packages/validation/src/iam.ts`); `packages/iam/src/policy/policy-engine.ts` imports it rather than redeclaring it, since `@packages/validation` has no dependency on `@packages/iam` and must not gain one.

| Operator | Example | Meaning |
|---|---|---|
| `StringEquals` | `{ "department": "finance" }` | `context.attributes.department === "finance"` |
| `StringNotEquals` | `{ "department": "contractors" }` | `context.attributes.department !== "contractors"` |
| `Bool` | `{ "mfaPresent": true }` | `Boolean(context.attributes.mfaPresent) === true` |
| `OwnerEquals` | `{ "resourceOwnerId": "@identity" }` | `context.resourceOwnerId === identity.id` |

- **Write-time rejection**: `PolicyStatementSchema.conditions` validates the outer keys (the operator names) against `SUPPORTED_CONDITION_OPERATORS` via `superRefine`. `POST /api/v1/iam/policies` and `PUT /api/v1/iam/policies/:id` return `400 VALIDATION_ERROR` naming the offending operator and listing the supported set — an admin can no longer save a policy with an operator the engine can't evaluate.
- **Fail-closed at evaluation time**: `evaluateConditions` still treats any operator outside this set as a denial (defense in depth, in case a statement reaches the engine by a path other than the write API — e.g. a stale row).

## 4. Operational Logging vs Audit Trail
- **Operational Logs**: Diagnostic logs for developer visibility (e.g. `iam.permission.evaluated`, `iam.user.status_updated`).
- **Audit Logs**: Durable database records for security compliance (`iam_audit_logs` table tracking administrative mutations).

## 5. Route Guards Convention
```typescript
import { requirePermission, requireAuthentication } from '@packages/iam';

// Require login
fastify.get('/profile', { preHandler: [requireAuthentication()] }, handler);

// Require specific permission
fastify.get('/users', { preHandler: [requirePermission('users:read')] }, handler);

// Require self-resource ownership
fastify.put('/users/:id', {
  preHandler: [
    requirePermission('users:update', (req) => ({ resourceOwnerId: req.params.id })),
  ],
}, handler);
```

## 6. Mandatory Testing Expectations
Every authorization change requires:
1. **Allow Cases**: Legitimate permissions allow operation.
2. **Deny Precedence**: Explicit `DENY` statement strictly overrides any matching `ALLOW`.
3. **Ownership Verification**: Resource-level ownership tests (`owner -> allowed`, `other user -> 403`, `unauthenticated -> 401`).
4. **Privilege Escalation Defense**: Negative tests proving normal external users cannot grant themselves permissions or access admin routes.

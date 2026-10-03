# Identity & Access Management (`packages/iam`) — Subtree Operating Manual

> **Scope**: Permission catalog, policy evaluation engine (`PolicyEngine`), `IamService` database operations, and Fastify authorization pre-handlers.

---

## 1. Subtree Architecture & Conventions

1. **Policy Evaluation Invariants**:
   - `ROOT` superusers have unconditional administrative authority.
   - Explicit `DENY` statements strictly override `ALLOW` statements.
   - Resource ownership (`:self`) strictly enforces `context.resourceOwnerId === identity.id`.
   - Unknown actions result in implicit deny.

2. **IamService Boundary**:
   - `IamService` provides high-level operations for Users, Roles, Groups, Policies, and Effective Permissions calculation.
   - Database operations use Drizzle ORM and log audit records to `iam_audit_logs`.

3. **Fastify Route Guards**:
   - `requireAuthentication()`: validates active session.
   - `requirePermission(action, resourceExtractor?)`: evaluates policy statements against the requested action and optional resource context.
   - `requireAnyPermission(actions[])`: requires at least one matching allow statement.

4. **Testing Expectations**:
   - Adversarial policy engine unit tests, guard tests, and negative privilege escalation tests.

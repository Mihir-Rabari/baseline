import type { IdentityType, UserStatus } from '@packages/auth';
import type { PolicyStatement } from '@packages/validation';
import { SUPPORTED_CONDITION_OPERATORS } from '@packages/validation';
import { permissionCatalog } from '../catalog/permission-catalog.js';

export interface AuthorizationContext {
  resourceOwnerId?: string;
  resourceId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Matches a resource ARN-ish identifier against a policy resource pattern.
 *
 * Supported patterns:
 *   "*"            -> matches every resource
 *   "docs:*"       -> matches any resource whose identifier starts with "docs:"
 *   "docs:abc-123" -> exact match
 *
 * A statement scoped to specific resources never matches a request that carries no
 * resource identifier. That is deliberate: a caller that forgets to supply the
 * resource context gets a denial, not a blanket grant.
 */
export function matchesResourcePattern(pattern: string, requestedResource?: string): boolean {
  if (pattern === '*') {
    return true;
  }

  if (!requestedResource) {
    return false;
  }

  if (pattern === requestedResource) {
    return true;
  }

  if (pattern.endsWith('*')) {
    return requestedResource.startsWith(pattern.slice(0, -1));
  }

  return false;
}

/**
 * Evaluates the optional `conditions` map on a policy statement.
 *
 * Supported operators, each mapping a context key to the value(s) it must satisfy:
 *   StringEquals    { "department": "finance" }        context.attributes.department === "finance"
 *   StringNotEquals { "department": "contractors" }    context.attributes.department !== "contractors"
 *   Bool            { "mfaPresent": true }             Boolean(context.attributes.mfaPresent) === true
 *   OwnerEquals     { "resourceOwnerId": "@identity" } context.resourceOwnerId === identity.id
 *
 * A statement carrying an operator this engine does not recognise evaluates to false.
 * Unknown means unsafe, so an unrecognised condition denies rather than being skipped.
 */
export function evaluateConditions(
  conditions: Record<string, unknown> | null | undefined,
  identity: IdentitySubject,
  context?: AuthorizationContext
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  const attributes = context?.attributes ?? {};

  for (const [operator, rawOperand] of Object.entries(conditions)) {
    if (rawOperand === null || typeof rawOperand !== 'object') {
      return false;
    }
    const operand = rawOperand as Record<string, unknown>;

    // Guard against drift between this switch and the canonical operator list: the
    // schema in `@packages/validation` is supposed to reject any operator not in
    // `SUPPORTED_CONDITION_OPERATORS` before a policy is ever stored, but the engine
    // still fails closed here in case a statement reaches it by some other path (a
    // stale row, a direct DB write, a future schema bug).
    if (!(SUPPORTED_CONDITION_OPERATORS as readonly string[]).includes(operator)) {
      return false;
    }

    switch (operator) {
      case 'StringEquals':
        for (const [key, expected] of Object.entries(operand)) {
          if (String(attributes[key]) !== String(expected)) return false;
        }
        break;

      case 'StringNotEquals':
        for (const [key, forbidden] of Object.entries(operand)) {
          if (String(attributes[key]) === String(forbidden)) return false;
        }
        break;

      case 'Bool':
        for (const [key, expected] of Object.entries(operand)) {
          if (Boolean(attributes[key]) !== Boolean(expected)) return false;
        }
        break;

      case 'OwnerEquals':
        for (const [key, expected] of Object.entries(operand)) {
          const actual = key === 'resourceOwnerId' ? context?.resourceOwnerId : attributes[key];
          const target = expected === '@identity' ? identity.id : expected;
          if (actual === undefined || actual !== target) return false;
        }
        break;

      default:
        // Unrecognised operator: fail closed.
        return false;
    }
  }

  return true;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

export interface IdentitySubject {
  id: string;
  email: string;
  name?: string;
  identityType: IdentityType;
  status: UserStatus;
}

/**
 * Matches an action against a permission pattern.
 * e.g. "users:read" matches "users:read", "users:*", or "*"
 */
export function matchesActionPattern(pattern: string, requestedAction: string): boolean {
  if (pattern === '*' || pattern === requestedAction) {
    return true;
  }

  // Handle wildcard like "users:*"
  if (pattern.endsWith(':*')) {
    const patternPrefix = pattern.slice(0, -2);
    const [reqNamespace] = requestedAction.split(':');
    return patternPrefix === reqNamespace;
  }

  return false;
}

/**
 * Returns the subset of `grantedActions` that `identity` cannot itself perform.
 *
 * This is the decision behind the privilege-escalation guard, kept pure and separate
 * from the database lookups that feed it so it can be tested directly.
 *
 * A wildcard in a granted action expands to the whole permission catalog: handing out
 * `users:*` requires holding every `users:` permission, and handing out `*` requires
 * holding everything. Otherwise an actor with a single narrow permission could mint a
 * wildcard policy and attach it to themselves.
 */
export function findUnheldActions(
  identity: IdentitySubject,
  identityStatements: PolicyStatement[],
  grantedActions: string[],
  catalogActions: string[]
): string[] {
  return grantedActions.filter((action) => {
    const probes = action.includes('*')
      ? catalogActions.filter((candidate) => matchesActionPattern(action, candidate))
      : [action];

    // A wildcard that matches nothing in the catalog is still a wildcard; treat it as
    // unheld rather than vacuously satisfied.
    if (probes.length === 0) {
      return true;
    }

    return probes.some(
      (concrete) =>
        !PolicyEngine.evaluate({
          identity,
          action: concrete,
          statements: identityStatements,
        }).allowed
    );
  });
}

/**
 * Centralized authorization evaluation engine.
 */
export class PolicyEngine {
  /**
   * Evaluates if an identity is authorized to perform an action given their effective policy statements.
   */
  public static evaluate(params: {
    identity: IdentitySubject;
    action: string;
    statements: PolicyStatement[];
    context?: AuthorizationContext;
  }): AuthorizationDecision {
    const { identity, action, statements, context } = params;

    // 1. Inactive account check
    if (identity.status === 'SUSPENDED') {
      return { allowed: false, reason: 'Account is suspended' };
    }
    if (identity.status === 'DISABLED') {
      return { allowed: false, reason: 'Account is disabled' };
    }

    // 2. ROOT Identity Authority
    if (identity.identityType === 'ROOT') {
      return { allowed: true, reason: 'Root identity has full administrative authority' };
    }

    // 3. Explicit Deny Check (Deny Precedence)
    //
    // A deny is evaluated on action + resource only. Conditions are intentionally NOT
    // applied to deny statements: a condition that fails to evaluate must never turn a
    // denial into a grant.
    for (const statement of statements) {
      if (statement.effect === 'deny' && PolicyEngine.matchesTarget(statement, action, context)) {
        return { allowed: false, reason: 'Explicit deny statement matched' };
      }
    }

    // 4. Allow Statements Check
    for (const statement of statements) {
      if (statement.effect !== 'allow') {
        continue;
      }

      if (!PolicyEngine.matchesTarget(statement, action, context)) {
        continue;
      }

      // Ownership gate for self-scoped actions.
      //
      // Fails closed: a ":self" action with no owner in context cannot be authorised,
      // because there is nothing to prove the caller owns the target.
      if (action.endsWith(':self')) {
        if (context?.resourceOwnerId === undefined || context.resourceOwnerId !== identity.id) {
          continue;
        }
      }

      if (!evaluateConditions(statement.conditions, identity, context)) {
        continue;
      }

      return { allowed: true, reason: 'Allowed by policy statement' };
    }

    // 5. Default Deny
    return { allowed: false, reason: 'Implicit deny (no allow statement matched)' };
  }

  /**
   * True when a statement's `actions` and `resources` both cover the request.
   */
  private static matchesTarget(
    statement: PolicyStatement,
    action: string,
    context?: AuthorizationContext
  ): boolean {
    const actionMatches = statement.actions.some((pattern) =>
      matchesActionPattern(pattern, action)
    );
    if (!actionMatches) {
      return false;
    }

    // `resources` defaults to ['*'] at the schema level, but statements can reach the
    // engine from sources that skip Zod parsing, so treat a missing list as unscoped.
    const resources = statement.resources ?? ['*'];
    return resources.some((pattern) => matchesResourcePattern(pattern, context?.resourceId));
  }

  /**
   * Computes the list of effective allowed permission identifiers from an array of policy statements.
   *
   * This is a UI capability hint, not an authorization decision. It reports the actions the
   * identity can perform unconditionally — statements scoped to specific resources are
   * excluded, since whether they apply depends on the resource being acted on. Callers must
   * still run `evaluate` with real resource context at the point of access.
   */
  public static computeEffectivePermissions(
    identity: IdentitySubject,
    statements: PolicyStatement[]
  ): string[] {
    const allCatalogPermissions = permissionCatalog.getAllPermissions();

    if (identity.identityType === 'ROOT') {
      return allCatalogPermissions.map((p) => p.id);
    }

    const effective: string[] = [];

    for (const perm of allCatalogPermissions) {
      const decision = PolicyEngine.evaluate({
        identity,
        action: perm.id,
        statements,
        context: { resourceOwnerId: identity.id }, // Assume self-context for permission discovery
      });

      if (decision.allowed) {
        effective.push(perm.id);
      }
    }

    return effective;
  }
}

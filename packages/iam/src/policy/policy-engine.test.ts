import { describe, it, expect } from 'vitest';
import { PolicyEngine, matchesActionPattern, type IdentitySubject } from './policy-engine.js';
import type { PolicyStatement } from '@packages/validation';

describe('Policy Engine & Pattern Matching', () => {
  describe('matchesActionPattern', () => {
    it('should match exact actions', () => {
      expect(matchesActionPattern('users:read', 'users:read')).toBe(true);
      expect(matchesActionPattern('users:read', 'users:write')).toBe(false);
    });

    it('should match wildcard star (*)', () => {
      expect(matchesActionPattern('*', 'users:read')).toBe(true);
      expect(matchesActionPattern('*', 'anything:custom')).toBe(true);
    });

    it('should match namespace wildcards (namespace:*)', () => {
      expect(matchesActionPattern('users:*', 'users:read')).toBe(true);
      expect(matchesActionPattern('users:*', 'users:delete')).toBe(true);
      expect(matchesActionPattern('users:*', 'roles:read')).toBe(false);
    });
  });

  describe('PolicyEngine.evaluate', () => {
    const rootUser: IdentitySubject = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'root@example.com',
      identityType: 'ROOT',
      status: 'ACTIVE',
    };

    const externalUser: IdentitySubject = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      identityType: 'EXTERNAL_USER',
      status: 'ACTIVE',
    };

    const suspendedUser: IdentitySubject = {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'suspended@example.com',
      identityType: 'EXTERNAL_USER',
      status: 'SUSPENDED',
    };

    it('should grant all actions to ROOT identity unconditionally', () => {
      const decision = PolicyEngine.evaluate({
        identity: rootUser,
        action: 'any:restricted:action',
        statements: [], // No statements needed for ROOT
      });

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('Root identity');
    });

    it('should reject suspended and disabled accounts immediately', () => {
      const decision = PolicyEngine.evaluate({
        identity: suspendedUser,
        action: 'profile:read:self',
        statements: [{ effect: 'allow', actions: ['*'], resources: ['*'] }],
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('suspended');
    });

    it('should enforce EXPLICIT DENY PRECEDENCE over Allow statements', () => {
      const statements: PolicyStatement[] = [
        {
          effect: 'allow',
          actions: ['users:*'],
          resources: ['*'],
        },
        {
          effect: 'deny',
          actions: ['users:delete'],
          resources: ['*'],
        },
      ];

      // Read is allowed because users:* matches and no deny matches
      const readDecision = PolicyEngine.evaluate({
        identity: externalUser,
        action: 'users:read',
        statements,
      });
      expect(readDecision.allowed).toBe(true);

      // Delete is DENIED because explicit deny overrides allow
      const deleteDecision = PolicyEngine.evaluate({
        identity: externalUser,
        action: 'users:delete',
        statements,
      });
      expect(deleteDecision.allowed).toBe(false);
      expect(deleteDecision.reason).toContain('Explicit deny');
    });

    it('should verify resource ownership for :self actions', () => {
      const statements: PolicyStatement[] = [
        {
          effect: 'allow',
          actions: ['profile:update:self'],
          resources: ['*'],
        },
      ];

      // Accessing own resource -> ALLOWED
      const selfDecision = PolicyEngine.evaluate({
        identity: externalUser,
        action: 'profile:update:self',
        statements,
        context: { resourceOwnerId: externalUser.id },
      });
      expect(selfDecision.allowed).toBe(true);

      // Attempting to modify another user's resource -> DENIED
      const otherDecision = PolicyEngine.evaluate({
        identity: externalUser,
        action: 'profile:update:self',
        statements,
        context: { resourceOwnerId: '99999999-9999-9999-9999-999999999999' },
      });
      expect(otherDecision.allowed).toBe(false);
    });

    it('should return implicit deny when no statements match', () => {
      const statements: PolicyStatement[] = [
        {
          effect: 'allow',
          actions: ['notifications:*'],
          resources: ['*'],
        },
      ];

      const decision = PolicyEngine.evaluate({
        identity: externalUser,
        action: 'users:read',
        statements,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Implicit deny');
    });
  });

  describe('PolicyEngine.computeEffectivePermissions', () => {
    it('should compute allowed permissions list from statements', () => {
      const identity: IdentitySubject = {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        identityType: 'EXTERNAL_USER',
        status: 'ACTIVE',
      };

      const statements: PolicyStatement[] = [
        {
          effect: 'allow',
          actions: ['profile:read:self', 'profile:update:self'],
          resources: ['*'],
        },
      ];

      const effective = PolicyEngine.computeEffectivePermissions(identity, statements);
      expect(effective).toContain('profile:read:self');
      expect(effective).toContain('profile:update:self');
      expect(effective).not.toContain('users:delete');
    });
  });
});

// ---------------------------------------------------------------------------
// Resource scoping and conditions
//
// Both fields existed on PolicyStatement and were accepted by the API, but the engine
// ignored them entirely: a statement scoped to one resource granted the action on all
// of them. These cover the fix.
// ---------------------------------------------------------------------------
describe('PolicyEngine resource scoping', () => {
  const identity: IdentitySubject = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    identityType: 'EXTERNAL_USER',
    status: 'ACTIVE',
  };

  const scoped: PolicyStatement[] = [
    { effect: 'allow', actions: ['docs:read'], resources: ['docs:alpha'] },
  ];

  it('allows the action on the resource the statement names', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'docs:read',
      statements: scoped,
      context: { resourceId: 'docs:alpha' },
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies the same action on a different resource', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'docs:read',
      statements: scoped,
      context: { resourceId: 'docs:beta' },
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies when no resource context is supplied at all', () => {
    // Fail closed: a caller that forgets the resource must not receive a blanket grant.
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'docs:read',
      statements: scoped,
    });
    expect(decision.allowed).toBe(false);
  });

  it('honours a resource prefix wildcard', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'docs:read',
      statements: [{ effect: 'allow', actions: ['docs:read'], resources: ['docs:*'] }],
      context: { resourceId: 'docs:anything' },
    });
    expect(decision.allowed).toBe(true);
  });

  it('keeps deny precedence within the matching resource scope', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'docs:read',
      statements: [
        { effect: 'allow', actions: ['*'], resources: ['*'] },
        { effect: 'deny', actions: ['docs:read'], resources: ['docs:secret'] },
      ],
      context: { resourceId: 'docs:secret' },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/deny/i);
  });
});

describe('PolicyEngine conditions', () => {
  const identity: IdentitySubject = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'user@example.com',
    identityType: 'EXTERNAL_USER',
    status: 'ACTIVE',
  };

  it('allows when a StringEquals condition is satisfied', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'reports:read',
      statements: [
        {
          effect: 'allow',
          actions: ['reports:read'],
          resources: ['*'],
          conditions: { StringEquals: { department: 'finance' } },
        },
      ],
      context: { attributes: { department: 'finance' } },
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies when a StringEquals condition is not satisfied', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'reports:read',
      statements: [
        {
          effect: 'allow',
          actions: ['reports:read'],
          resources: ['*'],
          conditions: { StringEquals: { department: 'finance' } },
        },
      ],
      context: { attributes: { department: 'sales' } },
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies on an unrecognised condition operator', () => {
    // Unknown means unsafe: an operator the engine cannot evaluate must not be skipped.
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'reports:read',
      statements: [
        {
          effect: 'allow',
          actions: ['reports:read'],
          resources: ['*'],
          conditions: { IpAddressInRange: { sourceIp: '10.0.0.0/8' } },
        },
      ],
      context: { attributes: {} },
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('PolicyEngine self-ownership', () => {
  const identity: IdentitySubject = {
    id: 'owner-id',
    email: 'user@example.com',
    identityType: 'EXTERNAL_USER',
    status: 'ACTIVE',
  };

  const selfPolicy: PolicyStatement[] = [
    { effect: 'allow', actions: ['profile:update:self'], resources: ['*'] },
  ];

  it('allows a :self action on the caller’s own record', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'profile:update:self',
      statements: selfPolicy,
      context: { resourceOwnerId: 'owner-id' },
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies a :self action on somebody else’s record', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'profile:update:self',
      statements: selfPolicy,
      context: { resourceOwnerId: 'another-user' },
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies a :self action when ownership context is missing', () => {
    // Previously this passed: the ownership check only ran when resourceOwnerId was
    // present, so omitting it skipped the gate entirely.
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'profile:update:self',
      statements: selfPolicy,
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('PolicyEngine coverage of remaining branches', () => {
  const identity: IdentitySubject = {
    id: 'user-id',
    email: 'user@example.com',
    identityType: 'EXTERNAL_USER',
    status: 'ACTIVE',
  };

  it('skips deny statements when scanning for an allow', () => {
    // A deny that does not match the requested action must not short-circuit the allow
    // scan, and must not itself be mistaken for a grant.
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'users:read',
      statements: [
        { effect: 'deny', actions: ['billing:write'], resources: ['*'] },
        { effect: 'allow', actions: ['users:read'], resources: ['*'] },
      ],
    });
    expect(decision.allowed).toBe(true);
  });

  it('falls through to implicit deny when only non-matching allows exist', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'users:delete',
      statements: [{ effect: 'allow', actions: ['users:read'], resources: ['*'] }],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/implicit deny/i);
  });

  it('treats a statement with no resources array as unscoped', () => {
    // Statements can reach the engine from sources that bypass Zod parsing, where the
    // schema default of ['*'] has not been applied.
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'users:read',
      statements: [
        { effect: 'allow', actions: ['users:read'] } as unknown as PolicyStatement,
      ],
    });
    expect(decision.allowed).toBe(true);
  });

  it('grants a ROOT identity the entire catalog', () => {
    const root: IdentitySubject = { ...identity, identityType: 'ROOT' };
    const effective = PolicyEngine.computeEffectivePermissions(root, []);

    expect(effective).toContain('users:delete');
    expect(effective).toContain('admin:access');
    expect(effective.length).toBeGreaterThan(0);
  });

  it('denies suspended and disabled identities regardless of policy', () => {
    const wideOpen: PolicyStatement[] = [
      { effect: 'allow', actions: ['*'], resources: ['*'] },
    ];

    expect(
      PolicyEngine.evaluate({
        identity: { ...identity, status: 'SUSPENDED' },
        action: 'users:read',
        statements: wideOpen,
      }).allowed
    ).toBe(false);

    expect(
      PolicyEngine.evaluate({
        identity: { ...identity, status: 'DISABLED' },
        action: 'users:read',
        statements: wideOpen,
      }).allowed
    ).toBe(false);
  });

  it('evaluates an empty conditions object as satisfied', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'users:read',
      statements: [
        { effect: 'allow', actions: ['users:read'], resources: ['*'], conditions: {} },
      ],
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies when a condition operand is not an object', () => {
    const decision = PolicyEngine.evaluate({
      identity,
      action: 'users:read',
      statements: [
        {
          effect: 'allow',
          actions: ['users:read'],
          resources: ['*'],
          conditions: { StringEquals: 'not-an-object' },
        } as unknown as PolicyStatement,
      ],
    });
    expect(decision.allowed).toBe(false);
  });

  it('supports Bool and StringNotEquals and OwnerEquals operators', () => {
    const evaluateWith = (conditions: Record<string, unknown>, attributes: Record<string, unknown>) =>
      PolicyEngine.evaluate({
        identity,
        action: 'users:read',
        statements: [{ effect: 'allow', actions: ['users:read'], resources: ['*'], conditions }],
        context: { attributes, resourceOwnerId: 'user-id' },
      }).allowed;

    expect(evaluateWith({ Bool: { mfaPresent: true } }, { mfaPresent: true })).toBe(true);
    expect(evaluateWith({ Bool: { mfaPresent: true } }, { mfaPresent: false })).toBe(false);

    expect(evaluateWith({ StringNotEquals: { tier: 'trial' } }, { tier: 'paid' })).toBe(true);
    expect(evaluateWith({ StringNotEquals: { tier: 'trial' } }, { tier: 'trial' })).toBe(false);

    expect(evaluateWith({ OwnerEquals: { resourceOwnerId: '@identity' } }, {})).toBe(true);
  });
});

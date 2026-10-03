import { describe, it, expect } from 'vitest';
import { findUnheldActions, type IdentitySubject } from '../policy/policy-engine.js';
import {
  SystemRecordProtectedError,
  PrivilegeEscalationError,
  RootProtectedError,
  IamError,
} from '../errors.js';
import type { PolicyStatement } from '@packages/validation';

const CATALOG = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'policies:read',
  'policies:update',
  'admin:access',
];

const actor: IdentitySubject = {
  id: 'actor-id',
  email: 'admin@example.com',
  identityType: 'EXTERNAL_USER',
  status: 'ACTIVE',
};

describe('findUnheldActions', () => {
  it('permits granting a permission the actor already holds', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['users:read', 'policies:update'], resources: ['*'] },
    ];

    expect(findUnheldActions(actor, held, ['users:read'], CATALOG)).toEqual([]);
  });

  it('blocks granting a permission the actor lacks', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['policies:update'], resources: ['*'] },
    ];

    expect(findUnheldActions(actor, held, ['users:delete'], CATALOG)).toEqual(['users:delete']);
  });

  it('blocks a wildcard grant from an actor holding only one permission', () => {
    // The escalation this guard exists for: `policies:update` alone must not be enough
    // to mint an `allow *` policy and attach it to yourself.
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['policies:update'], resources: ['*'] },
    ];

    expect(findUnheldActions(actor, held, ['*'], CATALOG)).toEqual(['*']);
  });

  it('permits a wildcard grant from an actor who already holds the wildcard', () => {
    const held: PolicyStatement[] = [{ effect: 'allow', actions: ['*'], resources: ['*'] }];

    expect(findUnheldActions(actor, held, ['*'], CATALOG)).toEqual([]);
  });

  it('blocks a namespace wildcard the actor only partially holds', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['users:read'], resources: ['*'] },
    ];

    expect(findUnheldActions(actor, held, ['users:*'], CATALOG)).toEqual(['users:*']);
  });

  it('permits a namespace wildcard the actor fully holds', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['users:*'], resources: ['*'] },
    ];

    expect(findUnheldActions(actor, held, ['users:*'], CATALOG)).toEqual([]);
  });

  it('reports every unheld action, not just the first', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['users:read'], resources: ['*'] },
    ];

    expect(
      findUnheldActions(actor, held, ['users:delete', 'admin:access'], CATALOG)
    ).toEqual(['users:delete', 'admin:access']);
  });

  it('treats a wildcard matching nothing in the catalog as unheld', () => {
    const held: PolicyStatement[] = [{ effect: 'allow', actions: ['*'], resources: ['*'] }];

    expect(findUnheldActions(actor, held, ['billing:*'], [])).toEqual(['billing:*']);
  });

  it('ignores the actor’s own deny statements only where they apply', () => {
    const held: PolicyStatement[] = [
      { effect: 'allow', actions: ['*'], resources: ['*'] },
      { effect: 'deny', actions: ['users:delete'], resources: ['*'] },
    ];

    // The actor cannot perform users:delete, so they cannot confer it either.
    expect(findUnheldActions(actor, held, ['users:delete'], CATALOG)).toEqual(['users:delete']);
    expect(findUnheldActions(actor, held, ['users:read'], CATALOG)).toEqual([]);
  });
});

describe('IAM guard-rail errors', () => {
  it('SystemRecordProtectedError is a 409 with a machine-readable code', () => {
    const err = new SystemRecordProtectedError('policy', 'ExternalUserPolicy');

    expect(err).toBeInstanceOf(IamError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('SYSTEM_RECORD_PROTECTED');
    expect(err.message).toContain('ExternalUserPolicy');
  });

  it('PrivilegeEscalationError is a 403 naming the refused actions', () => {
    const err = new PrivilegeEscalationError(['users:delete', 'admin:access']);

    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('PRIVILEGE_ESCALATION_BLOCKED');
    expect(err.message).toContain('users:delete');
    expect(err.message).toContain('admin:access');
  });

  it('RootProtectedError is a 403', () => {
    const err = new RootProtectedError();

    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('ROOT_PROTECTED');
  });
});

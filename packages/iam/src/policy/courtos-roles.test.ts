import { describe, it, expect } from 'vitest';
import { IamConfig } from '@packages/config';
import { BASELINE_PERMISSIONS } from '@packages/db';
import type { PolicyStatement } from '@packages/validation';
import { PolicyEngine, type IdentitySubject } from './policy-engine.js';
import { COURTOS_PERMISSION_NAMESPACES, permissionCatalog } from '../catalog/permission-catalog.js';

function statementsForRole(role: string): PolicyStatement[] {
  return IamConfig.roles[role].policies.flatMap((policyName) =>
    IamConfig.policies[policyName].statements.map((s) => ({
      effect: s.effect,
      actions: [...s.actions],
      resources: s.resources ? [...s.resources] : ['*'],
      conditions: s.conditions,
    })) as PolicyStatement[]
  );
}

function identity(id: string, status: IdentitySubject['status'] = 'ACTIVE'): IdentitySubject {
  return { id, email: `${id}@example.com`, identityType: 'EXTERNAL_USER', status };
}

const memberA = identity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const memberB = identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const barStaff = identity('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const frontDesk = identity('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const owner = identity('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

function can(
  who: IdentitySubject,
  role: string,
  action: string,
  resourceOwnerId?: string,
  extra: PolicyStatement[] = []
) {
  return PolicyEngine.evaluate({
    identity: who,
    action,
    statements: [...statementsForRole(role), ...extra],
    context: resourceOwnerId ? { resourceOwnerId } : undefined,
  }).allowed;
}

describe('CourtOS permission catalog', () => {
  it('registers every action granted by a role bundle', () => {
    for (const role of ['MEMBER', 'FRONT_DESK', 'BAR_STAFF', 'OWNER']) {
      for (const statement of statementsForRole(role)) {
        for (const action of statement.actions) {
          expect(permissionCatalog.isRegistered(action), `${role}: ${action}`).toBe(true);
        }
      }
    }
  });

  it('is mirrored exactly by BASELINE_PERMISSIONS in the db seed', () => {
    const catalogIds = COURTOS_PERMISSION_NAMESPACES.flatMap((ns) =>
      ns.permissions.map((p) => `${ns.namespace}:${typeof p === 'string' ? p : p.action}`)
    ).sort();
    const seedIds = BASELINE_PERMISSIONS.filter((p) => catalogIds.includes(p.id)).map((p) => p.id).sort();
    expect(seedIds).toEqual(catalogIds);

    const seedNamespaces = new Set(COURTOS_PERMISSION_NAMESPACES.map((n) => n.namespace));
    const extraInSeed = BASELINE_PERMISSIONS.filter(
      (p) => seedNamespaces.has(p.namespace) && !catalogIds.includes(p.id)
    );
    expect(extraInSeed).toEqual([]);
  });
});

describe('AI agent permissions', () => {
  it('registers agent:use and agent:act in the catalog and mirrors them in the db seed', () => {
    for (const id of ['agent:use', 'agent:act']) {
      expect(permissionCatalog.isRegistered(id), id).toBe(true);
      expect(BASELINE_PERMISSIONS.some((p) => p.id === id), `seed ${id}`).toBe(true);
    }
  });

  it('every baseline role bundle may use and act through the agent', () => {
    const who = { MEMBER: memberA, FRONT_DESK: frontDesk, BAR_STAFF: barStaff, OWNER: owner };
    for (const [role, subject] of Object.entries(who)) {
      expect(can(subject, role, 'agent:use'), `${role} use`).toBe(true);
      expect(can(subject, role, 'agent:act'), `${role} act`).toBe(true);
    }
    for (const policy of ['ExternalUserPolicy', 'AdministratorPolicy']) {
      const stmts = IamConfig.policies[policy].statements as PolicyStatement[];
      for (const action of ['agent:use', 'agent:act']) {
        const r = PolicyEngine.evaluate({ identity: memberA, action, statements: stmts });
        expect(r.allowed, `${policy} ${action}`).toBe(true);
      }
    }
  });

  it('denies an identity without agent:use (adversarial)', () => {
    const noAgent: PolicyStatement[] = [
      { effect: 'allow', actions: ['profile:read:self'], resources: ['*'] },
    ];
    for (const action of ['agent:use', 'agent:act']) {
      expect(PolicyEngine.evaluate({ identity: memberA, action, statements: noAgent }).allowed, action).toBe(false);
    }
    expect(PolicyEngine.evaluate({ identity: memberA, action: 'agent:use', statements: [] }).allowed).toBe(false);
  });

  it('an explicit deny on agent:act beats the role allow, and suspended accounts are denied', () => {
    const deny: PolicyStatement = { effect: 'deny', actions: ['agent:act'], resources: ['*'] };
    expect(can(memberA, 'MEMBER', 'agent:act', undefined, [deny])).toBe(false);
    expect(can(memberA, 'MEMBER', 'agent:use', undefined, [deny])).toBe(true);
    const blocked = identity('ffffffff-ffff-4fff-8fff-ffffffffffff', 'SUSPENDED');
    expect(can(blocked, 'MEMBER', 'agent:use')).toBe(false);
  });

  it('does not grant the agent any capability beyond the caller (no namespace wildcard)', () => {
    expect(can(memberA, 'MEMBER', 'bookings:override')).toBe(false);
    expect(can(memberA, 'MEMBER', 'admin:access')).toBe(false);
  });
});

describe('invoice and roster permissions (S-04, S-05)', () => {
  it('members read only their own invoices and never the staff list or the roster', () => {
    expect(can(memberA, 'MEMBER', 'invoices:read:self', memberA.id)).toBe(true);
    expect(can(memberA, 'MEMBER', 'invoices:read:self', memberB.id)).toBe(false);
    expect(can(memberA, 'MEMBER', 'invoices:read')).toBe(false);
    expect(can(memberA, 'MEMBER', 'shifts:read:all')).toBe(false);
  });

  it('front desk and owner see the whole roster; bar staff do not', () => {
    expect(can(frontDesk, 'FRONT_DESK', 'shifts:read:all')).toBe(true);
    expect(can(owner, 'OWNER', 'shifts:read:all')).toBe(true);
    expect(can(barStaff, 'BAR_STAFF', 'shifts:read:all')).toBe(false);
    expect(can(barStaff, 'BAR_STAFF', 'shifts:read')).toBe(true);
  });

  it('only the owner voids invoices, reads the ledger and schedules shifts', () => {
    for (const action of ['invoices:update', 'payments:read', 'shifts:manage']) {
      expect(can(owner, 'OWNER', action), `owner ${action}`).toBe(true);
      expect(can(frontDesk, 'FRONT_DESK', action), `desk ${action}`).toBe(false);
      expect(can(barStaff, 'BAR_STAFF', action), `bar ${action}`).toBe(false);
    }
  });
});

describe('MEMBER role', () => {
  it('is denied bookings:read (all bookings) and allowed bookings:read:self only for their own resources', () => {
    expect(can(memberA, 'MEMBER', 'bookings:read')).toBe(false);
    expect(can(memberA, 'MEMBER', 'bookings:read', memberA.id)).toBe(false);
    expect(can(memberA, 'MEMBER', 'bookings:read:self', memberA.id)).toBe(true);
  });

  it('cannot read or cancel another member\'s booking (mismatched resource ownership)', () => {
    expect(can(memberA, 'MEMBER', 'bookings:read:self', memberB.id)).toBe(false);
    expect(can(memberA, 'MEMBER', 'bookings:cancel:self', memberB.id)).toBe(false);
    expect(can(memberA, 'MEMBER', 'orders:read:self', memberB.id)).toBe(false);
  });

  it('fails closed on :self actions when no resource owner is supplied', () => {
    expect(can(memberA, 'MEMBER', 'bookings:create:self')).toBe(false);
  });

  it('cannot escalate to staff, finance, HR or admin capabilities', () => {
    for (const action of [
      'bookings:override',
      'bookings:cancel',
      'members:read',
      'reports:read',
      'payments:read',
      'hr:manage',
      'leave:decide',
      'shifts:manage',
      'users:read',
      'admin:access',
      'leave:create:self',
    ]) {
      expect(can(memberA, 'MEMBER', action, memberA.id), action).toBe(false);
    }
  });

  it('is denied everything when suspended or disabled', () => {
    for (const status of ['SUSPENDED', 'DISABLED'] as const) {
      const blocked = identity('ffffffff-ffff-4fff-8fff-ffffffffffff', status);
      expect(can(blocked, 'MEMBER', 'bookings:read:self', blocked.id)).toBe(false);
    }
  });
});

describe('BAR_STAFF role', () => {
  it('is denied reports:read and other management permissions', () => {
    for (const action of ['reports:read', 'reports:share', 'payments:read', 'hr:read', 'bookings:override', 'products:update']) {
      expect(can(barStaff, 'BAR_STAFF', action), action).toBe(false);
    }
  });

  it('can operate the bar and look members up', () => {
    for (const action of ['bar:read', 'bar:manage', 'bar:kitchen', 'bar:settle', 'members:read']) {
      expect(can(barStaff, 'BAR_STAFF', action), action).toBe(true);
    }
  });

  it('can clock in only for themselves', () => {
    expect(can(barStaff, 'BAR_STAFF', 'shifts:clock:self', barStaff.id)).toBe(true);
    expect(can(barStaff, 'BAR_STAFF', 'shifts:clock:self', memberA.id)).toBe(false);
  });
});

describe('FRONT_DESK role', () => {
  it('manages bookings and members but cannot override, view reports or decide leave', () => {
    for (const action of ['bookings:read', 'bookings:create', 'bookings:cancel', 'members:create', 'payments:create']) {
      expect(can(frontDesk, 'FRONT_DESK', action), action).toBe(true);
    }
    for (const action of ['bookings:override', 'reports:read', 'leave:decide', 'hr:manage', 'plans:update', 'bar:settle']) {
      expect(can(frontDesk, 'FRONT_DESK', action), action).toBe(false);
    }
  });
});

describe('OWNER role', () => {
  it('holds the union of front desk and bar staff capabilities plus management permissions', () => {
    for (const role of ['FRONT_DESK', 'BAR_STAFF']) {
      for (const statement of statementsForRole(role)) {
        for (const action of statement.actions) {
          const resourceOwner = action.endsWith(':self') ? owner.id : undefined;
          expect(can(owner, 'OWNER', action, resourceOwner), action).toBe(true);
        }
      }
    }
    for (const action of ['plans:update', 'bookings:override', 'reports:read', 'reports:share', 'hr:manage', 'leave:decide', 'admin:access', 'users:read']) {
      expect(can(owner, 'OWNER', action), action).toBe(true);
    }
  });

  it('does not gain admin governance rights (roles, policies) or others\' self data', () => {
    expect(can(owner, 'OWNER', 'roles:update')).toBe(false);
    expect(can(owner, 'OWNER', 'policies:create')).toBe(false);
    expect(can(owner, 'OWNER', 'bookings:read:self', memberA.id)).toBe(false);
  });
});

describe('explicit deny precedence on CourtOS roles', () => {
  const denyOverride: PolicyStatement = { effect: 'deny', actions: ['bookings:override'], resources: ['*'] };
  const denyAllReports: PolicyStatement = { effect: 'deny', actions: ['reports:read'], resources: ['*'] };

  it('a deny statement beats the OWNER allow', () => {
    expect(can(owner, 'OWNER', 'bookings:override')).toBe(true);
    expect(can(owner, 'OWNER', 'bookings:override', undefined, [denyOverride])).toBe(false);
    expect(can(owner, 'OWNER', 'reports:read', undefined, [denyAllReports])).toBe(false);
  });

  it('a deny on bookings:read:self beats the MEMBER allow even for own resources', () => {
    const deny: PolicyStatement = { effect: 'deny', actions: ['bookings:read:self'], resources: ['*'] };
    expect(can(memberA, 'MEMBER', 'bookings:read:self', memberA.id, [deny])).toBe(false);
  });
});

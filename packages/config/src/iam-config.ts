/**
 * Declarative IAM & Authorization Configuration
 *
 * Developers can define custom domain roles, groups, baseline policies,
 * and registration policies here without modifying the core authorization engine.
 */

export interface RoleDefinition {
  description: string;
  isSystem?: boolean;
  policies: string[];
}

export interface GroupDefinition {
  description: string;
  isSystem?: boolean;
  policies: string[];
}

export interface PolicyStatementDefinition {
  effect: 'allow' | 'deny';
  actions: string[];
  resources?: string[];
  conditions?: Record<string, unknown>;
}

export interface PolicyDefinition {
  description: string;
  isSystem?: boolean;
  statements: PolicyStatementDefinition[];
}

/**
 * CourtOS role bundles (docs/hackathon/API_CONTRACT.md section 0.4).
 *
 * Actions are listed explicitly (never `ns:*`) because the policy engine's namespace
 * wildcard also matches the non-self variants, e.g. `bookings:*` would grant
 * `bookings:override`.
 */
const SELF_PROFILE_AND_NOTIFICATIONS = [
  'profile:read:self',
  'profile:update:self',
  'notifications:read:self',
  'notifications:update:self',
];

const STAFF_SELF_SERVICE = [
  'shifts:read',
  'shifts:clock:self',
  'leave:read:self',
  'leave:create:self',
  ...SELF_PROFILE_AND_NOTIFICATIONS,
];

const MEMBER_ACTIONS = [
  ...SELF_PROFILE_AND_NOTIFICATIONS,
  'bookings:read:self',
  'bookings:create:self',
  'bookings:cancel:self',
  'invoices:read:self',
  'orders:read:self',
  'orders:create:self',
  'orders:cancel:self',
];

const FRONT_DESK_ACTIONS = [
  'members:read',
  'members:create',
  'members:update',
  'memberships:create',
  'memberships:update',
  'plans:read',
  'courts:read',
  'bookings:read',
  'bookings:create',
  'bookings:cancel',
  'products:read',
  'inventory:read',
  'inventory:adjust',
  'orders:read',
  'orders:create',
  'orders:update',
  'crm:read',
  'crm:manage',
  'invoices:read',
  'invoices:create',
  'payments:create',
  'shifts:read:all',
  ...STAFF_SELF_SERVICE,
];

const BAR_STAFF_ACTIONS = [
  'members:read',
  'bar:read',
  'bar:manage',
  'bar:kitchen',
  'bar:settle',
  ...STAFF_SELF_SERVICE,
];

const OWNER_ACTIONS = Array.from(
  new Set([
    ...FRONT_DESK_ACTIONS,
    ...BAR_STAFF_ACTIONS,
    'plans:update',
    'courts:update',
    'products:create',
    'products:update',
    'bookings:override',
    'invoices:update',
    'payments:read',
    'hr:read',
    'hr:manage',
    'leave:read',
    'leave:decide',
    'reports:read',
    'reports:share',
    'shifts:manage',
    'users:read',
    'admin:access',
  ])
);

export const IamConfig = {
  /**
   * Root superuser configuration
   */
  root: {
    enabled: true,
    authority: 'unconditional' as const,
  },

  /**
   * Baseline system policies created on database seed
   */
  policies: {
    AdministratorPolicy: {
      description: 'Full administrative access to manage users, roles, groups, policies, and permissions',
      isSystem: true,
      statements: [
        {
          effect: 'allow',
          actions: ['admin:access', 'users:*', 'roles:*', 'groups:*', 'policies:*', 'permissions:*'],
          resources: ['*'],
        },
      ],
    },
    ExternalUserPolicy: {
      description: 'Default baseline policy granting external users self-resource permissions',
      isSystem: true,
      statements: [
        {
          effect: 'allow',
          actions: [
            'profile:read:self',
            'profile:update:self',
            'notifications:read:self',
            'notifications:update:self',
          ],
          resources: ['*'],
        },
      ],
    },
    MemberPolicy: {
      description: 'CourtOS member: own profile, notifications, bookings and shop orders only',
      isSystem: true,
      statements: [{ effect: 'allow', actions: MEMBER_ACTIONS, resources: ['*'] }],
    },
    FrontDeskPolicy: {
      description: 'CourtOS front desk: members, bookings, shop, CRM, invoicing and own shifts/leave',
      isSystem: true,
      statements: [{ effect: 'allow', actions: FRONT_DESK_ACTIONS, resources: ['*'] }],
    },
    BarStaffPolicy: {
      description: 'CourtOS bar and kitchen staff: bar tabs, kitchen, member lookup and own shifts/leave',
      isSystem: true,
      statements: [{ effect: 'allow', actions: BAR_STAFF_ACTIONS, resources: ['*'] }],
    },
    OwnerPolicy: {
      description: 'CourtOS owner: all front desk and bar capabilities plus pricing, HR, finance and reports',
      isSystem: true,
      statements: [{ effect: 'allow', actions: OWNER_ACTIONS, resources: ['*'] }],
    },
  } as Record<string, PolicyDefinition>,

  /**
   * Baseline roles created on database seed with their attached policies
   */
  roles: {
    ADMIN: {
      description: 'System Administrator with full access to identity and system governance',
      isSystem: true,
      policies: ['AdministratorPolicy'],
    },
    USER: {
      description: 'Standard external user with baseline self-management capabilities',
      isSystem: true,
      policies: ['ExternalUserPolicy'],
    },
    MEMBER: {
      description: 'Club member who logs in; self-service access only',
      isSystem: true,
      policies: ['MemberPolicy'],
    },
    FRONT_DESK: {
      description: 'Front desk staff',
      isSystem: true,
      policies: ['FrontDeskPolicy'],
    },
    BAR_STAFF: {
      description: 'Bar and kitchen staff',
      isSystem: true,
      policies: ['BarStaffPolicy'],
    },
    OWNER: {
      description: 'Club owner',
      isSystem: true,
      policies: ['OwnerPolicy'],
    },
  } as Record<string, RoleDefinition>,

  /**
   * Baseline groups created on database seed with their attached policies
   */
  groups: {
    // Developers can add domain groups here (e.g. 'Engineering', 'Moderators', 'Support')
  } as Record<string, GroupDefinition>,

  /**
   * Registration policy defaults
   */
  registration: {
    defaultPolicy: 'ExternalUserPolicy',
    defaultRole: 'MEMBER' as string | undefined,
    defaultGroup: undefined as string | undefined,
  },
} as const;

export type IamConfigType = typeof IamConfig;

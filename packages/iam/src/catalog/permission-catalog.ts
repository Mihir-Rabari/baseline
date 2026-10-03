export interface PermissionDefinition {
  id: string; // e.g. "users:read"
  namespace: string;
  action: string;
  description?: string;
  isSystem?: boolean;
}

export interface RegisterNamespaceParams {
  namespace: string;
  permissions: Array<{
    action: string;
    description?: string;
  } | string>;
}

export class PermissionCatalog {
  private static instance: PermissionCatalog;
  private permissionsMap = new Map<string, PermissionDefinition>();

  private constructor() {
    this.registerBaselinePermissions();
  }

  public static getInstance(): PermissionCatalog {
    if (!PermissionCatalog.instance) {
      PermissionCatalog.instance = new PermissionCatalog();
    }
    return PermissionCatalog.instance;
  }

  /**
   * Register baseline IAM system permissions
   */
  private registerBaselinePermissions(): void {
    const baseline = [
      // Users
      { id: 'users:read', namespace: 'users', action: 'read', description: 'View user accounts and profiles', isSystem: true },
      { id: 'users:create', namespace: 'users', action: 'create', description: 'Create new user accounts', isSystem: true },
      { id: 'users:update', namespace: 'users', action: 'update', description: 'Modify user accounts and status', isSystem: true },
      { id: 'users:delete', namespace: 'users', action: 'delete', description: 'Permanently delete user accounts', isSystem: true },

      // Roles
      { id: 'roles:read', namespace: 'roles', action: 'read', description: 'View IAM roles', isSystem: true },
      { id: 'roles:create', namespace: 'roles', action: 'create', description: 'Create new IAM roles', isSystem: true },
      { id: 'roles:update', namespace: 'roles', action: 'update', description: 'Modify IAM roles and attach policies', isSystem: true },
      { id: 'roles:delete', namespace: 'roles', action: 'delete', description: 'Delete IAM roles', isSystem: true },

      // Groups
      { id: 'groups:read', namespace: 'groups', action: 'read', description: 'View IAM groups', isSystem: true },
      { id: 'groups:create', namespace: 'groups', action: 'create', description: 'Create new IAM groups', isSystem: true },
      { id: 'groups:update', namespace: 'groups', action: 'update', description: 'Modify IAM groups and manage members', isSystem: true },
      { id: 'groups:delete', namespace: 'groups', action: 'delete', description: 'Delete IAM groups', isSystem: true },

      // Policies
      { id: 'policies:read', namespace: 'policies', action: 'read', description: 'View IAM policies and statements', isSystem: true },
      { id: 'policies:create', namespace: 'policies', action: 'create', description: 'Create new IAM policies', isSystem: true },
      { id: 'policies:update', namespace: 'policies', action: 'update', description: 'Modify IAM policies', isSystem: true },
      { id: 'policies:delete', namespace: 'policies', action: 'delete', description: 'Delete IAM policies', isSystem: true },

      // Permissions
      { id: 'permissions:read', namespace: 'permissions', action: 'read', description: 'Browse registered permissions catalog', isSystem: true },

      // Admin portal access
      { id: 'admin:access', namespace: 'admin', action: 'access', description: 'Access administrative dashboard & management interface', isSystem: true },

      // Self-Resource Permissions (for external users)
      { id: 'profile:read:self', namespace: 'profile', action: 'read:self', description: 'Read own profile information', isSystem: true },
      { id: 'profile:update:self', namespace: 'profile', action: 'update:self', description: 'Update own profile information', isSystem: true },
      { id: 'notifications:read:self', namespace: 'notifications', action: 'read:self', description: 'View own notifications', isSystem: true },
      { id: 'notifications:update:self', namespace: 'notifications', action: 'update:self', description: 'Manage own notifications', isSystem: true },
    ];

    for (const perm of baseline) {
      this.permissionsMap.set(perm.id, perm);
    }
  }

  /**
   * Reusable API for future domain modules to declare permissions.
   * Example: registerPermissions({ namespace: 'projects', permissions: ['read', 'create', 'update', 'delete'] })
   */
  public registerPermissions(params: RegisterNamespaceParams): PermissionDefinition[] {
    const registered: PermissionDefinition[] = [];

    for (const p of params.permissions) {
      const action = typeof p === 'string' ? p : p.action;
      const description = typeof p === 'string' ? `Permission to ${action} ${params.namespace}` : p.description;
      const id = `${params.namespace}:${action}`;

      const definition: PermissionDefinition = {
        id,
        namespace: params.namespace,
        action,
        description,
        isSystem: false,
      };

      this.permissionsMap.set(id, definition);
      registered.push(definition);
    }

    return registered;
  }

  public getPermission(id: string): PermissionDefinition | undefined {
    return this.permissionsMap.get(id);
  }

  public getAllPermissions(): PermissionDefinition[] {
    return Array.from(this.permissionsMap.values());
  }

  public isRegistered(id: string): boolean {
    return this.permissionsMap.has(id);
  }
}

export const permissionCatalog = PermissionCatalog.getInstance();

export function registerPermissions(params: RegisterNamespaceParams): PermissionDefinition[] {
  return permissionCatalog.registerPermissions(params);
}

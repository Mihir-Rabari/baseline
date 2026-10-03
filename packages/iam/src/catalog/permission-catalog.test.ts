import { describe, it, expect } from 'vitest';
import { PermissionCatalog, registerPermissions } from './permission-catalog.js';

describe('Permission Catalog', () => {
  const catalog = PermissionCatalog.getInstance();

  it('should initialize with baseline system permissions', () => {
    const all = catalog.getAllPermissions();
    expect(all.length).toBeGreaterThanOrEqual(15);

    expect(catalog.isRegistered('users:read')).toBe(true);
    expect(catalog.isRegistered('roles:create')).toBe(true);
    expect(catalog.isRegistered('groups:update')).toBe(true);
    expect(catalog.isRegistered('policies:delete')).toBe(true);
    expect(catalog.isRegistered('admin:access')).toBe(true);
    expect(catalog.isRegistered('profile:read:self')).toBe(true);
  });

  it('should allow feature modules to dynamically register custom permissions', () => {
    const registered = registerPermissions({
      namespace: 'custom_reports',
      permissions: [
        { action: 'generate', description: 'Generate custom business reports' },
        { action: 'export', description: 'Export report data to CSV/PDF' },
      ],
    });

    expect(registered).toHaveLength(2);
    expect(catalog.isRegistered('custom_reports:generate')).toBe(true);
    expect(catalog.isRegistered('custom_reports:export')).toBe(true);

    const reportPerm = catalog.getPermission('custom_reports:generate');
    expect(reportPerm?.namespace).toBe('custom_reports');
    expect(reportPerm?.action).toBe('generate');
  });

  it('should return undefined for unregistered permissions', () => {
    expect(catalog.getPermission('nonexistent:action')).toBeUndefined();
    expect(catalog.isRegistered('nonexistent:action')).toBe(false);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../app');
function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? pages(path) : entry.name === 'page.tsx' ? [path] : [];
  });
}

describe('Page layout consistency', () => {
  it('uses the section spacing token for immediate PageHeader wrappers', () => {
    for (const path of pages(resolve(app, '(app)'))) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/<div className="(space-y-\d+)">\s*<PageHeader/g)) {
        expect(match[1], path).toBe('space-y-8');
      }
    }
  });

  it('aligns legacy IAM and detail screens with the section spacing token', () => {
    for (const route of ['admin/iam/groups', 'admin/iam/permissions', 'admin/iam/policies', 'admin/iam/roles', 'admin/iam/users', 'members/[id]', 'invoices/[id]']) {
      const source = readFileSync(resolve(app, '(app)', route, 'page.tsx'), 'utf8');
      expect(source.match(/<div className="space-y-([568])/)?.[1], route).toBe('8');
    }
  });

  it('lets app content shrink and makes entrance motion optional', () => {
    const layout = readFileSync(resolve(app, '(app)/layout.tsx'), 'utf8');
    expect(layout).toContain('min-w-0 flex-1 px-4');
    expect(layout).toContain('max-w-5xl space-y-8');
    const template = readFileSync(resolve(app, '(app)/template.tsx'), 'utf8');
    expect(template).toContain('min-w-0 motion-safe:animate-rise');
    const css = readFileSync(resolve(app, 'globals.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});



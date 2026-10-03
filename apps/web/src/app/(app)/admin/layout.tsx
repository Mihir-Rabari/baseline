'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ADMIN_NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/iam/users', label: 'Users' },
  { href: '/admin/iam/roles', label: 'Roles' },
  { href: '/admin/iam/groups', label: 'Groups' },
  { href: '/admin/iam/policies', label: 'Policies' },
  { href: '/admin/iam/permissions', label: 'Permissions' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isRoot, hasPermission } = useAuth();

  const canAccessAdmin = isRoot || hasPermission('admin:access');

  // Being signed in is already guaranteed by the (app) layout. The only check
  // left here is the permission one.
  if (!user) return null;

  if (!canAccessAdmin) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Not allowed</h1>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-xs text-foreground">{user.email}</code> doesn&apos;t have
          the <code className="font-mono text-xs text-foreground">admin:access</code> permission.
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  // A horizontal tab strip, not a second sidebar. The app shell already owns
  // the vertical navigation; nesting another one produced two competing rails.
  return (
    <div className="space-y-8">
      <nav
        aria-label="Admin sections"
        className="-mb-px flex gap-1 overflow-x-auto border-b pb-px"
      >
        {ADMIN_NAV.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 pb-2.5 text-sm transition-colors',
                isActive
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

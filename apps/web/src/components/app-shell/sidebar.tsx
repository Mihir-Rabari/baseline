'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rendered only when true. Used for permission-gated destinations. */
  show?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Primary navigation for signed-in routes.
 *
 * Icons here are structural, not decorative: one per destination, so a
 * collapsed or scanned sidebar stays legible. Icons do not go next to headings,
 * inside buttons that already have a verb, or beside body text.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isRoot, hasPermission } = useAuth();
  const canAccessAdmin = isRoot || hasPermission('admin:access');

  const sections: NavSection[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
        { href: '/profile', label: 'Profile', icon: User },
      ],
    },
    {
      label: 'Administration',
      items: [{ href: '/admin', label: 'Admin', icon: ShieldCheck, show: canAccessAdmin }],
    },
  ];

  return (
    <nav className="flex flex-col gap-6" aria-label="Main">
      {sections.map((section) => {
        const visible = section.items.filter((item) => item.show !== false);
        if (visible.length === 0) return null;

        return (
          <div key={section.label} className="space-y-1">
            <p className="px-3 text-xs font-medium text-muted-foreground">{section.label}</p>

            {visible.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

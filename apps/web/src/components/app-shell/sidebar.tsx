'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { matchNav, useNavGroups } from '@/components/app-shell/nav';

/**
 * Primary navigation. One entry per group; the pages inside a group are tabs
 * (see GroupTabs), so the sidebar stays short.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const groups = useNavGroups();
  const match = matchNav(groups, pathname);
  const entries = groups.flatMap((group) => group.tabs
    ? [{ key: group.id, href: group.items[0].href, label: group.label, icon: group.icon }]
    : group.items.map((item) => ({ key: item.href, href: item.href, label: item.label, icon: item.icon })));
  const activeKey = match ? (match.group.tabs ? match.group.id : match.item.href) : undefined;
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const isActive = entry.key === activeKey;
        return (
          <Link key={entry.key} href={entry.href} onClick={onNavigate} aria-current={isActive ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}>
            <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} aria-hidden />
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}

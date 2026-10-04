'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { matchNav, useNavGroups } from '@/components/app-shell/nav';

/** Heading, subtitle and tab strip for the pages of one sidebar group. Renders nothing for ungrouped screens. */
export function GroupTabs() {
  const pathname = usePathname() ?? '';
  const groups = useNavGroups();
  const match = matchNav(groups, pathname);
  if (!match || !match.group.tabs) return null;
  const { group, item: current } = match;
  const Icon = group.icon;
  return (
    <div className="space-y-3 border-b">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
        <div><h1 className="text-xl font-semibold leading-tight tracking-tight">{group.label}</h1><p className="text-sm text-muted-foreground">{group.subtitle}</p></div>
      </div>
      {group.items.length > 1 && (
        <nav aria-label={`${group.label} sections`} className="-mb-px flex gap-1 overflow-x-auto">
          {group.items.map((item) => {
            const ItemIcon = item.icon;
            const isActive = item.href === current.href;
            return (
              <Link key={item.href} href={item.href} aria-current={isActive ? 'page' : undefined}
                className={cn('flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors',
                  isActive ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                <ItemIcon className={cn('size-4', isActive && 'text-primary')} aria-hidden />{item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

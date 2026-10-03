'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ShieldCheck, CalendarDays, Ticket, IdCard, Users,
  ShoppingCart, Package, Boxes, Contact, Armchair, ChefHat, Receipt, Clock,
  FileText, BriefcaseBusiness, ChartColumn, Settings, type LucideIcon } from 'lucide-react';
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
  const can = (permission: string) => isRoot || hasPermission(permission);
  const isMember = can('bookings:read:self');

  const sections: NavSection[] = [
    {
      label: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/courts', label: 'Courts', icon: CalendarDays, show: can('courts:read') || isMember },
        { href: '/bookings', label: 'Bookings', icon: Ticket, show: can('bookings:read') || isMember },
        { href: '/membership', label: 'Membership', icon: IdCard, show: isMember },
      ],
    },
    {
      label: 'Front desk',
      items: [
        { href: '/members', label: 'Members', icon: Users, show: can('members:read') },
        { href: '/pos', label: 'Counter sale', icon: ShoppingCart, show: can('orders:create') },
        { href: '/orders', label: 'Orders', icon: Package, show: can('orders:read') || can('orders:read:self') },
        { href: '/inventory', label: 'Inventory', icon: Boxes, show: can('inventory:read') },
        { href: '/crm', label: 'Leads', icon: Contact, show: can('crm:read') },
      ],
    },
    {
      label: 'Bar',
      items: [
        { href: '/bar', label: 'Floor', icon: Armchair, show: can('bar:read') },
        { href: '/bar/kitchen', label: 'Kitchen', icon: ChefHat, show: can('bar:kitchen') },
        { href: '/bar/earnings', label: 'Earnings', icon: Receipt, show: can('bar:read') },
      ],
    },
    {
      label: 'Club',
      items: [
        { href: '/shifts', label: 'Shifts', icon: Clock, show: can('shifts:read') },
        { href: '/invoices', label: 'Invoices', icon: FileText, show: can('invoices:read') },
        { href: '/hr', label: 'Staff and leave', icon: BriefcaseBusiness, show: can('hr:read') || can('leave:read:self') },
        { href: '/reports', label: 'Reports', icon: ChartColumn, show: can('reports:read') },
      ],
    },
    {
      label: 'Administration',
      items: [
        { href: '/admin/club', label: 'Club settings', icon: Settings, show: canAccessAdmin },
        { href: '/admin', label: 'Access (IAM)', icon: ShieldCheck, show: canAccessAdmin },
      ],
    },
  ];
  const activeHref = sections.flatMap((section) => section.items)
    .filter((item) => item.show !== false &&
      (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

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
              const isActive = activeHref === item.href;

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

import { LayoutDashboard, ShieldCheck, CalendarDays, Ticket, IdCard, Users, ShoppingCart, Package, Boxes, Contact, Armchair, ChefHat, Receipt, Clock,
  FileText, BriefcaseBusiness, BookOpen, ChartColumn, Settings, Tags, ConciergeBell, GlassWater, Building2, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export interface NavItem { href: string; label: string; icon: LucideIcon; show?: boolean }
export interface NavGroup {
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  /** Grouped destinations show as tabs inside the page; ungrouped ones are plain sidebar links. */
  tabs: boolean;
  items: NavItem[];
}

/** Every signed-in destination, grouped. The sidebar shows one entry per group and the group's pages become tabs. */
export function useNavGroups(): NavGroup[] {
  const { isRoot, hasPermission } = useAuth();
  const can = (permission: string) => isRoot || hasPermission(permission);
  const isMember = can('bookings:read:self');
  const canAdmin = can('admin:access');
  const groups: NavGroup[] = [
    { id: 'home', label: 'Dashboard', subtitle: '', icon: LayoutDashboard, tabs: false, items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    { id: 'play', label: 'Courts', subtitle: 'Book courts, manage the schedule and memberships.', icon: CalendarDays, tabs: true, items: [
      { href: '/courts', label: 'Courts', icon: CalendarDays, show: can('courts:read') || isMember },
      { href: '/bookings', label: 'Bookings', icon: Ticket, show: can('bookings:read') || isMember },
      { href: '/membership', label: 'Membership', icon: IdCard, show: isMember },
    ] },
    { id: 'desk', label: 'Front desk', subtitle: 'Members, sales, orders, stock and leads.', icon: ConciergeBell, tabs: true, items: [
      { href: '/members', label: 'Members', icon: Users, show: can('members:read') },
      { href: '/pos', label: 'Counter sale', icon: ShoppingCart, show: can('orders:create') },
      { href: '/orders', label: 'Orders', icon: Package, show: can('orders:read') || can('orders:read:self') },
      { href: '/inventory', label: 'Inventory', icon: Boxes, show: can('inventory:read') },
      { href: '/crm', label: 'Leads', icon: Contact, show: can('crm:read') },
    ] },
    { id: 'bar', label: 'Bar', subtitle: 'Floor, kitchen, menu and takings.', icon: GlassWater, tabs: true, items: [
      { href: '/bar', label: 'Floor', icon: Armchair, show: can('bar:read') },
      { href: '/bar/kitchen', label: 'Kitchen', icon: ChefHat, show: can('bar:kitchen') },
      { href: '/bar/menu', label: 'Menu', icon: BookOpen, show: can('bar:read') },
      { href: '/bar/earnings', label: 'Earnings', icon: Receipt, show: can('bar:read') },
    ] },
    { id: 'club', label: 'Club', subtitle: 'Staff, shifts, invoices and reports.', icon: Building2, tabs: true, items: [
      { href: '/shifts', label: 'Shifts', icon: Clock, show: can('shifts:read') },
      { href: '/hr', label: 'Staff and leave', icon: BriefcaseBusiness, show: can('hr:read') || can('leave:read:self') },
      { href: '/invoices', label: 'Invoices', icon: FileText, show: can('invoices:read') },
      { href: '/categories', label: 'Categories', icon: Tags, show: can('products:update') || (can('bar:manage') && can('reports:read')) },
      { href: '/reports', label: 'Reports', icon: ChartColumn, show: can('reports:read') },
    ] },
    { id: 'admin', label: 'Administration', subtitle: '', icon: Settings, tabs: false, items: [
      { href: '/admin/club', label: 'Club settings', icon: Settings, show: canAdmin },
      { href: '/admin', label: 'Access (IAM)', icon: ShieldCheck, show: canAdmin },
    ] },
  ];
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) })).filter((g) => g.items.length > 0);
}

/** The group and item the path belongs to; the longest matching href wins. */
export function matchNav(groups: NavGroup[], pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of groups) for (const item of group.items) {
    if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.item.href.length)) best = { group, item };
  }
  return best;
}

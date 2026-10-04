import { LayoutDashboard, ShieldCheck, CalendarDays, Ticket, IdCard, Users, ShoppingCart, Package, Boxes, Contact, Armchair, ChefHat, Receipt, Clock, FileText, BriefcaseBusiness, BookOpen, ChartColumn, Settings, Tags, type LucideIcon } from 'lucide-react';

const ROUTES: [string, LucideIcon][] = [
  ['/dashboard', LayoutDashboard], ['/courts', CalendarDays], ['/bookings', Ticket], ['/membership', IdCard], ['/members', Users],
  ['/pos', ShoppingCart], ['/orders', Package], ['/inventory', Boxes], ['/crm', Contact], ['/bar/kitchen', ChefHat], ['/bar/menu', BookOpen],
  ['/bar/earnings', Receipt], ['/bar', Armchair], ['/shifts', Clock], ['/invoices', FileText], ['/hr', BriefcaseBusiness],
  ['/categories', Tags], ['/reports', ChartColumn], ['/admin/club', Settings], ['/admin', ShieldCheck],
];

/** The icon for the screen at `pathname`, matching the sidebar. Longest prefix wins. */
export function routeIcon(pathname: string): LucideIcon | null {
  const hit = ROUTES.filter(([href]) => pathname === href || pathname.startsWith(href + '/')).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}

import React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';

type StatusKind = 'booking' | 'membership' | 'order' | 'lead' | 'invoice' | 'stock';
type Status = { label: string; variant: BadgeProps['variant'] };
const statuses: Record<StatusKind, Record<string, Status>> = {
  booking: {
    CONFIRMED: { label: 'Confirmed', variant: 'success' },
    COMPLETED: { label: 'Completed', variant: 'secondary' },
    CANCELLED: { label: 'Cancelled', variant: 'outline' },
    NO_SHOW: { label: 'No show', variant: 'destructive' },
  },
  membership: {
    OK: { label: 'Active', variant: 'success' },
    ACTIVE: { label: 'Active', variant: 'success' },
    EXPIRING_SOON: { label: 'Expiring soon', variant: 'warning' },
    EXPIRED: { label: 'Expired', variant: 'destructive' },
    CANCELLED: { label: 'Cancelled', variant: 'outline' },
    REPLACED: { label: 'Replaced', variant: 'secondary' },
    NONE: { label: 'No membership', variant: 'outline' },
  },
  order: {
    PLACED: { label: 'Placed', variant: 'warning' },
    READY: { label: 'Ready', variant: 'success' },
    OUT_FOR_DELIVERY: { label: 'Out for delivery', variant: 'warning' },
    COMPLETED: { label: 'Completed', variant: 'secondary' },
    COLLECTED: { label: 'Collected', variant: 'secondary' },
    DELIVERED: { label: 'Delivered', variant: 'secondary' },
    CANCELLED: { label: 'Cancelled', variant: 'outline' },
  },
  lead: {
    NEW: { label: 'New', variant: 'warning' },
    CONTACTED: { label: 'Contacted', variant: 'secondary' },
    QUOTED: { label: 'Quoted', variant: 'warning' },
    WON: { label: 'Won', variant: 'success' },
    LOST: { label: 'Lost', variant: 'outline' },
  },
  invoice: {
    DRAFT: { label: 'Draft', variant: 'secondary' },
    SENT: { label: 'Sent', variant: 'warning' },
    PART_PAID: { label: 'Part paid', variant: 'warning' },
    PAID: { label: 'Paid', variant: 'success' },
    OVERDUE: { label: 'Overdue', variant: 'destructive' },
    VOID: { label: 'Void', variant: 'outline' },
  },
  stock: {
    IN_STOCK: { label: 'In stock', variant: 'success' },
    LOW: { label: 'Low', variant: 'warning' },
    OUT: { label: 'Out', variant: 'destructive' },
  },
};

export function StatusBadge({ kind, value }: { kind: StatusKind; value: string }) {
  const status = Object.hasOwn(statuses[kind], value) ? statuses[kind][value] : undefined;
  return <Badge variant={status?.variant ?? 'outline'}>{status?.label ?? 'Unknown status'}</Badge>;
}

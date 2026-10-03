'use client';

import React from 'react';
import type { LeadStatus } from '@packages/validation';
import { formatDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/club/status-badge';
import { KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { Button } from '@/components/ui/button';
import { Phone, Calendar, FileText } from 'lucide-react';

export interface LeadSummaryItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  status: LeadStatus;
  interestedPlan?: { id: string; code: string; name: string } | null;
  nextFollowUpAt: string | null;
  quoteCount?: number;
}

const COLUMNS: KanbanColumn[] = [
  { id: 'NEW', title: 'New' },
  { id: 'CONTACTED', title: 'Contacted' },
  { id: 'QUOTED', title: 'Quoted' },
  { id: 'WON', title: 'Won' },
  { id: 'LOST', title: 'Lost' },
];

export function LeadsBoard({
  leads,
  canManage,
  onSelect,
  onStatusChange,
}: {
  leads: LeadSummaryItem[];
  canManage: boolean;
  onSelect: (leadId: string) => void;
  onStatusChange: (lead: LeadSummaryItem, next: LeadStatus) => void;
}) {
  return (
    <KanbanBoard
      columns={COLUMNS}
      items={leads}
      idOf={(lead) => lead.id}
      columnOf={(lead) => lead.status}
      emptyLabel="No leads"
      onMove={
        canManage
          ? (lead, to) => {
              if (to !== lead.status && to !== 'WON') {
                onStatusChange(lead, to as LeadStatus);
              } else if (to === 'WON') {
                onSelect(lead.id);
              }
            }
          : undefined
      }
      canDrop={(lead, to) => to !== lead.status}
      renderCard={(lead) => {
        const overdue =
          lead.nextFollowUpAt &&
          Date.parse(lead.nextFollowUpAt) < Date.now() &&
          !['WON', 'LOST'].includes(lead.status);

        return (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelect(lead.id)}
                className="text-left font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {lead.name}
              </button>
              <StatusBadge kind="lead" value={lead.status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {lead.phone ? (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" aria-hidden />
                  {lead.phone}
                </span>
              ) : (
                <span>No phone</span>
              )}
              <span>· {lead.source.toLowerCase().replaceAll('_', ' ')}</span>
            </div>

            {lead.interestedPlan && (
              <p className="text-xs">
                <span className="text-muted-foreground">Interested in: </span>
                <span className="font-medium">{lead.interestedPlan.name}</span>
              </p>
            )}

            {lead.nextFollowUpAt && (
              <p
                className={`flex items-center gap-1 text-xs ${
                  overdue ? 'font-medium text-destructive' : 'text-muted-foreground'
                }`}
              >
                <Calendar className="h-3 w-3" aria-hidden />
                <span>Follow-up: {formatDateTime(lead.nextFollowUpAt)}</span>
              </p>
            )}

            {(lead.quoteCount ?? 0) > 0 && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" aria-hidden />
                <span>{lead.quoteCount} quote(s)</span>
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onSelect(lead.id)}
              >
                View details
              </Button>
              {canManage && lead.status === 'NEW' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onStatusChange(lead, 'CONTACTED')}
                >
                  Contacted
                </Button>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}

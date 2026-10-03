'use client';

import React from 'react';
import type { LeaveStatus, LeaveDecisionRequest } from '@packages/validation';
import { CardGrid, KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, User } from 'lucide-react';

export interface LeaveRequestItem {
  id: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  employee: {
    id: string;
    fullName: string;
  };
}

const LEAVE_COLUMNS: KanbanColumn[] = [
  { id: 'PENDING', title: 'Pending review' },
  { id: 'APPROVED', title: 'Approved' },
  { id: 'REJECTED', title: 'Rejected' },
  { id: 'CANCELLED', title: 'Cancelled' },
];

export function LeaveCards({
  requests,
  canDecide,
  disabled,
  onDecide,
}: {
  requests: LeaveRequestItem[];
  canDecide: boolean;
  disabled?: boolean;
  onDecide: (id: string, decision: LeaveDecisionRequest['decision']) => void;
}) {
  return (
    <CardGrid>
      {requests.map((row) => (
        <article
          key={row.id}
          className="flex flex-col justify-between space-y-3 rounded-lg border bg-card p-4 shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-muted p-1.5 text-muted-foreground">
                  <User className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{row.employee.fullName}</h3>
                  <p className="text-xs capitalize text-muted-foreground">{row.leaveType.toLowerCase()} leave</p>
                </div>
              </div>
              <Badge
                variant={
                  row.status === 'APPROVED'
                    ? 'success'
                    : row.status === 'PENDING'
                    ? 'warning'
                    : 'outline'
                }
              >
                {row.status.toLowerCase()}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
              <Calendar className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                {row.fromDate} – {row.toDate} ({row.days} {row.days === 1 ? 'day' : 'days'})
              </span>
            </div>

            <p className="text-xs text-foreground/90 italic">
              &ldquo;{row.reason ?? 'No reason provided'}&rdquo;
            </p>
          </div>

          {canDecide && row.status === 'PENDING' && (
            <div className="flex items-center gap-2 border-t pt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 text-xs"
                disabled={disabled}
                onClick={() => onDecide(row.id, 'APPROVED')}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 flex-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={disabled}
                onClick={() => onDecide(row.id, 'REJECTED')}
              >
                Reject
              </Button>
            </div>
          )}
        </article>
      ))}
    </CardGrid>
  );
}

export function LeaveBoard({
  requests,
  canDecide,
  disabled,
  onDecide,
}: {
  requests: LeaveRequestItem[];
  canDecide: boolean;
  disabled?: boolean;
  onDecide: (id: string, decision: LeaveDecisionRequest['decision']) => void;
}) {
  const droppable = (leave: LeaveRequestItem, to: string) => {
    if (!canDecide) return false;
    return leave.status === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED');
  };

  return (
    <KanbanBoard
      columns={LEAVE_COLUMNS}
      items={requests}
      idOf={(r) => r.id}
      columnOf={(r) => r.status}
      emptyLabel="No requests"
      canDrop={droppable}
      onMove={(leave, to) => {
        if (droppable(leave, to)) {
          onDecide(leave.id, to as LeaveDecisionRequest['decision']);
        }
      }}
      renderCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-1">
            <h4 className="font-semibold text-sm text-foreground">{row.employee.fullName}</h4>
            <span className="text-[11px] capitalize text-muted-foreground">{row.leaveType.toLowerCase()}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            {row.fromDate} – {row.toDate} ({row.days}d)
          </p>

          <p className="text-xs line-clamp-2 text-foreground/80 italic">
            &ldquo;{row.reason ?? 'No reason'}&rdquo;
          </p>

          {canDecide && row.status === 'PENDING' && (
            <div className="flex items-center gap-1.5 border-t pt-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 px-2 text-xs"
                disabled={disabled}
                onClick={() => onDecide(row.id, 'APPROVED')}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 px-2 text-xs text-destructive"
                disabled={disabled}
                onClick={() => onDecide(row.id, 'REJECTED')}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    />
  );
}

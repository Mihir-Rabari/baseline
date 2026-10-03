'use client';

import React from 'react';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardGrid } from '@/components/club/views';
import { Clock, User } from 'lucide-react';

export interface ShiftItem {
  id: string;
  roleLabel: string;
  startsAt: string;
  endsAt: string;
  status: string;
  clockInAt: string | null;
  employee: {
    id: string;
    fullName: string;
  };
}

export function ShiftsCards({
  shifts,
  canManage,
  disabled,
  onRemove,
}: {
  shifts: ShiftItem[];
  canManage: boolean;
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <CardGrid>
      {shifts.map((row) => (
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
                  <p className="text-xs text-muted-foreground">
                    {row.roleLabel.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                  </p>
                </div>
              </div>
              <Badge
                variant={
                  row.status === 'ON_SHIFT'
                    ? 'success'
                    : row.status === 'MISSED'
                    ? 'warning'
                    : 'outline'
                }
              >
                {row.status.replaceAll('_', ' ').toLowerCase()}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {formatDateTime(row.startsAt)} – {formatDateTime(row.endsAt)}
              </span>
            </div>
          </div>

          {canManage && !row.clockInAt && (
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={disabled}
                onClick={() => onRemove(row.id)}
              >
                Remove shift
              </Button>
            </div>
          )}
        </article>
      ))}
    </CardGrid>
  );
}

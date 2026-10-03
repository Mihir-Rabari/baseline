'use client';

import React from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/club/status-badge';
import { CardGrid, KanbanBoard, type KanbanColumn } from '@/components/club/views';
import { Badge } from '@/components/ui/badge';
import { Phone, Calendar, ArrowRight } from 'lucide-react';

export interface MemberItem {
  id: string;
  memberCode: string;
  fullName: string;
  phone: string;
  membership?: {
    plan: {
      code: string;
      name: string;
    };
    expiryState: string;
    daysLeft: number;
  } | null;
}

const MEMBER_COLUMNS: KanbanColumn[] = [
  { id: 'ACTIVE', title: 'Active' },
  { id: 'EXPIRING_SOON', title: 'Expiring soon' },
  { id: 'EXPIRED', title: 'Expired' },
  { id: 'NONE', title: 'No membership' },
];

export function MembersCards({ members }: { members: MemberItem[] }) {
  return (
    <CardGrid>
      {members.map((member) => (
        <article
          key={member.id}
          className="flex flex-col justify-between space-y-3 rounded-lg border bg-card p-4 shadow-sm"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">{member.memberCode}</span>
              <StatusBadge kind="membership" value={member.membership?.expiryState ?? 'NONE'} />
            </div>

            <div>
              <Link
                href={`/members/${member.id}`}
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {member.fullName}
              </Link>
              <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Phone className="h-4 w-4" aria-hidden />
                <span>{member.phone}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t pt-2 text-xs">
              <div>
                {member.membership ? (
                  <Badge
                    variant={
                      member.membership.plan.code === 'GOLD'
                        ? 'default'
                        : member.membership.plan.code === 'SILVER'
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {member.membership.plan.name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">No plan</span>
                )}
              </div>
              {member.membership && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-4 w-4" aria-hidden />
                  <span className="tabular">{Math.max(0, member.membership.daysLeft)} days left</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t">
            <Link
              href={`/members/${member.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <span>View profile</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </article>
      ))}
    </CardGrid>
  );
}

export function MembersBoard({ members }: { members: MemberItem[] }) {
  return (
    <KanbanBoard
      columns={MEMBER_COLUMNS}
      items={members}
      idOf={(m) => m.id}
      columnOf={(m) => m.membership?.expiryState ?? 'NONE'}
      emptyLabel="No members"
      renderCard={(member) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-1">
            <span className="font-mono text-[11px] text-muted-foreground">{member.memberCode}</span>
            {member.membership && (
              <Badge
                variant={
                  member.membership.plan.code === 'GOLD'
                    ? 'default'
                    : member.membership.plan.code === 'SILVER'
                    ? 'secondary'
                    : 'outline'
                }
                className="text-[10px] px-1.5 py-0"
              >
                {member.membership.plan.name}
              </Badge>
            )}
          </div>

          <Link
            href={`/members/${member.id}`}
            className="block font-medium text-sm text-foreground underline-offset-4 hover:underline"
          >
            {member.fullName}
          </Link>

          <p className="text-xs text-muted-foreground">{member.phone}</p>

          <div className="flex items-center justify-between border-t pt-1.5 text-xs text-muted-foreground">
            <StatusBadge kind="membership" value={member.membership?.expiryState ?? 'NONE'} />
            {member.membership && (
              <span className="tabular">{Math.max(0, member.membership.daysLeft)} days</span>
            )}
          </div>
        </div>
      )}
    />
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useIamUsers,
  useIamRoles,
  useIamGroups,
  useIamPolicies,
  useIamPermissions,
} from '@/hooks/use-iam';

function Stat({
  label,
  value,
  loading,
  href,
}: {
  label: string;
  value: number;
  loading: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="text-sm text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-10" />
      ) : (
        <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      )}
    </Link>
  );
}

export default function AdminOverviewPage() {
  const { data: usersData, isLoading: usersLoading } = useIamUsers({ limit: 1 });
  const { data: rolesData, isLoading: rolesLoading } = useIamRoles();
  const { data: groupsData, isLoading: groupsLoading } = useIamGroups();
  const { data: policiesData, isLoading: policiesLoading } = useIamPolicies();
  const { data: permissionsData, isLoading: permsLoading } = useIamPermissions();

  const stats = [
    {
      label: 'Users',
      value: usersData?.meta.totalItems ?? 0,
      loading: usersLoading,
      href: '/admin/iam/users',
    },
    { label: 'Roles', value: rolesData?.length ?? 0, loading: rolesLoading, href: '/admin/iam/roles' },
    {
      label: 'Groups',
      value: groupsData?.length ?? 0,
      loading: groupsLoading,
      href: '/admin/iam/groups',
    },
    {
      label: 'Policies',
      value: policiesData?.length ?? 0,
      loading: policiesLoading,
      href: '/admin/iam/policies',
    },
    {
      label: 'Permissions',
      value: permissionsData?.length ?? 0,
      loading: permsLoading,
      href: '/admin/iam/permissions',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">Users, roles, groups, and policies.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Stat key={stat.label} {...stat} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How a permission check resolves</CardTitle>
          <CardDescription>
            The order <code className="font-mono text-xs">@packages/iam</code> evaluates in. It stops
            at the first rule that matches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="tabular shrink-0 text-muted-foreground">1.</span>
              <p>
                If the identity is <code className="font-mono text-xs">ROOT</code>, allow. Root skips
                everything below.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="tabular shrink-0 text-muted-foreground">2.</span>
              <p>
                If any statement matches with{' '}
                <code className="font-mono text-xs">effect: deny</code> — from the user, their roles,
                or their groups — deny. A deny always beats an allow.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="tabular shrink-0 text-muted-foreground">3.</span>
              <p>
                If an allow statement matches, allow. For{' '}
                <code className="font-mono text-xs">:self</code> permissions, the resource owner must
                also be the caller.
              </p>
            </li>
            <li className="flex gap-3">
              <span className="tabular shrink-0 text-muted-foreground">4.</span>
              <p>Otherwise deny. Nothing is permitted by default.</p>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfilePanel } from '@/components/profile/profile-panel';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/app-shell/page-header';
import { DashboardWorkspace } from '@/components/club/dashboard-workspace';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function DashboardTabs() {
  const { user, session, effectivePermissions, isRoot } = useAuth();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'profile' ? 'profile' : 'overview');
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={user.name || user.email} description="Your club workspace and your account." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Dashboard sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="profile">Profile</TabsTrigger></TabsList>
      </Tabs>
      <div key={tab} className="animate-rise space-y-6">
        {tab === 'overview' ? <DashboardWorkspace /> : (
          <>
            <ProfilePanel />
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Field label="Status">
              <span className="capitalize">{user.status.toLowerCase()}</span>
            </Field>
            <Field label="Identity type">
              {isRoot ? (
                <Badge variant="warning">{user.identityType}</Badge>
              ) : (
                <span>{user.identityType}</span>
              )}
            </Field>
            <Field label="User ID">
              <code className="font-mono text-xs text-muted-foreground">{user.id}</code>
            </Field>
            <Field label="Session expires">
              {session ? (
                <time dateTime={new Date(session.expiresAt).toISOString()}>
                  {new Date(session.expiresAt).toLocaleString()}
                </time>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            {isRoot
              ? 'This is the root account.'
              : `${effectivePermissions.length} action${
                  effectivePermissions.length === 1 ? '' : 's'
                } allowed, resolved from your policies, groups, and roles.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isRoot ? (
            <p className="text-sm text-muted-foreground">
              Root skips policy evaluation and is allowed every action. Use a normal account to see
              how permissions actually resolve.
            </p>
          ) : effectivePermissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No permissions yet. An administrator can attach a policy to this account.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {effectivePermissions.map((action) => (
                <li
                  key={action}
                  className="rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs"
                >
                  {action}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}><DashboardTabs /></Suspense>;
}

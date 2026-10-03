'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfilePanel } from '@/components/profile/profile-panel';
import { PageHeader } from '@/components/app-shell/page-header';
import { DashboardWorkspace } from '@/components/club/dashboard-workspace';

function DashboardTabs() {
  const { user } = useAuth();
  const params = useSearchParams();
  const requestedTab = params.get('tab');
  const [tab, setTab] = useState(requestedTab === 'profile' ? 'profile' : 'overview');
  React.useEffect(() => { setTab(requestedTab === 'profile' ? 'profile' : 'overview'); }, [requestedTab]);
  if (!user) return null;
  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description="Club activity, quick actions and your account." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Dashboard sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="profile">Profile</TabsTrigger></TabsList>
      </Tabs>
      <div key={tab} className="motion-safe:animate-rise space-y-8">
        {tab === 'overview' ? <DashboardWorkspace /> : (
          <ProfilePanel />
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}><DashboardTabs /></Suspense>;
}

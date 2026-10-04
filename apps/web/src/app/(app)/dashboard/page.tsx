'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ProfilePanel } from '@/components/profile/profile-panel';
import { PageHeader } from '@/components/app-shell/page-header';
import { DashboardWorkspace } from '@/components/club/dashboard-workspace';

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function DashboardView() {
  const { user } = useAuth();
  const profile = useSearchParams().get('tab') === 'profile';
  if (!user) return null;
  return (
    <div className="space-y-6">
      {profile
        ? <PageHeader title="Your profile" description="Your details, photo and password." />
        : <PageHeader title={`${greeting()}, ${user.name?.split(' ')[0] ?? 'there'}`} description="Here is what is happening at the club today, plus shortcuts to the jobs you do most." actions={<Badge variant="outline" className="gap-1.5 font-normal">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Badge>} />}
      <div className="motion-safe:animate-rise space-y-6">{profile ? <ProfilePanel /> : <DashboardWorkspace />}</div>
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}><DashboardView /></Suspense>;
}

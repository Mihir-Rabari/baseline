'use client';
import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/app-shell/page-header';
import { HrWorkspace } from '@/components/club/hr-workspace';
export default function HrPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <div className="space-y-6"><PageHeader title="Staff and leave" description="Manage employees, review leave and plan payroll." /><HrWorkspace /></div>;
}

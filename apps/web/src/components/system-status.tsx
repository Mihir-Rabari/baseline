'use client';

import React from 'react';
import { useSystemHealth, useSystemInfo } from '@/hooks/use-health';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { API_BASE_URL } from '@/lib/api-client';
import type { ServiceStatus } from '@packages/shared';

type Status = ServiceStatus | 'ok' | 'degraded' | 'error' | 'down' | undefined;

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case 'ok':
      return <Badge variant="success">Up</Badge>;
    case 'degraded':
      return <Badge variant="warning">Degraded</Badge>;
    case 'down':
    case 'error':
      return <Badge variant="error">Down</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

function Service({
  name,
  status,
  value,
  detail,
}: {
  name: string;
  status: Status;
  value: string;
  detail: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{name}</span>
        <StatusBadge status={status} />
      </div>
      <div className="tabular font-mono text-lg">{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ms(value: number | undefined, fallback = '—') {
  return value !== undefined ? `${value} ms` : fallback;
}

export function SystemStatus() {
  const { data: health, isLoading, isError, error, refetch, isFetching } = useSystemHealth();
  const { data: systemInfo } = useSystemInfo();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Services</CardTitle>
          <CardDescription>Readiness probe against the API and its dependencies.</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {health && <StatusBadge status={health.status} />}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Checking…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Can&apos;t reach the API.</p>
            <p className="font-mono text-xs text-muted-foreground">
              {error instanceof Error ? error.message : `No response from ${API_BASE_URL}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Start the infrastructure with{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">pnpm infra:up</code>, then
              the servers with <code className="rounded bg-muted px-1.5 py-0.5 font-mono">pnpm dev</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Service
                name="API"
                status={health?.services.api}
                value={`v${health?.version ?? '—'}`}
                detail={`Up ${Math.floor(health?.uptime ?? 0)}s`}
              />
              <Service
                name="PostgreSQL"
                status={health?.services.database}
                value={ms(health?.details?.databaseLatencyMs)}
                detail="Drizzle connection pool"
              />
              <Service
                name="Redis"
                status={health?.services.redis}
                value={ms(health?.details?.redisLatencyMs)}
                detail="Cache and sessions"
              />
              <Service
                name="Object storage"
                status={health?.services.storage}
                value={ms(health?.details?.storageLatencyMs)}
                detail="S3-compatible bucket"
              />
            </div>

            {systemInfo && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
                <span>
                  Node <span className="font-mono text-foreground">{systemInfo.nodeVersion}</span>
                </span>
                <span>
                  Env <span className="font-mono text-foreground">{systemInfo.environment}</span>
                </span>
                <span>
                  Checked{' '}
                  <span className="font-mono text-foreground">
                    {new Date(systemInfo.timestamp).toLocaleTimeString()}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

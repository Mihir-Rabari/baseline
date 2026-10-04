'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function PageError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn't load this page. Please try again.</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="break-words text-sm">{error.message}</p>
        {onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
      </AlertDescription>
    </Alert>
  );
}

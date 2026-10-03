'use client';

import React, { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * A thin bar across the top of the window while anything is loading or saving. It waits 200 ms
 * before appearing, so quick requests never flash it.
 */
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [busy]);
  if (!visible) return null;
  return (
    <div role="progressbar" aria-label="Loading" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/15">
      <div className="h-full w-2/5 animate-progress-slide rounded-full bg-primary" />
    </div>
  );
}

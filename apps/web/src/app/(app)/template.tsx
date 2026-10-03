import React from 'react';

/** Next remounts templates on navigation so each page gets its own entrance. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 motion-safe:animate-rise">{children}</div>;
}

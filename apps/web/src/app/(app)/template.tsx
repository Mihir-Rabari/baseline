import React from 'react';

/** A template (unlike a layout) mounts again on every navigation, so each screen eases in. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}

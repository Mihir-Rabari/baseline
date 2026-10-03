import React from 'react';
export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="space-y-2 border-b pb-4"><p className="text-sm text-muted-foreground">{label}</p><p className="tabular text-3xl font-semibold">{value}</p>{hint && <p className="text-sm text-muted-foreground">{hint}</p>}</div>;
}

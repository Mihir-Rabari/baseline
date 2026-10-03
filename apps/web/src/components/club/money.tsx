import React from 'react';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export function Money({ paise, className }: { paise: number; className?: string }) {
  return <span className={cn('tabular', className)}>{formatMoney(paise)}</span>;
}

'use client';

import React, { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up from its previous value when it changes. `format` renders each step. */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), durationMs = 700 }: {
  value: number; format?: (n: number) => string; durationMs?: number;
}) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const from = useRef(prefersReducedMotion() ? value : 0);
  useEffect(() => {
    if (prefersReducedMotion() || from.current === value) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick); else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return <span className="tabular">{format(shown)}</span>;
}

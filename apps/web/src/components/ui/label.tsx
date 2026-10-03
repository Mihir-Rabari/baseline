'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

const REQUIRED_MARK = "after:ml-0.5 after:text-destructive after:content-['*']";

/**
 * Shows a red asterisk when the field it labels is required. Pass `required` explicitly, or let the label
 * detect `required` / `aria-required` on the control named by `htmlFor` (the asterisk is CSS-only, so the
 * label text stays unchanged for assistive tech and tests).
 */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants> & { required?: boolean }
>(({ className, required, htmlFor, ...props }, ref) => {
  const [detected, setDetected] = React.useState(false);
  React.useEffect(() => {
    const control = htmlFor ? document.getElementById(htmlFor) : null;
    const next = Boolean(control && ((control as HTMLInputElement).required || control.getAttribute('aria-required') === 'true'));
    setDetected((current) => (current === next ? current : next));
  });
  return (
    <LabelPrimitive.Root
      ref={ref}
      htmlFor={htmlFor}
      className={cn(labelVariants(), (required ?? detected) && REQUIRED_MARK, className)}
      {...props}
    />
  );
});
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

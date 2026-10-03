'use client';

import React, { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText } from '@/components/club/form-dialog';

/** Asks before a removal, and keeps the server's reason on screen when it refuses (open tab, upcoming bookings). */
export function ConfirmRemoveDialog({ open, title, description, confirmLabel = 'Remove', onConfirm, onClose }: {
  open: boolean; title: string; description: React.ReactNode; confirmLabel?: string;
  onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (!pending) { setError(null); onClose(); } };
  async function confirm() {
    setPending(true); setError(null);
    try { await onConfirm(); setPending(false); onClose(); }
    catch (caught) { setPending(false); setError(errorText(caught, 'Could not remove this.')); }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={close}>Cancel</Button>
          <Button type="button" variant="destructive" loading={pending} onClick={() => { void confirm(); }}>{pending ? 'Removing…' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

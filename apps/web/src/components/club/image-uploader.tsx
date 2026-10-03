'use client';

import React, { useId, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { UploadKind } from '@packages/validation';
import { ACCEPTED_IMAGE_TYPES, imageProblem, mediaUrl, uploadImage } from '@/lib/upload-api';
import { errorText } from '@/components/club/form-dialog';
import { Button } from '@/components/ui/button';

/**
 * Pick, preview, replace and remove one image. `value` is the stored reference (an uploaded path or
 * https link); `onChange` receives the new reference, or null when removed. Nothing is saved on the
 * record until the surrounding form is.
 */
export function ImageUploader({ kind, value, onChange, label = 'Photo', disabled }: {
  kind: UploadKind; value: string | null; onChange: (url: string | null) => void; label?: string; disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = mediaUrl(value);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow picking the same file again after an error
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try { onChange((await uploadImage(kind, file)).url); }
    catch (caught) { setError(errorText(caught, 'Could not upload the image.')); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
          {src ? <img src={src} alt={`${label} preview`} className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" aria-hidden />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" loading={busy} disabled={disabled || busy} onClick={() => input.current?.click()}>{src ? 'Replace image' : 'Upload image'}</Button>
          {src && <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => { setError(null); onChange(null); }}><Trash2 className="mr-1 h-4 w-4" aria-hidden />Remove</Button>}
        </div>
        <input id={id} ref={input} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" onChange={(e) => { void pick(e); }} />
      </div>
      <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 5 MB.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

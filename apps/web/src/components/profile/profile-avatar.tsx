'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useProfileAvatar } from '@/hooks/use-profile-avatar';
import { encodeProfileAvatar } from '@/lib/profile-avatar';
import { getErrorMessage } from '@/lib/errors';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function ProfileAvatar() {
  const { user, hasPermission } = useAuth();
  const photo = useProfileAvatar(user?.id, hasPermission('profile:read:self'));
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!user) return null;
  const pending = preparing || photo.upload.isPending || photo.remove.isPending;
  const initials = user.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || user.email[0].toUpperCase();
  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setMessage(''); setPreparing(true);
    try { await photo.upload.mutateAsync(await encodeProfileAvatar(file)); setMessage('Photo updated.'); }
    catch (cause) { setError(getErrorMessage(cause, 'The photo could not be saved. Try again.')); }
    finally { setPreparing(false); }
  }
  async function removePhoto() {
    setError(''); setMessage('');
    try { await photo.remove.mutateAsync(); setMessage('Photo removed.'); }
    catch (cause) { setError(getErrorMessage(cause, 'The photo could not be removed. Try again.')); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-4">
      {photo.isLoading ? <Skeleton className="h-20 w-20 rounded-full" aria-label="Loading profile photo" /> :
        <Avatar className="h-20 w-20 shadow-none"><AvatarImage src={photo.src} alt={`${user.name}'s profile photo`} /><AvatarFallback className="text-xl">{initials}</AvatarFallback></Avatar>}
      <div className="space-y-2">
        <p className="text-sm font-medium">Profile photo</p>
        <p className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 5 MB. Photos are cropped to a square.</p>
        {hasPermission('profile:update:self') && <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" className="hidden" aria-label="Choose profile photo" accept="image/png,image/jpeg,image/webp" onChange={selectPhoto} disabled={pending} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? 'Saving photo…' : photo.src ? 'Change photo' : 'Upload photo'}</Button>
          {photo.src && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={removePhoto}>Remove photo</Button>}
        </div>}
      </div>
    </div>
    {photo.isError && <div role="alert" className="space-y-2 text-sm"><p>Your photo could not be loaded. Try again.</p><Button type="button" variant="outline" size="sm" onClick={() => { photo.refetch(); }} disabled={photo.isFetching}>Retry photo</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
  </div>;
}

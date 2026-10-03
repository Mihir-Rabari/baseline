'use client';

import React, { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { useTheme } from 'next-themes';
import { ProfileAvatar } from './profile-avatar';

/** Name, email and password for the signed-in account; shown as the Profile tab of the dashboard. */
export function ProfilePanel() {
  const { user, session, effectivePermissions, isRoot, refreshSession, hasPermission, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const canUpdate = hasPermission('profile:update:self');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Profile fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  React.useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
  }, [user?.id, user?.name, user?.email]);

  // Auth is guaranteed by the (app) layout; this screen renders content only.
  if (!user) return null;

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setProfileLoading(true);

    try {
      await api.profile.update({ name, email });
      await refreshSession({ background: true });
      setProfileSuccess('Profile details updated successfully');
      toast.success('Profile updated', {
        description: 'Your profile changes have been saved.',
      });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to update profile');
      setProfileError(msg);
      toast.error('Update failed', {
        description: msg,
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      const msg = 'New password must be at least 8 characters long';
      setPasswordError(msg);
      toast.error('Weak password', { description: msg });
      return;
    }

    setPasswordLoading(true);

    try {
      await api.profile.changePassword({ currentPassword, newPassword });
      setPasswordSuccess('Password changed successfully');
      toast.success('Password updated', {
        description: 'Your password has been changed securely.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to change password');
      setPasswordError(msg);
      toast.error('Password change failed', {
        description: msg,
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <>

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Card>
          <form onSubmit={handleUpdateProfile}>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
              <CardDescription>
                Keep your name, email and profile photo up to date.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <ProfileAvatar />
              {!canUpdate && <p className="text-sm text-muted-foreground">Your account has read-only access to personal information.</p>}
              {profileSuccess && (
                <p role="status" className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
                  {profileSuccess}
                </p>
              )}
              {profileError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {profileError}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="prof-name">Name</Label>
                <Input
                  id="prof-name"
                  type="text"
                  autoComplete="name"
                  required
                  disabled={!canUpdate || profileLoading}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prof-email">Email</Label>
                <Input
                  id="prof-email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!canUpdate || profileLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </CardContent>

            {canUpdate && <CardFooter className="justify-end border-t pt-4">
              <Button type="submit" disabled={profileLoading}>
                {profileLoading ? 'Saving…' : 'Save changes'}
              </Button>
            </CardFooter>}
          </form>
        </Card>

        <Card>
          <form onSubmit={handleChangePassword}>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>You&apos;ll stay signed in on this device.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {!canUpdate && <p className="text-sm text-muted-foreground">Contact an administrator to update your password.</p>}
              {passwordSuccess && (
                <p role="status" className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
                  {passwordSuccess}
                </p>
              )}
              {passwordError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {passwordError}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="current-pwd">Current password</Label>
                <Input
                  id="current-pwd"
                  disabled={!canUpdate || passwordLoading}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-pwd">New password</Label>
                <Input
                  id="new-pwd"
                  disabled={!canUpdate || passwordLoading}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-describedby="new-pwd-hint"
                />
                <p id="new-pwd-hint" className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-pwd">Confirm new password</Label>
                <Input id="confirm-pwd" type="password" autoComplete="new-password" required disabled={!canUpdate || passwordLoading} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
            </CardContent>

            {canUpdate && <CardFooter className="justify-end border-t pt-4">
              <Button type="submit" disabled={passwordLoading}>
                {passwordLoading ? 'Updating…' : 'Update password'}
              </Button>
            </CardFooter>}
          </form>
        </Card>
        <Card>
          <CardHeader><CardTitle>Preferences</CardTitle><CardDescription>Choose the appearance for this browser.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="profile-theme">Appearance</Label>
            <select id="profile-theme" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={theme ?? 'system'} onChange={(event) => setTheme(event.target.value)}>
              <option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sessions</CardTitle><CardDescription>Your current signed-in session.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {session ? <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Signed in</dt><dd><time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString()}</time></dd></div>
              <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Expires</dt><dd><time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString()}</time></dd></div>
            </dl> : <p className="text-sm text-muted-foreground">Session details are unavailable.</p>}
            <Button variant="outline" onClick={logout}>Sign out of this session</Button>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Account details</summary><dl className="mt-2 space-y-2"><dt>Status</dt><dd>{user.status.toLowerCase()}</dd><dt>Account ID</dt><dd className="break-all font-mono text-xs">{user.id}</dd></dl></details>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Account access</summary>
              {isRoot ? <p className="mt-2 text-muted-foreground">Administrator access to all actions.</p> : effectivePermissions.length ? <ul className="mt-2 flex flex-wrap gap-2">{effectivePermissions.map((permission) => <li key={permission} className="rounded border px-2 py-1 font-mono text-xs">{permission}</li>)}</ul> : <p className="mt-2 text-muted-foreground">No permissions assigned. Contact an administrator if you need access.</p>}
            </details>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

'use client';

import React, { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/app-shell/page-header';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

export default function ProfilePage() {
  const { user, refreshSession } = useAuth();

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
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  // Auth is guaranteed by the (app) layout; this screen renders content only.
  if (!user) return null;

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setProfileLoading(true);

    try {
      await api.profile.update({ name, email });
      await refreshSession();
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
      <PageHeader title="Profile" description="Update your name and password." />

      <div className="space-y-6">
        <Card>
          <form onSubmit={handleUpdateProfile}>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>
                Requires the <code className="font-mono text-xs">profile:update:self</code>{' '}
                permission.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {profileSuccess && (
                <p className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </CardContent>

            <CardFooter className="justify-end border-t pt-6">
              <Button type="submit" disabled={profileLoading}>
                {profileLoading ? 'Saving…' : 'Save'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <form onSubmit={handleChangePassword}>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>You&apos;ll stay signed in on this device.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {passwordSuccess && (
                <p className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-success">
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
            </CardContent>

            <CardFooter className="justify-end border-t pt-6">
              <Button type="submit" disabled={passwordLoading}>
                {passwordLoading ? 'Updating…' : 'Update password'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}

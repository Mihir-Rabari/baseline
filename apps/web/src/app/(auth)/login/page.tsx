'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, redirect to dashboard
  React.useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login({ email, password });
      toast.success('Signed in');
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Login failed. Please check your credentials.');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const prefillRoot = () => {
    setEmail('root@example.com');
    setPassword('RootSecurePass123!');
    setError(null);
    toast.info('Root credentials filled in');
  };

  return (
    <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Welcome back.</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col items-stretch gap-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                No account?{' '}
                <Link href="/signup" className="text-foreground underline underline-offset-4">
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>

        {/* Seeded root credentials. Development only — never rendered in a
            production build, so the defaults can't leak from a deployed app. */}
        {process.env.NODE_ENV !== 'production' && (
          <div className="space-y-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>Dev only</span>
              <Button type="button" variant="ghost" size="sm" onClick={prefillRoot}>
                Use root account
              </Button>
            </div>
            <p>
              Matches the root credentials in <code className="font-mono">.env</code>. If you changed
              them there, enter them by hand.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

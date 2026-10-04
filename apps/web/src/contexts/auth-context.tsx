'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import type { AuthUser, AuthSessionInfo, LoginRequest, SignupRequest } from '@packages/validation';

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSessionInfo | null;
  effectivePermissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  isRoot: boolean;
  hasPermission: (permission: string) => boolean;
  login: (data: LoginRequest) => Promise<void>;
  signup: (data: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: (options?: { background?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSessionInfo | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Every auth request takes a ticket. Only the newest request may write state, and nothing writes
  // after unmount, so a slow session lookup (or a Fast Refresh remount in development) cannot land
  // on a discarded provider or overwrite the result of a later login or logout.
  const latestRequest = useRef(0);
  const mounted = useRef(false);
  const takeTicket = () => ++latestRequest.current;
  const isCurrent = (ticket: number) => mounted.current && ticket === latestRequest.current;

  const refreshSession = useCallback(async (options?: { background?: boolean }) => {
    const ticket = ++latestRequest.current;
    try {
      if (!options?.background) setIsLoading(true);
      const res = await api.auth.getSession();
      if (!mounted.current || ticket !== latestRequest.current) return;
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } catch {
      if (!mounted.current || ticket !== latestRequest.current) return;
      // Unauthenticated
      setUser(null);
      setSession(null);
      setEffectivePermissions([]);
    } finally {
      if (mounted.current && ticket === latestRequest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshSession();
    // Any request answered 401 means the cookie no longer maps to a session: re-check once, quietly.
    // If the session really is gone, refreshSession clears the user and the (app) layout sends them to login.
    const onExpired = () => { refreshSession({ background: true }).catch(() => undefined); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      mounted.current = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [refreshSession]);

  const login = async (data: LoginRequest) => {
    const ticket = takeTicket();
    setIsLoading(true);
    try {
      const res = await api.auth.login(data);
      if (!isCurrent(ticket)) return;
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } finally {
      if (isCurrent(ticket)) setIsLoading(false);
    }
  };

  const signup = async (data: SignupRequest) => {
    const ticket = takeTicket();
    setIsLoading(true);
    try {
      const res = await api.auth.signup(data);
      if (!isCurrent(ticket)) return;
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } finally {
      if (isCurrent(ticket)) setIsLoading(false);
    }
  };

  const logout = async () => {
    const ticket = takeTicket();
    setIsLoading(true);
    try {
      await api.auth.logout();
    } catch {
      // Continue clearing client state even if logout request fails
    } finally {
      if (mounted.current) {
        // Logout always wins over an older in-flight request, but not over a newer login.
        if (ticket === latestRequest.current) {
          setUser(null);
          setSession(null);
          setEffectivePermissions([]);
          setIsLoading(false);
        }
      }
    }
  };

  const isRoot = user?.identityType === 'ROOT';

  const hasPermission = (permission: string): boolean => {
    if (isRoot) return true;
    if (effectivePermissions.includes(permission)) return true;

    // Check wildcard match (e.g. "users:*" matches "users:read")
    const [ns] = permission.split(':');
    if (effectivePermissions.includes(`${ns}:*`) || effectivePermissions.includes('*')) {
      return true;
    }

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        effectivePermissions,
        isAuthenticated: !!user,
        isLoading,
        isRoot,
        hasPermission,
        login,
        signup,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

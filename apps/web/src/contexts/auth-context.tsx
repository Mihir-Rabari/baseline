'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
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
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSessionInfo | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.auth.getSession();
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } catch {
      // Unauthenticated
      setUser(null);
      setSession(null);
      setEffectivePermissions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (data: LoginRequest) => {
    setIsLoading(true);
    try {
      const res = await api.auth.login(data);
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (data: SignupRequest) => {
    setIsLoading(true);
    try {
      const res = await api.auth.signup(data);
      setUser(res.user);
      setSession(res.session);
      setEffectivePermissions(res.effectivePermissions);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await api.auth.logout();
    } catch {
      // Continue clearing client state even if logout request fails
    } finally {
      setUser(null);
      setSession(null);
      setEffectivePermissions([]);
      setIsLoading(false);
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

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type IdentityType = 'ROOT' | 'EXTERNAL_USER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  identityType: IdentityType;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionValidationResult {
  valid: boolean;
  user?: AuthUser;
  session?: AuthSession;
  error?: string;
  code?: string;
}

/**
 * Authentication and Session Configuration
 *
 * Developers can modify these settings to customize registration, session durations,
 * and security rules without modifying internal auth logic.
 */
export const AuthConfig = {
  /**
   * Whether public registration (/signup) is enabled.
   * If false, users can only be created by administrators or through invitation.
   */
  registrationEnabled: true,

  /**
   * Default identity type assigned to new self-registered users.
   */
  defaultIdentity: 'EXTERNAL_USER' as const,

  /**
   * Active session lifetime in seconds (default: 7 days).
   */
  sessionTtlSeconds: 7 * 24 * 60 * 60,

  /**
   * Name of the HTTP-only cookie used to transmit session tokens.
   */
  cookieName: 'app_session',

  /**
   * Minimum password length requirement for new accounts and password updates.
   */
  minPasswordLength: 8,

  /**
   * Maximum failed login attempts for a single email before the account is locked out.
   * Enforced by LoginThrottle on POST /api/v1/auth/login.
   */
  maxLoginAttempts: 5,

  /**
   * How long a lockout lasts once `maxLoginAttempts` is reached, in seconds.
   */
  lockoutSeconds: 15 * 60,

  /**
   * Rolling window over which failed login attempts accumulate, in seconds.
   * Attempts older than this expire and no longer count toward a lockout.
   */
  loginAttemptWindowSeconds: 15 * 60,
} as const;

export type AuthConfigType = typeof AuthConfig;

# Authentication & Sessions (`packages/auth`) — Subtree Operating Manual

> **Scope**: Password cryptography (`scrypt`), timing-safe verification, server-side session management (`SessionManager`), SHA-256 token hashing, and cookie helpers.

---

## 1. Subtree Architecture & Conventions

1. **Password Security**:
   - Always hash passwords with `hashPassword(password)` (scrypt with 16-byte random salt).
   - Always verify passwords with `verifyPassword(password, hash)` using `crypto.timingSafeEqual`.
   - Never log or return `passwordHash` in user models or responses.

2. **Session Lifecycle**:
   - 32-byte cryptographic random token generated with `crypto.randomBytes(32)`.
   - Token is hashed with SHA-256 before insertion into the `sessions` table (`tokenHash`).
   - Active sessions are cached in Redis (`session:<tokenHash>`).
   - Account suspension or disabling must revoke all active sessions immediately (`revokeAllUserSessions`).

3. **Cookie Configuration**:
   - Always use `getSessionCookieOptions` enforcing `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, and `secure: true` in production.

4. **Testing Expectations**:
   - Unit tests for password hashing, mismatch rejection, session token hashing, expiration, and cookie options.

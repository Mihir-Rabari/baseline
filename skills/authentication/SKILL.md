---
name: authentication
description: Password hashing (scrypt), server-side session tokens, HTTP-only cookies, and auth events.
---

# Authentication Skill

## 1. When to Use
Use this skill when implementing or modifying password verification, session lifecycles, user authentication cookies, external user registration, or authentication operational event logging.

## 2. Core Invariants
- **Password Hashing**: Always use `hashPassword(password)` from `@packages/auth` (scrypt with 16-byte random salt).
- **Password Verification**: Always use `verifyPassword(password, hash)` with timing-safe comparison (`crypto.timingSafeEqual`).
- **Zero Leakage**: Never store or log plaintext passwords. Never return `passwordHash` in API responses or serialization models.
- **Server Sessions**: 32-byte cryptographic random token stored in PostgreSQL as a SHA-256 `tokenHash` and cached in Redis.
- **Cookies**: Transmitted over secure HTTP-only cookies (`app_session`) with `SameSite=Lax`, `Path=/`, and `Secure` in production.
- **Account Invalidation**: `SUSPENDED` / `DISABLED` accounts are rejected at login and during session validation. All active sessions are revoked upon status change.

## 3. Operational Event Logging
Log structured auth events without credentials:
- `auth.signup.success` (with `userId`, `identityType`)
- `auth.signup.failure` (with reason code, never passwords)
- `auth.login.success` (with `userId`, `identityType`)
- `auth.login.failure` (with reason code, never passwords)
- `auth.logout` (with `userId`)
- `auth.session.revoked` (with `userId`, `reason`)

## 4. Mandatory Testing Expectations
Every authentication change requires:
1. **Happy Path**: Successful signup, login, session validation, logout.
2. **Input Validation**: Rejection of weak passwords, malformed emails, empty inputs.
3. **Security Invariants**: Verification that `passwordHash` is never exposed in user responses or session payloads.
4. **Session Invalidation**: Testing that suspended or disabled accounts have active sessions rejected.
5. **Cookie Security**: Testing that cookies have `httpOnly: true` and `secure: true` in production mode.

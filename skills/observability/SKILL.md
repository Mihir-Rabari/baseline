---
name: observability
description: Structured logging, request correlation, Prometheus metrics, health probes, and sensitive data redaction.
---

# Observability Skill

## 1. When to Use
Use this skill when configuring logging, request correlation, Prometheus metrics, health probes, or structured diagnostics.

## 2. Structured Logging
- **Universal Canonical Logger**: Always use `logger` or `createLogger` from `@packages/shared`.
- **No `console.log`**: Never use `console.log`, `console.error`, or `console.warn` in backend application code.
- **Environment Formatting**: Pretty-formatted human-readable logs in development (`pino-pretty`); structured newline-delimited JSON in production.

## 3. Request Correlation
- Every HTTP request receives an `x-request-id` header.
- Safe header sanitization: Incoming `x-request-id` headers are validated against `^[a-zA-Z0-9_-]{1,64}$` to prevent log injection.
- Correlated Errors: Client error responses include `requestId` matching server diagnostic logs.

## 4. Inviolable Redaction Rules
The logger automatically redacts sensitive fields on top-level and nested objects:
- `*.password`, `*.passwordHash`
- `*.token`, `*.sessionToken`, `*.tokenHash`
- `*.secret`, `*.sessionSecret`
- `*.accessKey`, `*.secretKey`, `*.apiKey`
- `*.authorization`, `req.headers.authorization`
- `*.cookie`, `req.headers.cookie`, `res.headers['set-cookie']`
- `*.databaseUrl`, `*.DATABASE_URL`, `*.SESSION_SECRET`, `*.RESEND_API_KEY`

## 5. Metrics & Probes
- **`/health`**: Fast summary probe.
- **`/health/live`**: Liveness probe.
- **`/health/ready`**: Deep readiness probe verifying PostgreSQL, Redis, and Object Storage connections.
- **`/metrics`**: Prometheus scrape endpoint. Never use high-cardinality request IDs or user IDs as Prometheus labels.

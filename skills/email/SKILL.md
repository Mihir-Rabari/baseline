---
name: email
description: Transactional email provider integration, templates, and delivery rules.
---

# Email Skill

## 1. When to Use
Use this skill when implementing email notifications, password resets, verification emails, or integrating email providers (e.g. Resend).

## 2. Configuration & Features
- Configured in `packages/config/src/feature-config.ts` (`enableEmail`).
- Provider credentials in `.env` (`RESEND_API_KEY`, `RESEND_FROM`).
- Lazy initialization: If email is disabled in configuration, provider connections are not opened at startup.

## 3. Invariants
- Always sanitize recipient addresses using email validation schemas (`EmailSchema`).
- Do not block critical HTTP requests waiting for email delivery; handle async or gracefully log errors.
- Never include raw authorization tokens or passwords in email content without expiration.

## 4. Mandatory Testing Expectations
- Test recipient address validation and sanitization.
- Verify fallback behavior when email configuration is disabled.
- Never call live external email sending APIs during automated test runs.

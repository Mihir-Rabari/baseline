---
name: validation
description: Runtime Zod validation schemas, business bounds, date ordering, and pagination limits.
---

# Validation Skill

## 1. When to Use
Use this skill when defining Zod runtime schemas, validating API inputs, enforcing numeric bounds, enforcing date constraints, or parsing query parameters.

## 2. Business Constraint Rules
- **Identifiers**: Validate UUID format using `z.string().uuid()` (`UuidSchema`).
- **Emails**: Validate and normalize lowercase: `z.string().trim().email().toLowerCase()`.
- **Strings**: Reject empty or whitespace-only strings with `z.string().trim().min(1)`.
- **Passwords**: Enforce minimum length of 8 characters (`minPasswordLength`).
- **Dates**:
  - Birth dates cannot be in the future.
  - End dates must be greater than or equal to start dates.
  - Expiration dates must follow creation dates.
- **Pagination**:
  - Always enforce bounded limits (default: 20, max: 100).
  - Page numbers must be positive integers (`z.coerce.number().int().positive()`).
- **File Uploads**: Enforce strict file size limits and MIME type allowlists before storage processing.

## 3. Mandatory Testing Expectations
Every validation schema must include tests for:
- Minimum and maximum boundary values.
- Empty, null, and missing required fields.
- Malformed inputs (invalid UUID strings, non-email formats).
- Logical business violations (e.g. end date preceding start date).

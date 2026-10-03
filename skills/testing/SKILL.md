---
name: testing
description: Testing doctrine, pyramid (unit, integration, API, security, smoke), AAA pattern, and coverage enforcement.
---

# Testing Skill

## 1. When to Use
Use this skill when writing unit tests, API integration tests, security adversarial suites, database constraint tests, or executing quality verification gates.

## 2. Core Testing Principle
> **Behavior must be verified at the narrowest appropriate level, and security-sensitive behavior must also be verified at an integration boundary.**

## 3. Testing Pyramid & Taxonomy
- **`unit`**: Fast, isolated tests for pure functions, cryptographic utilities, Zod validation schemas, policy evaluation logic.
- **`integration`**: Tests for component interactions using Fastify `app.inject()` and database clients.
- **`security` / `adversarial`**: Explicit negative tests demonstrating that unauthorized access, privilege escalation, and parameter tampering are blocked.
- **`generator` / `smoke`**: Verifying project scaffolding, metadata transformations, and distributable `.tgz` tarball unpacking.

## 4. The Arrange / Act / Assert (AAA) Pattern
Every test must be independently understandable and follow the AAA pattern:
```typescript
it('rejects login for suspended users with 403 Forbidden', async () => {
  // Arrange
  const suspendedUser = await createTestUser({ status: 'SUSPENDED' });
  const credentials = { email: suspendedUser.email, password: 'ValidPassword123!' };

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: credentials,
  });

  // Assert
  expect(response.statusCode).toBe(403);
  const json = response.json();
  expect(json.code).toBe('ACCOUNT_SUSPENDED');
  expect(json.requestId).toBeDefined();
});
```

## 5. Inviolable Testing Laws
1. **Rule T1**: Every new behavior requires automated tests.
2. **Rule T2**: Every bug fix requires a regression test.
3. **Rule T3**: Security-sensitive changes require adversarial negative tests.
4. **Rule T4**: API changes require route & contract tests.
5. **Rule T5**: Database schema changes require migration & seed idempotency tests.
6. **Rule T6**: Generator changes require smoke coverage.
7. **Rule T7**: Never reduce coverage thresholds or delete tests to make a build pass.
8. **Rule T8**: Always run the full verification gate (`pnpm verify`) before declaring work complete.

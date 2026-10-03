import { describe, it, expect } from 'vitest';
import {
  PolicyStatementSchema,
  CreatePolicySchema,
  SUPPORTED_CONDITION_OPERATORS,
} from './iam.js';

describe('IAM Policy Schemas (@packages/validation)', () => {
  describe('SUPPORTED_CONDITION_OPERATORS', () => {
    it('is the canonical four-operator set the policy engine understands', () => {
      expect(SUPPORTED_CONDITION_OPERATORS).toEqual([
        'StringEquals',
        'StringNotEquals',
        'Bool',
        'OwnerEquals',
      ]);
    });
  });

  describe('PolicyStatementSchema conditions', () => {
    it('accepts statements with no conditions', () => {
      const result = PolicyStatementSchema.safeParse({
        effect: 'allow',
        actions: ['users:read'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts each supported condition operator', () => {
      for (const operator of SUPPORTED_CONDITION_OPERATORS) {
        const result = PolicyStatementSchema.safeParse({
          effect: 'allow',
          actions: ['users:read'],
          conditions: { [operator]: { someKey: 'someValue' } },
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts a null conditions value (as read back from a nullable jsonb column)', () => {
      const result = PolicyStatementSchema.safeParse({
        effect: 'allow',
        actions: ['users:read'],
        conditions: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unsupported condition operator and names it plus the supported set', () => {
      const result = PolicyStatementSchema.safeParse({
        effect: 'allow',
        actions: ['users:read'],
        conditions: { IpAddressInRange: { sourceIp: '10.0.0.0/8' } },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' | ');
        expect(messages).toContain('IpAddressInRange');
        for (const operator of SUPPORTED_CONDITION_OPERATORS) {
          expect(messages).toContain(operator);
        }
      }
    });

    it('rejects when a policy mixes a supported and an unsupported operator', () => {
      const result = PolicyStatementSchema.safeParse({
        effect: 'allow',
        actions: ['users:read'],
        conditions: {
          StringEquals: { department: 'finance' },
          DateGreaterThan: { expiresAt: '2026-01-01' },
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' | ');
        expect(messages).toContain('DateGreaterThan');
      }
    });

    it('rejects an unsupported operator through CreatePolicySchema at the top level', () => {
      const result = CreatePolicySchema.safeParse({
        name: 'BadPolicy',
        statements: [
          {
            effect: 'allow',
            actions: ['users:read'],
            conditions: { IpAddressInRange: { sourceIp: '10.0.0.0/8' } },
          },
        ],
      });

      expect(result.success).toBe(false);
    });
  });
});

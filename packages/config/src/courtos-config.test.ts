import { describe, it, expect } from 'vitest';
import { AppConfig } from './app-config.js';
import { IamConfig } from './iam-config.js';
import { envSchema } from './env.js';

describe('CLUB_TIMEZONE', () => {
  it('defaults to Asia/Kolkata', () => {
    expect(envSchema.parse({}).CLUB_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('accepts any valid IANA timezone', () => {
    expect(envSchema.parse({ CLUB_TIMEZONE: 'Europe/London' }).CLUB_TIMEZONE).toBe('Europe/London');
  });

  it('rejects an invalid timezone name', () => {
    expect(() => envSchema.parse({ CLUB_TIMEZONE: 'Not/AZone' })).toThrow(/CLUB_TIMEZONE/);
  });
});

describe('CourtOS IAM config', () => {
  it('registers MEMBER as the default role for public signups', () => {
    expect(IamConfig.registration.defaultRole).toBe('MEMBER');
    expect(AppConfig.iam.defaultRole).toBe('MEMBER');
  });

  it('declares the four CourtOS roles, each backed by a declared policy', () => {
    const expected: Record<string, string> = {
      MEMBER: 'MemberPolicy',
      FRONT_DESK: 'FrontDeskPolicy',
      BAR_STAFF: 'BarStaffPolicy',
      OWNER: 'OwnerPolicy',
    };
    for (const [role, policy] of Object.entries(expected)) {
      expect(IamConfig.roles[role]?.policies).toEqual([policy]);
      expect(IamConfig.policies[policy]).toBeDefined();
    }
  });

  it('never uses namespace wildcards in domain policies (they would also match :self and override actions)', () => {
    for (const name of ['MemberPolicy', 'FrontDeskPolicy', 'BarStaffPolicy', 'OwnerPolicy']) {
      for (const statement of IamConfig.policies[name].statements) {
        expect(statement.actions.some((a) => a.includes('*'))).toBe(false);
      }
    }
  });
});

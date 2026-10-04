import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../../../../apps/web/src/lib/password-links';

describe('passwordProblem', () => {
  it('requires 8 characters and a matching confirmation', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 8/);
    expect(passwordProblem('long-enough-1', 'different-1')).toMatch(/do not match/);
    expect(passwordProblem('long-enough-1', 'long-enough-1')).toBeNull();
  });
});

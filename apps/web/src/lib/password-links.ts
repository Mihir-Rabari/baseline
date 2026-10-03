import { ops } from '@/lib/ops';

export const passwordLinks = {
  check: (token: string) => ops.get<{ valid: boolean }>(`/auth/password/check?token=${encodeURIComponent(token)}`),
  set: (token: string, password: string) => ops.post<{ success: boolean; message: string }>('/auth/password/setup', { token, password }),
  forgot: (email: string) => ops.post<{ success: boolean; message: string }>('/auth/password/forgot', { email }),
};

export const MIN_PASSWORD_LENGTH = 8;

/** The first thing wrong with a new password, or null when it is acceptable. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

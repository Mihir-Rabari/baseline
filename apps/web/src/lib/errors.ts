/**
 * Extracts a displayable message from a caught value.
 *
 * `catch` binds `unknown`, not `Error` — a rejected fetch, a thrown string, or a
 * rejected promise carrying a plain object all land here. Typing the binding as `any`
 * to reach `.message` compiles but crashes at runtime the moment something that is not
 * an Error is thrown.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return fallback;
}

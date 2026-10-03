/**
 * Errors raised by IAM guard rails.
 *
 * Each carries `statusCode` and `code`, which the API's error handler reads directly,
 * so services can enforce invariants without knowing anything about HTTP.
 */
export class IamError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode = 403, code = 'FORBIDDEN') {
    super(message);
    this.name = 'IamError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Raised when a caller tries to modify or delete a seeded, system-owned record.
 *
 * System roles, groups and policies are the baseline the seed script installs. Deleting
 * the default external-user policy, for example, silently breaks every future signup,
 * so these records are immutable through the API.
 */
export class SystemRecordProtectedError extends IamError {
  constructor(kind: string, name?: string) {
    super(
      `The system ${kind}${name ? ` "${name}"` : ''} is managed by the platform and cannot be modified or deleted.`,
      409,
      'SYSTEM_RECORD_PROTECTED'
    );
    this.name = 'SystemRecordProtectedError';
  }
}

/**
 * Raised when a caller tries to grant permissions they do not themselves hold.
 *
 * Without this, anyone holding `policies:update` could attach an `allow *` policy to
 * their own account and become ROOT-equivalent.
 */
export class PrivilegeEscalationError extends IamError {
  constructor(actions: string[]) {
    super(
      `You cannot grant permissions you do not hold yourself: ${actions.join(', ')}`,
      403,
      'PRIVILEGE_ESCALATION_BLOCKED'
    );
    this.name = 'PrivilegeEscalationError';
  }
}

/**
 * Raised when an operation would compromise the ROOT identity or lock the actor out.
 */
export class RootProtectedError extends IamError {
  constructor(message = 'The ROOT identity cannot be modified through this endpoint.') {
    super(message, 403, 'ROOT_PROTECTED');
    this.name = 'RootProtectedError';
  }
}

export class AuthenticationError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode = 401, code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(message = 'Invalid email or password') {
    super(message, 401, 'INVALID_CREDENTIALS');
    this.name = 'InvalidCredentialsError';
  }
}

export class SessionExpiredError extends AuthenticationError {
  constructor(message = 'Session has expired') {
    super(message, 401, 'SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

export class AccountSuspendedError extends AuthenticationError {
  constructor(message = 'Account has been temporarily suspended') {
    super(message, 403, 'ACCOUNT_SUSPENDED');
    this.name = 'AccountSuspendedError';
  }
}

export class AccountDisabledError extends AuthenticationError {
  constructor(message = 'Account has been disabled') {
    super(message, 403, 'ACCOUNT_DISABLED');
    this.name = 'AccountDisabledError';
  }
}

export class UserAlreadyExistsError extends AuthenticationError {
  constructor(message = 'A user with this email already exists') {
    super(message, 409, 'USER_ALREADY_EXISTS');
    this.name = 'UserAlreadyExistsError';
  }
}

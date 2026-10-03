import type { ErrorDetail } from '@packages/validation';

/**
 * A business-rule failure that carries its own machine-readable `code` (see the domain code
 * table in docs/hackathon/API_CONTRACT.md section 0.2) and HTTP status.
 *
 * Services throw this; the global error handler converts it into the standard
 * `HttpErrorResponse` body with `requestId` and `timestamp`.
 */
export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: ErrorDetail[];

  constructor(code: string, statusCode: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

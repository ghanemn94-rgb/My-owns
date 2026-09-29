/**
 * Domain errors carry a stable machine code. The API maps kinds to HTTP status:
 *   rule_violation → 422, conflict → 409, not_found → 404, forbidden → 403, invalid → 400.
 */
export type DomainErrorKind = 'rule_violation' | 'conflict' | 'not_found' | 'forbidden' | 'invalid';

export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(kind: DomainErrorKind, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export const ruleViolation = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError('rule_violation', code, message, details);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError('conflict', code, message, details);
export const notFound = (code = 'not_found', message = 'Resource not found') => new DomainError('not_found', code, message);
export const forbidden = (code = 'forbidden', message = 'Not permitted') => new DomainError('forbidden', code, message);
export const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError('invalid', code, message, details);

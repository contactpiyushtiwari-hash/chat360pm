export type DomainErrorCode =
  | 'validation_failed'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'
  | 'precondition_failed';

/** An expected business-rule failure. Maps to a 4xx response; never logged as a crash. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new DomainError('forbidden', message);
export const notFound = (what: string) => new DomainError('not_found', `${what} was not found.`);
export const invalid = (message: string, details?: Record<string, unknown>) =>
  new DomainError('validation_failed', message, details);
export const invalidTransition = (message: string) =>
  new DomainError('invalid_transition', message);

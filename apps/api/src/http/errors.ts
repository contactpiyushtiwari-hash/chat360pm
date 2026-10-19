import { DomainError } from '@chat360/core';
import { ZodError } from 'zod';
import { PreconditionFailedError } from '../ports';

/** Error from Microsoft Graph, with the HTTP status and Graph error code preserved. */
export class GraphError extends Error {
  override name = 'GraphError';
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export class AuthError extends Error {
  override name = 'AuthError';
  constructor(
    public readonly code:
      | 'unauthenticated'
      | 'reauth_required'
      | 'not_authorized'
      | 'account_inactive'
      | 'consent_required',
    message: string,
  ) {
    super(message);
  }
}

export class RateLimitedError extends Error {
  override name = 'RateLimitedError';
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    errorId?: string;
  };
}

/** Maps any thrown value to an HTTP status and a safe body. Unknown errors never leak internals. */
export function toErrorResponse(
  err: unknown,
  requestId: string,
): { status: number; body: ErrorBody; log: 'none' | 'warn' | 'error' } {
  const body = (
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    errorId?: string,
  ) => ({
    status,
    body: {
      error: {
        code,
        message,
        requestId,
        ...(details ? { details } : {}),
        ...(errorId ? { errorId } : {}),
      },
    },
  });
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return {
      ...body(422, 'validation_failed', 'Some fields are invalid.', { fields }),
      log: 'none',
    };
  }
  if (err instanceof DomainError) {
    const status = {
      validation_failed: 422,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      invalid_transition: 409,
      precondition_failed: 412,
    }[err.code];
    return { ...body(status, err.code, err.message, err.details), log: 'none' };
  }
  if (err instanceof AuthError) {
    const status = err.code === 'unauthenticated' ? 401 : 403;
    return {
      ...body(status, err.code, err.message),
      log: err.code === 'not_authorized' ? 'warn' : 'none',
    };
  }
  if (err instanceof RateLimitedError)
    return { ...body(429, 'rate_limited', err.message), log: 'warn' };
  if (err instanceof PreconditionFailedError) {
    return {
      ...body(
        409,
        'concurrent_update',
        'Someone else changed this at the same time. Please retry.',
      ),
      log: 'warn',
    };
  }
  const errorId = `ERR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  if (err instanceof GraphError) {
    if (err.status === 401 || err.status === 403) {
      return {
        ...body(
          502,
          'graph_permission_denied',
          'Microsoft 365 denied this operation. Check that the required permissions are granted.',
          { graphCode: err.code },
          errorId,
        ),
        log: 'error',
      };
    }
    if (err.status === 404) {
      return {
        ...body(
          502,
          'graph_not_found',
          'The OneDrive file or folder was not found.',
          { graphCode: err.code },
          errorId,
        ),
        log: 'error',
      };
    }
    if (err.status === 429) {
      return {
        ...body(
          503,
          'graph_throttled',
          'Microsoft 365 is throttling requests. Please retry shortly.',
          undefined,
          errorId,
        ),
        log: 'warn',
      };
    }
    return {
      ...body(
        502,
        'graph_error',
        'Microsoft 365 returned an error. Please retry.',
        { graphCode: err.code },
        errorId,
      ),
      log: 'error',
    };
  }
  return {
    ...body(
      500,
      'internal_error',
      'Something went wrong. Quote the error ID if you contact support.',
      undefined,
      errorId,
    ),
    log: 'error',
  };
}

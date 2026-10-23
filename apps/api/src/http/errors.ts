import { DomainError } from '@chat360/core';
import { ZodError } from 'zod';
import { PreconditionFailedError } from '../ports';

export class AuthError extends Error {
  override name = 'AuthError';
  constructor(
    public readonly code:
      | 'unauthenticated'
      | 'reauth_required'
      | 'not_authorized'
      | 'account_inactive'
      | 'invalid_credentials'
      | 'link_invalid',
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
    const status =
      err.code === 'unauthenticated' || err.code === 'invalid_credentials'
        ? 401
        : err.code === 'link_invalid'
          ? 400
          : 403;
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

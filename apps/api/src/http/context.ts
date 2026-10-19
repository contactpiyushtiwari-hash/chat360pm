import { invalid, type DirectoryUser } from '@chat360/core';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { Deps } from '../deps';
import type { Logger, SessionRecord } from '../ports';
import { AuthError, RateLimitedError } from './errors';

export type AppEnv = {
  Variables: {
    deps: Deps;
    requestId: string;
    log: Logger;
    session: SessionRecord | null;
    sessionToken: string | null;
    user: DirectoryUser | null;
    background: (p: Promise<unknown>) => void;
  };
};

export type AppContext = Context<AppEnv>;

export function requireUser(c: AppContext): DirectoryUser {
  const u = c.get('user');
  if (!u) throw new AuthError('unauthenticated', 'Please sign in.');
  return u;
}

export async function body<S extends z.ZodTypeAny>(c: AppContext, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = Symbol('invalid');
    }
  }
  return schema.parse(raw);
}

export async function limit(c: AppContext, key: string, max: number, windowSeconds: number) {
  const ok = await c.get('deps').coord.rateLimit(key, max, windowSeconds);
  if (!ok) throw new RateLimitedError('Too many requests. Please wait a moment and try again.');
}

export function clientIp(c: AppContext) {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'local'
  );
}

/** Idempotency-Key header (required for creates), constrained to a safe charset. */
export function idempotencyKey(c: AppContext, required: boolean): string | null {
  const k = c.req.header('Idempotency-Key');
  if (!k) {
    if (required) throw invalid('Idempotency-Key header is required.');
    return null;
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw invalid('Invalid Idempotency-Key.');
  return k;
}

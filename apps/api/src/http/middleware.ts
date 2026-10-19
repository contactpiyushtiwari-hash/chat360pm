import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { childLogger } from '../observability/log';
import { sha256Hex } from '../auth/crypto';
import type { AppEnv } from './context';
import { toErrorResponse } from './errors';

const SESSION_IDLE_MS = 8 * 3600_000;
const TOUCH_EVERY_MS = 5 * 60_000;

export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps');
  const incoming = c.req.header('X-Request-Id');
  const requestId =
    incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('log', childLogger(deps.log, { requestId, method: c.req.method, path: c.req.path }));
  c.set('session', null);
  c.set('sessionToken', null);
  c.set('user', null);
  c.set('background', (p) => {
    const safe = p.catch((err) =>
      c.get('log').error('background_task_failed', { error: String(err) }),
    );
    try {
      c.executionCtx.waitUntil(safe);
    } catch {
      deps.pending.push(safe);
    }
  });
  const started = Date.now();
  await next();
  c.header('X-Request-Id', requestId);
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  const ms = Date.now() - started;
  if (ms > 3000 || c.res.status >= 500)
    c.get('log').warn('slow_or_failed_request', { status: c.res.status, ms });
};

/**
 * CSRF defence in depth on top of SameSite=Strict cookies: state-changing requests must carry a
 * custom header (forces a CORS preflight that we never approve) and, if present, a same-origin Origin.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const allowed = c.get('deps').config.appOrigin;
    if (c.req.header('X-Requested-With') !== 'chat360' || (origin && origin !== allowed)) {
      return c.json(
        {
          error: {
            code: 'csrf_rejected',
            message: 'Request rejected.',
            requestId: c.get('requestId'),
          },
        },
        403,
      );
    }
  }
  await next();
};

export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps');
  const token = getCookie(c, deps.config.sessionCookieName);
  if (token) {
    const id = await sha256Hex(token);
    const s = await deps.sessions.get(id);
    const now = deps.clock().getTime();
    if (s && now - s.lastSeenAt < SESSION_IDLE_MS) {
      const user = (await deps.repos.directory()).users.find((u) => u.id === s.userId);
      if (user && user.status !== 'deactivated') {
        c.set('session', s);
        c.set('sessionToken', token);
        c.set('user', user);
        if (now - s.lastSeenAt > TOUCH_EVERY_MS) await deps.sessions.touch(id, now);
      } else {
        await deps.sessions.delete(id);
        deleteCookie(c, deps.config.sessionCookieName, { path: '/' });
      }
    } else {
      if (s) await deps.sessions.delete(id);
      deleteCookie(c, deps.config.sessionCookieName, { path: '/' });
    }
  }
  await next();
};

export function errorHandler(err: Error, c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  const requestId = c.get('requestId') ?? 'unknown';
  const r = toErrorResponse(err, requestId);
  const log = c.get('log');
  if (r.log !== 'none' && log) {
    log[r.log]('request_error', {
      status: r.status,
      code: r.body.error.code,
      errorId: r.body.error.errorId,
      error: `${err.name}: ${err.message}`,
      userId: c.get('user')?.id,
    });
  }
  return c.json(r.body, r.status as 400);
}

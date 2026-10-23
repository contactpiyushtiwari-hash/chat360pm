import {
  canAdminister,
  firstAdminSchema,
  loginSchema,
  setPasswordSchema,
  type DirectoryUser,
} from '@chat360/core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  hashPassword,
  randomToken,
  safeEqual,
  sha256Hex,
  verifyPassword,
  type PasswordHash,
} from '../auth/crypto';
import type { Deps } from '../deps';
import { body, clientIp, limit, type AppContext, type AppEnv } from '../http/context';
import { AuthError } from '../http/errors';

const SESSION_TTL_MS = 12 * 3600_000;
const REAUTH_WINDOW_MS = 15 * 60_000;
export const SETUP_LINK_TTL_MS = 7 * 24 * 3600_000;

const INVALID_LOGIN = 'Email or password is incorrect.';
// Verified when the email is unknown so a miss costs the same time as a wrong password.
let dummyHash: Promise<PasswordHash> | null = null;

export async function startSession(c: AppContext, user: DirectoryUser) {
  const deps = c.get('deps');
  const raw = randomToken(32);
  const now = deps.clock().getTime();
  await deps.sessions.create({
    id: await sha256Hex(raw),
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    authTime: now,
  });
  setCookie(c, deps.config.sessionCookieName, raw, {
    httpOnly: true,
    secure: deps.config.secureCookies,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Rejects actions that need a recent sign-in (e.g. account deactivation). */
export function requireRecentAuth(c: AppContext) {
  const s = c.get('session');
  if (!s || c.get('deps').clock().getTime() - s.authTime > REAUTH_WINDOW_MS) {
    throw new AuthError('reauth_required', 'For your security, please sign in again to continue.');
  }
}

/** Issues a one-time set-password link. The token travels in the URL fragment, not to the server log. */
export async function issueSetupLink(deps: Deps, userId: string) {
  const token = randomToken(32);
  const key = await sha256Hex(token);
  const now = deps.clock().getTime();
  await deps.repos.updateCredentials((cr) => {
    for (const [k, v] of Object.entries(cr.setupLinks)) {
      if (v.userId === userId || v.expiresAt < now) delete cr.setupLinks[k];
    }
    cr.setupLinks[key] = { userId, expiresAt: now + SETUP_LINK_TTL_MS };
  });
  return {
    url: `${deps.config.appOrigin}/set-password#token=${token}`,
    expiresAt: new Date(now + SETUP_LINK_TTL_MS).toISOString(),
  };
}

async function setupRequired(deps: Deps) {
  const [d, cr] = await Promise.all([deps.repos.directory(), deps.repos.credentials()]);
  return !d.users.some((u) => canAdminister(u) && u.status === 'active' && cr.passwords[u.id]);
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/config', async (c) => {
  const deps = c.get('deps');
  return c.json({
    devAuth: deps.config.devAuth,
    setupAvailable: !!deps.config.setupCode && (await setupRequired(deps)),
    environment: deps.config.environment,
  });
});

authRoutes.post('/login', async (c) => {
  const deps = c.get('deps');
  await limit(c, `login-ip:${clientIp(c)}`, 30, 600);
  const input = await body(c, loginSchema);
  await limit(c, `login-email:${input.email}`, 10, 900);
  const [d, cr] = await Promise.all([deps.repos.directory(), deps.repos.credentials()]);
  const user = d.users.find((u) => u.email.toLowerCase() === input.email);
  const stored = user ? cr.passwords[user.id] : undefined;
  dummyHash ??= hashPassword(randomToken(16));
  const ok = await verifyPassword(input.password, stored ?? (await dummyHash));
  if (!user || !stored || !ok) throw new AuthError('invalid_credentials', INVALID_LOGIN);
  if (user.status === 'deactivated')
    throw new AuthError(
      'account_inactive',
      'Your access to this application has been deactivated.',
    );
  await startSession(c, user);
  deps.analytics.track('login', { role: user.roles[0] ?? 'none' });
  return c.json({ ok: true, onboarded: !!user.onboarding.completedAt });
});

/** First administrator. Needs the SETUP_CODE secret and works only while no admin can sign in. */
authRoutes.post('/setup', async (c) => {
  const deps = c.get('deps');
  await limit(c, `setup:${clientIp(c)}`, 5, 3600);
  const input = await body(c, firstAdminSchema);
  const code = deps.config.setupCode;
  if (!code || !safeEqual(await sha256Hex(input.setupCode), await sha256Hex(code)))
    throw new AuthError('not_authorized', 'The setup code is incorrect.');
  if (!(await setupRequired(deps)))
    throw new AuthError('not_authorized', 'Setup is already complete. Please sign in.');
  const now = deps.clock().toISOString();
  const { result: user } = await deps.repos.updateDirectory((d) => {
    let u = d.users.find((x) => x.email.toLowerCase() === input.email);
    if (!u) {
      u = {
        id: crypto.randomUUID(),
        tenantId: '',
        email: input.email,
        displayName: input.displayName,
        roles: [],
        status: 'active',
        onboarding: { completedSteps: [], skippedSteps: [] },
        identityHistory: [],
        createdAt: now,
        updatedAt: now,
      };
      d.users.push(u);
    }
    if (!u.roles.includes('admin')) u.roles.push('admin');
    u.status = 'active';
    u.updatedAt = now;
    return structuredClone(u);
  });
  const hash = await hashPassword(input.password);
  await deps.repos.updateCredentials((cr) => {
    cr.passwords[user.id] = { ...hash, updatedAt: now };
  });
  await deps.repos.appendAudit({
    at: now,
    actor: user.id,
    action: 'user.bootstrap_admin',
    target: user.id,
  });
  await startSession(c, user);
  return c.json({ ok: true }, 201);
});

/** Completes a set-password link (new account or admin-issued reset). Signs out other sessions. */
authRoutes.post('/set-password', async (c) => {
  const deps = c.get('deps');
  await limit(c, `set-password:${clientIp(c)}`, 20, 3600);
  const input = await body(c, setPasswordSchema);
  const key = await sha256Hex(input.token);
  const nowMs = deps.clock().getTime();
  const hash = await hashPassword(input.password);
  const { result: userId } = await deps.repos.updateCredentials((cr) => {
    const link = cr.setupLinks[key];
    if (!link || link.expiresAt < nowMs) return null;
    delete cr.setupLinks[key];
    cr.passwords[link.userId] = { ...hash, updatedAt: new Date(nowMs).toISOString() };
    return link.userId;
  });
  const user = userId
    ? (await deps.repos.directory()).users.find(
        (u) => u.id === userId && u.status !== 'deactivated',
      )
    : undefined;
  if (!user)
    throw new AuthError(
      'link_invalid',
      'This link has expired or was already used. Ask an administrator for a new one.',
    );
  await deps.sessions.deleteForUser(user.id);
  await deps.repos.appendAudit({
    at: new Date(nowMs).toISOString(),
    actor: user.id,
    action: 'user.password_set',
    target: user.id,
  });
  await startSession(c, user);
  return c.json({ ok: true, onboarded: !!user.onboarding.completedAt });
});

authRoutes.post('/logout', async (c) => {
  const deps = c.get('deps');
  const s = c.get('session');
  if (s) await deps.sessions.delete(s.id);
  deleteCookie(c, deps.config.sessionCookieName, { path: '/' });
  return c.json({ ok: true });
});

/** Development-only sign-in. Not registered at all unless DEV_AUTH=enabled in development. */
export function registerDevAuth(app: Hono<AppEnv>, deps: Deps) {
  if (!deps.config.devAuth || deps.config.environment !== 'development') return;
  app.get('/api/auth/dev-users', async (c) => {
    const d = await deps.repos.directory();
    return c.json({
      users: d.users
        .filter((u) => u.status !== 'deactivated')
        .map((u) => ({ id: u.id, displayName: u.displayName, roles: u.roles })),
    });
  });
  app.post('/api/auth/dev-login', async (c) => {
    const { userId } = await body(c, z.object({ userId: z.string().min(1).max(64) }));
    const user = (await deps.repos.directory()).users.find(
      (u) => u.id === userId && u.status !== 'deactivated',
    );
    if (!user) throw new AuthError('unauthenticated', 'Unknown development user.');
    await startSession(c, user);
    return c.json({ ok: true, isAdmin: canAdminister(user) });
  });
}

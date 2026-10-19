import { canAdminister, type DirectoryUser } from '@chat360/core';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { decryptJson, encryptJson, randomToken, sha256Hex } from '../auth/crypto';
import { TOKEN_PURPOSE } from '../auth/delegated';
import { BASE_SCOPES, OUTLOOK_SCOPES, pkcePair, type TokenSet } from '../auth/oidc';
import type { Deps } from '../deps';
import { body, clientIp, limit, requireUser, type AppContext, type AppEnv } from '../http/context';
import { AuthError } from '../http/errors';
import type { GraphProfile } from '../ports';

const TX_COOKIE = 'c360_oidc';
const TX_PURPOSE = 'oidc-tx-v1';
const SESSION_TTL_MS = 12 * 3600_000;
const REAUTH_WINDOW_MS = 15 * 60_000;

interface OidcTx {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  mode: 'login' | 'consent';
  /** Consent mode: the session to upgrade. The Strict session cookie is not sent on the
   * cross-site callback navigation, so the id travels in this encrypted, Lax cookie instead. */
  sessionId?: string;
  exp: number;
}

/** Only same-origin relative paths; blocks open redirects like `//evil.com` or `/\evil.com`. */
export function safeReturnTo(v: string | undefined): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.includes('\n'))
    return '/';
  return v.slice(0, 500);
}

/**
 * Employee access policy (PRD-AUTH-003). The email domain is a consistency check only; it never
 * grants access or privileges by itself. Guests and disabled accounts are refused.
 */
export function checkEmployeePolicy(profile: GraphProfile, allowedDomains: string[]): string {
  if (profile.userType && profile.userType !== 'Member')
    throw new AuthError(
      'not_authorized',
      'Guest and external accounts cannot use this application.',
    );
  if (profile.userPrincipalName.includes('#EXT#'))
    throw new AuthError(
      'not_authorized',
      'Guest and external accounts cannot use this application.',
    );
  if (profile.accountEnabled === false)
    throw new AuthError('account_inactive', 'This account is disabled.');
  const email = (profile.mail ?? profile.userPrincipalName).toLowerCase();
  const domain = email.split('@')[1] ?? '';
  if (allowedDomains.length && !allowedDomains.includes(domain)) {
    throw new AuthError('not_authorized', 'This account is not a Chat360 employee account.');
  }
  return email;
}

/** Creates or refreshes the directory record keyed by the stable Entra object id. */
export async function upsertDirectoryUser(
  deps: Deps,
  identity: { id: string; tenantId: string; email: string; displayName: string },
): Promise<{ user: DirectoryUser; created: boolean; bootstrapped: boolean }> {
  const now = deps.clock().toISOString();
  const { result } = await deps.repos.updateDirectory((d) => {
    let user = d.users.find((u) => u.id === identity.id);
    let created = false;
    let bootstrapped = false;
    const noActiveAdmin = !d.users.some((u) => u.status === 'active' && u.roles.includes('admin'));
    if (!user) {
      created = true;
      user = {
        ...identity,
        roles: [],
        status: 'active',
        onboarding: { completedSteps: [], skippedSteps: [] },
        identityHistory: [],
        createdAt: now,
        updatedAt: now,
      };
      d.users.push(user);
    } else if (user.email !== identity.email || user.displayName !== identity.displayName) {
      user.identityHistory.push({ at: now, email: user.email, displayName: user.displayName });
      user.email = identity.email;
      user.displayName = identity.displayName;
      user.updatedAt = now;
    }
    // Bootstrap administrators are named by object id in configuration, never by email. They are
    // granted admin on first sign-in, or when no active admin exists (lock-out recovery).
    if (
      deps.config.bootstrapAdminIds.includes(identity.id) &&
      !user.roles.includes('admin') &&
      (created || noActiveAdmin)
    ) {
      user.roles.push('admin');
      bootstrapped = true;
    }
    return { user: structuredClone(user), created, bootstrapped };
  });
  if (result.created || result.bootstrapped) {
    await deps.repos.appendAudit({
      at: now,
      actor: identity.id,
      action: result.bootstrapped ? 'user.bootstrap_admin' : 'user.first_sign_in',
      target: identity.id,
    });
  }
  return result;
}

async function startSession(
  c: AppContext,
  user: DirectoryUser,
  tokens: TokenSet | null,
  authTime: number,
) {
  const deps = c.get('deps');
  const raw = randomToken(32);
  const now = deps.clock().getTime();
  const stored = tokens ? { ...tokens } : null;
  if (stored) delete stored.idToken;
  await deps.sessions.create({
    id: await sha256Hex(raw),
    userId: user.id,
    tenantId: user.tenantId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    authTime,
    tokens: stored ? await encryptJson(deps.config.tokenKey, TOKEN_PURPOSE, stored) : null,
    scopes: tokens?.scope ?? '',
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

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/config', (c) => {
  const deps = c.get('deps');
  return c.json({
    devAuth: deps.config.devAuth,
    entraConfigured: !!deps.oidc,
    environment: deps.config.environment,
  });
});

async function beginAuthorize(c: AppContext, mode: OidcTx['mode']) {
  const deps = c.get('deps');
  await limit(c, `auth:${clientIp(c)}`, 30, 60);
  if (!deps.oidc)
    throw new AuthError(
      'unauthenticated',
      'Microsoft sign-in is not configured for this environment.',
    );
  const { verifier, challenge } = await pkcePair();
  const tx: OidcTx = {
    state: randomToken(24),
    nonce: randomToken(24),
    verifier,
    returnTo: safeReturnTo(c.req.query('returnTo')),
    mode,
    ...(mode === 'consent' ? { sessionId: c.get('session')!.id } : {}),
    exp: deps.clock().getTime() + 10 * 60_000,
  };
  setCookie(c, TX_COOKIE, await encryptJson(deps.config.cookieSecret, TX_PURPOSE, tx), {
    httpOnly: true,
    secure: deps.config.secureCookies,
    // Lax: the callback is a top-level navigation from login.microsoftonline.com.
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: 600,
  });
  const user = c.get('user');
  const url = deps.oidc.authorizeUrl({
    state: tx.state,
    nonce: tx.nonce,
    codeChallenge: challenge,
    scopes: mode === 'consent' ? [...BASE_SCOPES, ...OUTLOOK_SCOPES] : BASE_SCOPES,
    ...(c.req.query('prompt') === 'login' ? { prompt: 'login' } : {}),
    ...(user ? { loginHint: user.email } : {}),
  });
  return c.redirect(url, 302);
}

authRoutes.get('/login', (c) => beginAuthorize(c, 'login'));

authRoutes.get('/consent', (c) => {
  requireUser(c);
  return beginAuthorize(c, 'consent');
});

authRoutes.get('/callback', async (c) => {
  const deps = c.get('deps');
  const fail = (code: string) => c.redirect(`/login?error=${encodeURIComponent(code)}`, 302);
  const txRaw = getCookie(c, TX_COOKIE);
  deleteCookie(c, TX_COOKIE, { path: '/api/auth' });
  const tx = txRaw ? await decryptJson<OidcTx>(deps.config.cookieSecret, TX_PURPOSE, txRaw) : null;
  if (c.req.query('error')) {
    c.get('log').warn('oidc_error_response', { error: c.req.query('error') });
    return fail(c.req.query('error') === 'access_denied' ? 'consent_declined' : 'signin_failed');
  }
  if (!tx || tx.exp < deps.clock().getTime() || tx.state !== c.req.query('state'))
    return fail('signin_expired');
  if (!deps.oidc) return fail('signin_unavailable');
  try {
    const tokens = await deps.oidc.exchangeCode(c.req.query('code') ?? '', tx.verifier);
    const claims = await deps.oidc.verifyIdToken(tokens.idToken ?? '', tx.nonce);
    const profile = await deps.userGraphFor(tokens.accessToken).getProfile();
    if (profile.id !== claims.oid) throw new AuthError('not_authorized', 'Identity mismatch.');
    const email = checkEmployeePolicy(profile, deps.config.allowedEmailDomains);

    if (tx.mode === 'consent') {
      const session = tx.sessionId ? await deps.sessions.get(tx.sessionId) : null;
      if (!session || session.userId !== claims.oid) return fail('signin_mismatch');
      const stored = { ...tokens };
      delete stored.idToken;
      await deps.sessions.setTokens(
        session.id,
        await encryptJson(deps.config.tokenKey, TOKEN_PURPOSE, stored),
        tokens.scope,
      );
      deps.analytics.track('outlook_consent_granted', {});
      return c.redirect(tx.returnTo, 302);
    }

    const { user } = await upsertDirectoryUser(deps, {
      id: claims.oid,
      tenantId: claims.tid,
      email,
      displayName: profile.displayName || claims.name || email,
    });
    if (user.status === 'deactivated')
      throw new AuthError(
        'account_inactive',
        'Your access to this application has been deactivated.',
      );
    await startSession(
      c,
      user,
      tokens,
      (claims.auth_time ?? Math.floor(deps.clock().getTime() / 1000)) * 1000,
    );
    deps.analytics.track('login', { role: user.roles[0] ?? 'none' });
    return c.redirect(user.onboarding.completedAt ? tx.returnTo : '/welcome', 302);
  } catch (err) {
    c.get('log').warn('signin_rejected', {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    if (err instanceof AuthError) return fail(err.code);
    return fail('signin_failed');
  }
});

authRoutes.post('/logout', async (c) => {
  const deps = c.get('deps');
  const s = c.get('session');
  if (s) await deps.sessions.delete(s.id);
  deleteCookie(c, deps.config.sessionCookieName, { path: '/' });
  const logoutUrl = deps.config.entra
    ? `https://login.microsoftonline.com/${deps.config.entra.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(`${deps.config.appOrigin}/login?signedOut=1`)}`
    : null;
  return c.json({ ok: true, logoutUrl });
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
    const now = deps.clock().getTime();
    // Fake delegated tokens: dev adapters record email/calendar actions instead of calling Graph.
    await startSession(
      c,
      user,
      {
        accessToken: 'dev',
        refreshToken: null,
        expiresAt: now + SESSION_TTL_MS,
        scope: [...BASE_SCOPES, ...OUTLOOK_SCOPES].join(' '),
      },
      now,
    );
    return c.json({ ok: true, isAdmin: canAdminister(user) });
  });
}

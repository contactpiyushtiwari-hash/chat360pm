import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createOidcClient } from '../src/auth/oidc';
import { checkEmployeePolicy, safeReturnTo } from '../src/routes/auth';
import { loadConfig } from '../src/env';
import { DEV_KEY } from '../dev/memory-deps';
import { setup } from './helpers';

describe('configuration fails closed', () => {
  const base = {
    TOKEN_ENCRYPTION_KEY: DEV_KEY,
    COOKIE_SECRET: DEV_KEY,
    APP_ORIGIN: 'https://ops.example.test',
    ENTRA_TENANT_ID: 't',
    ENTRA_CLIENT_ID: 'c',
    ENTRA_CLIENT_SECRET: 's',
    GRAPH_DRIVE_ID: 'd',
    ONEDRIVE_ROOT_PATH: 'Root',
  };
  it('rejects developer sign-in, memory storage and plain http outside development', () => {
    expect(() => loadConfig({ ...base, ENVIRONMENT: 'production', DEV_AUTH: 'enabled' })).toThrow(
      /DEV_AUTH/,
    );
    expect(() =>
      loadConfig({ ...base, ENVIRONMENT: 'production', STORAGE_BACKEND: 'memory' }),
    ).toThrow(/memory/);
    expect(() =>
      loadConfig({ ...base, ENVIRONMENT: 'production', APP_ORIGIN: 'http://x' }),
    ).toThrow(/https/);
  });
  it('requires 32-byte secrets', () => {
    expect(() =>
      loadConfig({ ...base, ENVIRONMENT: 'production', COOKIE_SECRET: 'short' }),
    ).toThrow(/COOKIE_SECRET/);
  });
  it('accepts a complete production config with __Host- cookies', () => {
    const c = loadConfig({ ...base, ENVIRONMENT: 'production' });
    expect(c.sessionCookieName).toBe('__Host-c360_session');
    expect(c.devAuth).toBe(false);
  });
});

describe('sessions and request protection', () => {
  it('requires sign-in and rejects cross-site writes', async () => {
    const t = await setup();
    expect((await t.client().get('/api/me')).status).toBe(401);
    const noHeader = await t.app.request('/api/auth/dev-login', {
      method: 'POST',
      body: '{"userId":"demo-pm1"}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(noHeader.status).toBe(403);
    const evil = await t.app.request('/api/auth/dev-login', {
      method: 'POST',
      body: '{"userId":"demo-pm1"}',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'chat360',
        Origin: 'https://evil.example',
      },
    });
    expect(evil.status).toBe(403);
  });

  it('sets an HttpOnly SameSite=Strict cookie and logout revokes the session', async () => {
    const t = await setup();
    const c = t.client();
    const res = await c.post('/api/auth/dev-login', { userId: 'demo-pm1' });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await c.get('/api/me')).status).toBe(200);
    const copy = t.client(`c360_session=${/c360_session=([^;]*)/.exec(cookie)![1]}`);
    await c.post('/api/auth/logout');
    expect((await copy.get('/api/me')).status).toBe(401);
  });

  it('stores only a hash of the session cookie', async () => {
    const t = await setup();
    const c = t.client();
    const res = await c.post('/api/auth/dev-login', { userId: 'demo-pm1' });
    const raw = /c360_session=([^;]*)/.exec(res.headers.get('set-cookie')!)![1]!;
    const ids = [...t.deps.sessionStore.sessions.keys()];
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toContain(raw);
    expect(ids[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a deactivated user loses access immediately', async () => {
    const t = await setup();
    const tech = await t.as('demo-tech2');
    const admin = await t.as('demo-admin');
    expect((await admin.put('/api/admin/users/demo-tech2', { status: 'deactivated' })).status).toBe(
      200,
    );
    expect((await tech.get('/api/me')).status).toBe(401);
  });

  it('never grants roles from an email domain; new users see nothing until assigned', async () => {
    const t = await setup();
    const newbie = await t.as('demo-new');
    const me = await newbie.json(newbie.get('/api/me'));
    expect(me.permissions).toEqual({ createProject: false, portfolio: false, admin: false });
    expect(me.onboarding.missingRequired).toContain('role_assigned');
    const list = await newbie.json(newbie.get('/api/projects'));
    expect(list.projects).toEqual([]);
  });

  it('does not register developer sign-in outside development', async () => {
    const t = await setup();
    t.deps.config.devAuth = false;
    const { createApp } = await import('../src/app');
    const app = createApp(t.deps);
    const res = await app.request('/api/auth/dev-login', {
      method: 'POST',
      body: '{"userId":"demo-admin"}',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chat360' },
    });
    expect(res.status).toBe(404);
  });
});

describe('employee policy', () => {
  const member = {
    id: 'o1',
    displayName: 'A',
    mail: 'a@chat.io',
    userPrincipalName: 'a@chat.io',
    userType: 'Member',
    accountEnabled: true,
  };
  it('accepts members of the allowed domain and refuses guests, disabled and foreign accounts', () => {
    expect(checkEmployeePolicy(member, ['chat.io'])).toBe('a@chat.io');
    expect(() => checkEmployeePolicy({ ...member, userType: 'Guest' }, ['chat.io'])).toThrow(
      /Guest/,
    );
    expect(() =>
      checkEmployeePolicy(
        { ...member, userPrincipalName: 'x_gmail.com#EXT#@chat.io', mail: null },
        ['chat.io'],
      ),
    ).toThrow(/Guest/);
    expect(() => checkEmployeePolicy({ ...member, accountEnabled: false }, ['chat.io'])).toThrow(
      /disabled/,
    );
    expect(() => checkEmployeePolicy({ ...member, mail: 'a@other.com' }, ['chat.io'])).toThrow(
      /not a Chat360/,
    );
  });
  it('blocks open redirects', () => {
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('/projects/PRJ-1')).toBe('/projects/PRJ-1');
  });
});

describe('OIDC ID token validation', () => {
  async function signer() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const client = createOidcClient({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 's',
      redirectUri: 'https://x/cb',
      jwks: createLocalJWKSet({ keys: [jwk] }),
    });
    const sign = (
      claims: Record<string, unknown>,
      iss = 'https://login.microsoftonline.com/tenant-1/v2.0',
      aud = 'client-1',
    ) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(iss)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
    return { client, sign };
  }
  it('accepts a valid token and rejects wrong tenant, audience, issuer or nonce', async () => {
    const { client, sign } = await signer();
    const good = await sign({ oid: 'u1', tid: 'tenant-1', nonce: 'n' });
    expect((await client.verifyIdToken(good, 'n')).oid).toBe('u1');
    await expect(client.verifyIdToken(good, 'other')).rejects.toThrow(/did not match/);
    await expect(
      client.verifyIdToken(await sign({ oid: 'u1', tid: 'tenant-2', nonce: 'n' }), 'n'),
    ).rejects.toThrow(/not from the Chat360 tenant/);
    await expect(
      client.verifyIdToken(
        await sign({ oid: 'u1', tid: 'tenant-1', nonce: 'n' }, undefined, 'other-app'),
        'n',
      ),
    ).rejects.toThrow(/could not be verified/);
    await expect(
      client.verifyIdToken(
        await sign({ oid: 'u1', tid: 'tenant-1', nonce: 'n' }, 'https://evil/v2.0'),
        'n',
      ),
    ).rejects.toThrow(/could not be verified/);
  });

  it('builds a PKCE authorize URL with minimal scopes', () => {
    const client = createOidcClient({
      tenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://app/api/auth/callback',
      jwks: createLocalJWKSet({ keys: [] }),
    });
    const url = new URL(
      client.authorizeUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: 'cc',
        scopes: ['openid', 'User.Read'],
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid User.Read');
    expect(url.pathname).toBe('/t/oauth2/v2.0/authorize');
  });
});

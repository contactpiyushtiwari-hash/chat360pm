import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/auth/crypto';
import { loadConfig } from '../src/env';
import { DEMO_PASSWORD } from '../dev/seed';
import { memoryDeps } from '../dev/memory-deps';
import { readJson, setup, type Client } from './helpers';

describe('configuration fails closed', () => {
  const base = { APP_ORIGIN: 'https://ops.example.test', SETUP_CODE: 'a-long-setup-code' };
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
  it('rejects a short setup code', () => {
    expect(() => loadConfig({ ...base, ENVIRONMENT: 'production', SETUP_CODE: 'short' })).toThrow(
      /SETUP_CODE/,
    );
  });
  it('accepts a complete production config with __Host- cookies', () => {
    const c = loadConfig({ ...base, ENVIRONMENT: 'production' });
    expect(c.sessionCookieName).toBe('__Host-c360_session');
    expect(c.devAuth).toBe(false);
    expect(c.storageBackend).toBe('d1');
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

describe('password sign-in', () => {
  const login = (c: Client, email: string, password: string) =>
    c.post('/api/auth/login', { email, password });

  it('signs in with the right password and gives one generic error otherwise', async () => {
    const t = await setup();
    const c = t.client();
    expect((await login(c, 'Demo-PM1@chat.io', DEMO_PASSWORD)).status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    const wrong = await login(t.client(), 'demo-pm1@chat.io', 'not-the-password');
    const unknown = await login(t.client(), 'nobody@chat.io', DEMO_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await readJson(wrong)).error.message).toBe((await readJson(unknown)).error.message);
  });

  it('stores only salted hashes, never the password', async () => {
    const t = await setup();
    const raw = JSON.stringify([...t.deps.store.files.values()].map((f) => f.json));
    expect(raw).not.toContain(DEMO_PASSWORD);
    const [a, b] = await Promise.all([hashPassword('same', 1000), hashPassword('same', 1000)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('Same', a)).toBe(false);
  });

  it('refuses deactivated accounts and rate-limits guessing', async () => {
    const t = await setup();
    const admin = await t.as('demo-admin');
    await admin.put('/api/admin/users/demo-tech2', { status: 'deactivated' });
    expect((await login(t.client(), 'demo-tech2@chat.io', DEMO_PASSWORD)).status).toBe(403);
    const c = t.client();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await login(c, 'demo-csm@chat.io', `guess-${i}`)).status);
    expect(codes.at(-1)).toBe(429);
  });

  it('admin adds an employee who sets a password through a one-time link', async () => {
    const t = await setup();
    const admin = await t.as('demo-admin');
    const created = await admin.post('/api/admin/users', {
      email: 'New.Person@chat.io',
      displayName: 'New Person (demo)',
      roles: ['tech'],
    });
    expect(created.status).toBe(201);
    const { user, setupLink } = await readJson(created);
    expect(user).toMatchObject({ email: 'new.person@chat.io', roles: ['tech'] });
    expect(setupLink.url).toMatch(/^http:\/\/localhost:5173\/set-password#token=/);
    const token = setupLink.url.split('#token=')[1];
    expect(JSON.stringify(await t.deps.repos.credentials())).not.toContain(token);

    const c = t.client();
    expect((await c.post('/api/auth/set-password', { token, password: 'short' })).status).toBe(422);
    expect(
      (await c.post('/api/auth/set-password', { token, password: 'a good long password' })).status,
    ).toBe(200);
    expect((await c.json(c.get('/api/me'))).user.email).toBe('new.person@chat.io');
    const reuse = await t.client().post('/api/auth/set-password', {
      token,
      password: 'another long password',
    });
    expect(reuse.status).toBe(400);
    expect((await login(t.client(), 'new.person@chat.io', 'a good long password')).status).toBe(
      200,
    );
    expect(
      (await admin.post('/api/admin/users', { email: 'new.person@chat.io', displayName: 'Dup' }))
        .status,
    ).toBe(409);
    const pm = await t.as('demo-pm1');
    expect(
      (await pm.post('/api/admin/users', { email: 'x@chat.io', displayName: 'X' })).status,
    ).toBe(403);
  });

  it('set-password links expire', async () => {
    const t = await setup();
    let now = Date.now();
    t.deps.clock = () => new Date(now);
    const admin = await t.as('demo-admin');
    const { setupLink } = await admin.json(admin.post('/api/admin/users/demo-csm/setup-link'));
    now += 8 * 24 * 3600_000;
    const res = await t.client().post('/api/auth/set-password', {
      token: setupLink.url.split('#token=')[1],
      password: 'a good long password',
    });
    expect(res.status).toBe(400);
  });

  it('changing a password needs the current one and signs out other sessions', async () => {
    const t = await setup();
    const a = t.client();
    const b = t.client();
    await login(a, 'demo-csm@chat.io', DEMO_PASSWORD);
    await login(b, 'demo-csm@chat.io', DEMO_PASSWORD);
    expect(
      (
        await a.post('/api/account/password', {
          currentPassword: 'wrong',
          newPassword: 'x'.repeat(12),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await a.post('/api/account/password', {
          currentPassword: DEMO_PASSWORD,
          newPassword: 'brand new password',
        })
      ).status,
    ).toBe(200);
    expect((await a.get('/api/me')).status).toBe(200);
    expect((await b.get('/api/me')).status).toBe(401);
    expect((await login(t.client(), 'demo-csm@chat.io', DEMO_PASSWORD)).status).toBe(401);
  });
});

describe('first administrator setup', () => {
  async function fresh() {
    const deps = memoryDeps();
    const app = createApp(deps);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chat360' },
      });
    const config = async () => (await (await app.request('/api/auth/config')).json()) as never;
    return { deps, post, config };
  }
  const admin = {
    email: 'owner@chat.io',
    displayName: 'Owner (demo)',
    password: 'a good long password',
  };

  it('needs the setup code and works only until an admin can sign in', async () => {
    const f = await fresh();
    expect(await f.config()).toMatchObject({ setupAvailable: true });
    expect((await f.post('/api/auth/setup', { ...admin, setupCode: 'wrong' })).status).toBe(403);
    const ok = await f.post('/api/auth/setup', { ...admin, setupCode: 'dev-setup-code' });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('set-cookie')).toMatch(/c360_session=/);
    const d = await f.deps.repos.directory();
    expect(d.users[0]).toMatchObject({ email: 'owner@chat.io', roles: ['admin'] });
    expect(await f.config()).toMatchObject({ setupAvailable: false });
    const again = await f.post('/api/auth/setup', {
      ...admin,
      email: 'attacker@chat.io',
      setupCode: 'dev-setup-code',
    });
    expect(again.status).toBe(403);
  });

  it('is unavailable when no setup code is configured', async () => {
    const t = await setup({ env: { SETUP_CODE: '' } });
    expect(await t.client().json(t.client().get('/api/auth/config'))).toMatchObject({
      setupAvailable: false,
    });
  });
});

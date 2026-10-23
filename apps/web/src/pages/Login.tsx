import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { api, ApiError, post } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Field, InlineError, Input, Spinner } from '../components/ui';
import { useAction } from '../lib/hooks';

interface AuthConfig {
  devAuth: boolean;
  setupAvailable: boolean;
}

/** Only same-origin relative paths; blocks open redirects like `//evil.com` or `/\evil.com`. */
export function safeReturnTo(v: string | null): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  return v;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const { status, refresh } = useSession();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [devUsers, setDevUsers] = useState<{ id: string; displayName: string; roles: string[] }[]>(
    [],
  );
  const [form, setForm] = useState({ email: '', password: '', displayName: '', setupCode: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const login = useAction(async () => {
    await post('/api/auth/login', { email: form.email, password: form.password });
    await refresh();
  });
  const setup = useAction(async () => {
    await post('/api/auth/setup', form);
    await refresh();
  });
  const devLogin = useAction(async (userId: string) => {
    await post('/api/auth/dev-login', { userId });
    await refresh();
  });

  useEffect(() => {
    document.title = 'Sign in · Chat360 Ops';
    void api<AuthConfig>('/api/auth/config')
      .then(async (c) => {
        setConfig(c);
        if (c.setupAvailable) setMode('setup');
        if (c.devAuth)
          setDevUsers((await api<{ users: typeof devUsers }>('/api/auth/dev-users')).users);
      })
      .catch((e: unknown) => {
        // A misconfigured server answers 503; say so instead of offering a sign-in that fails.
        if (e instanceof ApiError && e.code === 'service_misconfigured') setUnconfigured(true);
        setConfig({ devAuth: false, setupAvailable: false });
      });
  }, []);

  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void (mode === 'login' ? login.run() : setup.run());
  };
  const action = mode === 'login' ? login : setup;

  return (
    <div className="login">
      <div className="login-card card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Chat360 Project Operations</h1>
            <p className="muted">
              Projects, trackers, daily confirmations and handovers in one place.
            </p>
          </div>
        </div>
        {params.get('signedOut') && <p className="notice">You have signed out.</p>}
        {unconfigured && (
          <p className="inline-error" role="alert">
            The service is not fully set up yet: an administrator still needs to finish the
            Cloudflare settings.
          </p>
        )}
        {!config ? (
          <Spinner label="Loading sign-in options…" />
        ) : (
          <>
            {mode === 'setup' && (
              <p className="notice">
                First-time setup: create the first administrator account. You need the setup code
                from the Cloudflare settings.
              </p>
            )}
            <form onSubmit={submit} noValidate>
              {mode === 'setup' && (
                <>
                  <Field label="Setup code" required>
                    {(p) => (
                      <Input
                        {...p}
                        type="password"
                        autoComplete="off"
                        value={form.setupCode}
                        onChange={set('setupCode')}
                      />
                    )}
                  </Field>
                  <Field label="Your name" required>
                    {(p) => (
                      <Input
                        {...p}
                        autoComplete="name"
                        value={form.displayName}
                        onChange={set('displayName')}
                      />
                    )}
                  </Field>
                </>
              )}
              <Field label="Work email" required error={action.error?.fields.email}>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    autoComplete="username"
                    value={form.email}
                    onChange={set('email')}
                  />
                )}
              </Field>
              <Field
                label="Password"
                required
                hint={mode === 'setup' ? 'At least 10 characters.' : undefined}
                error={action.error?.fields.password}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                    value={form.password}
                    onChange={set('password')}
                  />
                )}
              </Field>
              <InlineError error={action.error} />
              <Button
                type="submit"
                variant="primary"
                className="btn-block"
                loading={action.pending}
              >
                {mode === 'login' ? 'Sign in' : 'Create administrator account'}
              </Button>
            </form>
            {config.setupAvailable && (
              <Button variant="ghost" onClick={() => setMode(mode === 'login' ? 'setup' : 'login')}>
                {mode === 'login' ? 'First-time setup' : 'I already have an account'}
              </Button>
            )}
            {mode === 'login' && (
              <p className="hint">
                Forgot your password or have no account yet? Ask an administrator for a set-password
                link.
              </p>
            )}
            {config.devAuth && (
              <section className="dev-login" aria-labelledby="dev-login-title">
                <h2 id="dev-login-title">Developer sign-in</h2>
                <p className="hint">
                  Local development only. These are fictional demo users with in-memory data (their
                  password is <code>demo-password</code>).
                </p>
                <InlineError error={devLogin.error} />
                <div className="dev-users">
                  {devUsers.map((u) => (
                    <Button
                      key={u.id}
                      onClick={() => devLogin.run(u.id)}
                      loading={devLogin.pending}
                    >
                      {u.displayName}
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

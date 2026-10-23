import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { post } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Button, Field, InlineError, Input } from '../components/ui';

/** Completes an admin-issued set-password link. The token arrives in the URL fragment. */
export function SetPasswordPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;

  useEffect(() => {
    document.title = 'Choose a password · Chat360 Ops';
    // Keep the one-time token out of browser history once it has been read.
    if (location.hash) history.replaceState(null, '', location.pathname);
  }, []);

  const save = useAction(async () => {
    const r = await post<{ onboarded: boolean }>('/api/auth/set-password', { token, password });
    await refresh();
    navigate(r.onboarded ? '/' : '/welcome', { replace: true });
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) void save.run();
  };

  return (
    <div className="login">
      <div className="login-card card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Choose your password</h1>
            <p className="muted">Chat360 Project Operations</p>
          </div>
        </div>
        {!token ? (
          <p className="inline-error" role="alert">
            This link is incomplete. Open the full link you were given, or ask an administrator for
            a new one. <Link to="/login">Go to sign-in</Link>
          </p>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field
              label="New password"
              required
              hint="At least 10 characters. A short sentence is easy to remember."
              error={save.error?.fields.password}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Repeat password"
              required
              error={mismatch ? 'The passwords do not match.' : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
            <InlineError error={save.error} />
            <Button
              type="submit"
              variant="primary"
              className="btn-block"
              loading={save.pending}
              disabled={!password || mismatch}
            >
              Save password and sign in
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  GLOBAL_ROLES,
  GLOBAL_ROLE_LABELS,
  type AccountRequest,
  type AuditEntry,
  type GlobalRole,
  type OrgConfig,
} from '@chat360/core';
import { post, put } from '../lib/api';
import { fmtInstant, titleCase } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
  TextArea,
  useToast,
} from '../components/ui';
import { NotFoundPage } from './NotFound';

type TabId = 'users' | 'config' | 'requests' | 'jobs' | 'audit';

export function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<TabId>('users');
  if (!me.permissions.admin) return <NotFoundPage />;
  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Roles, configuration, account requests and operations. Administrators do not get project data access from this role."
      />
      {!me.notificationsConfigured && (
        <p className="notice">
          The notification mailbox is not configured: escalation and reminder emails are recorded as
          “not configured” and not sent.
        </p>
      )}
      <Tabs<TabId>
        label="Admin sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'users', label: 'Users and roles' },
          { id: 'config', label: 'Configuration' },
          { id: 'requests', label: 'Account requests' },
          { id: 'jobs', label: 'Scheduled jobs' },
          { id: 'audit', label: 'Audit log' },
        ]}
      />
      <div className="tab-panel">
        {tab === 'users' && <Users />}
        {tab === 'config' && <Config />}
        {tab === 'requests' && <Requests />}
        {tab === 'jobs' && <Jobs />}
        {tab === 'audit' && <Audit />}
      </div>
    </>
  );
}

interface AdminUser {
  id: string;
  displayName: string;
  email: string;
  roles: GlobalRole[];
  status: string;
  onboardingComplete: boolean;
}

function Users() {
  const { reloadDirectory } = useSession();
  const toast = useToast();
  const r = useResource<{ users: AdminUser[] }>('/api/admin/users');
  const [q, setQ] = useState('');
  const save = useAction(async (u: AdminUser, body: { roles?: GlobalRole[]; status?: string }) => {
    await put(`/api/admin/users/${u.id}`, body);
    toast('success', `Updated ${u.displayName}.`);
    await Promise.all([r.reload(), reloadDirectory()]);
  });
  if (r.loading) return <Skeleton lines={6} />;
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  const users = r.data!.users.filter((u) =>
    `${u.displayName} ${u.email}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Card>
      <p className="hint">
        Employees appear here after their first sign-in. Roles are never granted automatically from
        an email domain.
      </p>
      <InlineError error={save.error} />
      <label className="sr-only" htmlFor="user-search">
        Search users
      </label>
      <Input
        id="user-search"
        type="search"
        placeholder="Search by name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {users.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Roles</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Employee">
                    <strong>{u.displayName}</strong>
                    <div className="hint">{u.email}</div>
                  </td>
                  <td data-label="Roles">
                    <div className="check-grid">
                      {GLOBAL_ROLES.map((role) => (
                        <label key={role} className="check-pill">
                          <input
                            type="checkbox"
                            disabled={save.pending || u.status === 'deactivated'}
                            checked={u.roles.includes(role)}
                            onChange={(e) =>
                              void save.run(u, {
                                roles: e.target.checked
                                  ? [...u.roles, role]
                                  : u.roles.filter((x) => x !== role),
                              })
                            }
                          />
                          {GLOBAL_ROLE_LABELS[role]}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td data-label="Status">
                    <Badge
                      value={
                        u.status === 'active'
                          ? 'done'
                          : u.status === 'deactivated'
                            ? 'failed'
                            : 'pending'
                      }
                      label={titleCase(u.status)}
                    />
                    {u.status === 'deactivated' ? (
                      <Button
                        variant="ghost"
                        onClick={() => void save.run(u, { status: 'active' })}
                      >
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (
                            confirm(`Deactivate ${u.displayName}? Their sessions end immediately.`)
                          )
                            void save.run(u, { status: 'deactivated' });
                        }}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Config() {
  const toast = useToast();
  const r = useResource<{ config: OrgConfig }>('/api/admin/config');
  const [text, setText] = useState('');
  useEffect(() => {
    if (r.data) {
      const { schemaVersion: _s, updatedAt: _u, updatedBy: _b, ...editable } = r.data.config;
      setText(JSON.stringify(editable, null, 2));
    }
  }, [r.data]);
  const [parseError, setParseError] = useState('');
  const save = useAction(async () => {
    let body: unknown;
    try {
      body = JSON.parse(text);
      setParseError('');
    } catch (e) {
      setParseError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    await put('/api/admin/config', body);
    toast('success', 'Configuration saved.');
    await r.reload();
  });
  if (r.loading) return <Skeleton lines={8} />;
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  const fields = save.error?.fields ?? {};
  return (
    <Card title="Organisation configuration">
      <p className="hint">
        Timezone, working days (1 = Monday … 7 = Sunday), holidays, delay reasons, escalation levels
        and SLAs, approved OneDrive destinations, support contact, and <code>disabledJobs</code>{' '}
        (emergency kill switch for scheduled jobs). Validated on save.
      </p>
      {r.data!.config.updatedAt && (
        <p className="hint">Last changed {fmtInstant(r.data!.config.updatedAt)}.</p>
      )}
      <Field
        label="Configuration (JSON)"
        error={
          parseError ||
          Object.entries(fields)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ')
        }
      >
        {(a) => (
          <TextArea
            {...a}
            className="input mono"
            rows={24}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      <InlineError error={save.error && !Object.keys(fields).length ? save.error : null} />
      <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
        Save configuration
      </Button>
    </Card>
  );
}

function Requests() {
  const r = useResource<{ requests: (AccountRequest & { userName: string })[] }>(
    '/api/admin/account-requests',
  );
  const [notes, setNotes] = useState('');
  const act = useAction(async (id: string, decision: 'approve' | 'reject') => {
    await post(`/api/admin/account-requests/${id}/${decision}`, { notes });
    setNotes('');
    await r.reload();
  });
  if (r.loading) return <Skeleton />;
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  return (
    <Card title="Account deactivation requests">
      <InlineError error={act.error} />
      {r.data!.requests.length === 0 ? (
        <EmptyState title="No account requests" />
      ) : (
        <ul className="esc-list">
          {r.data!.requests.map((q) => (
            <li key={q.id} className="esc-item">
              <div className="row wrap">
                <strong>{q.userName}</strong> <span className="mono">{q.id}</span>{' '}
                <Badge
                  value={
                    q.status === 'completed'
                      ? 'done'
                      : q.status === 'rejected'
                        ? 'failed'
                        : 'pending'
                  }
                  label={titleCase(q.status)}
                />
              </div>
              <p className="hint">
                {fmtInstant(q.createdAt)} · {q.reason || 'No reason given'}
              </p>
              {q.activePmProjects.length > 0 && (
                <p className="notice">
                  Still PM of: {q.activePmProjects.join(', ')} — transfer these first.
                </p>
              )}
              <ul className="compact">
                {q.steps.map((s) => (
                  <li key={s.name}>
                    <Badge value={s.status} /> {titleCase(s.name)}{' '}
                    {s.error && <span className="hint">{s.error}</span>}
                  </li>
                ))}
              </ul>
              {(q.status === 'pending_review' || q.status === 'pending_transfers') && (
                <div className="row wrap">
                  <Input
                    aria-label="Decision notes"
                    placeholder="Notes (required to reject)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <Button
                    variant="danger"
                    disabled={q.status !== 'pending_review'}
                    loading={act.pending}
                    onClick={() => void act.run(q.id, 'approve')}
                  >
                    Approve deactivation
                  </Button>
                  <Button loading={act.pending} onClick={() => void act.run(q.id, 'reject')}>
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface JobRun {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  stats: Record<string, number>;
  errors: string[];
}

function Jobs() {
  const r = useResource<{ jobs: string[]; disabledJobs: string[]; runs: JobRun[] }>(
    '/api/admin/jobs',
  );
  const health = useResource<{
    ok: boolean;
    checks: Record<string, { ok: boolean; detail?: string }>;
    release: string;
  }>('/api/admin/health');
  const run = useAction(async (name: string) => {
    await post(`/api/admin/jobs/${name}/run`);
    await r.reload();
  });
  return (
    <div className="grid-2">
      <Card title="Health">
        {health.loading ? (
          <Skeleton />
        ) : health.error ? (
          <ErrorState error={health.error} onRetry={health.reload} />
        ) : (
          <ul className="compact">
            {Object.entries(health.data!.checks).map(([k, v]) => (
              <li key={k}>
                <Badge value={v.ok ? 'done' : 'failed'} label={v.ok ? 'OK' : 'Problem'} />{' '}
                {titleCase(k)} <span className="hint">{v.detail}</span>
              </li>
            ))}
            <li className="hint">Release {health.data!.release}</li>
          </ul>
        )}
      </Card>
      <Card title="Scheduled jobs">
        <InlineError error={run.error} />
        {r.loading ? (
          <Skeleton />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : (
          <>
            <ul className="list">
              {r.data!.jobs.map((j) => (
                <li key={j} className="list-row">
                  <span>
                    {titleCase(j)}{' '}
                    {r.data!.disabledJobs.includes(j) && <Badge value="failed" label="Disabled" />}
                  </span>
                  <Button loading={run.pending} onClick={() => void run.run(j)}>
                    Run now
                  </Button>
                </li>
              ))}
            </ul>
            <h3>Recent runs</h3>
            {r.data!.runs.length === 0 ? (
              <EmptyState title="No runs recorded yet" />
            ) : (
              <ul className="compact">
                {r.data!.runs.map((x) => (
                  <li key={x.id}>
                    <Badge value={x.ok ? 'done' : 'failed'} label={x.ok ? 'OK' : 'Errors'} />{' '}
                    {titleCase(x.job)} · {fmtInstant(x.startedAt)} ·{' '}
                    {Object.entries(x.stats)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', ') || 'no changes'}
                    {x.errors.length > 0 && (
                      <div className="hint">{x.errors.slice(0, 3).join(' | ')}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Audit() {
  const { nameOf } = useSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const r = useResource<{ entries: AuditEntry[] }>(`/api/admin/audit?month=${month}`);
  return (
    <Card title="Organisation audit log">
      <Field label="Month">
        {(a) => (
          <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
      </Field>
      {r.loading ? (
        <Skeleton />
      ) : r.error ? (
        <ErrorState error={r.error} onRetry={r.reload} />
      ) : r.data!.entries.length === 0 ? (
        <EmptyState title="No audit entries this month" />
      ) : (
        <ol className="timeline">
          {[...r.data!.entries].reverse().map((e) => (
            <li key={e.id}>
              <span className="hint">{fmtInstant(e.at)}</span>
              <div>
                {e.action.replace(/[._]/g, ' ')} <span className="mono small">{e.target}</span>
              </div>
              <div className="hint">by {nameOf(e.actor)}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

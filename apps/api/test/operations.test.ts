import { addDays, isWorkingDay, todayIn, type Project } from '@chat360/core';
import { describe, expect, it } from 'vitest';
import { runJob } from '../src/jobs/scheduled';
import { PATHS } from '../src/store/repos';
import { readJson, setup, type Ctx } from './helpers';

const today = () => todayIn('Asia/Kolkata');
const doc = async (t: Ctx, id: string): Promise<Project> => (await t.deps.repos.project(id))!;
const workingToday = () => isWorkingDay(today(), { workingDays: [1, 2, 3, 4, 5], holidays: [] });

describe('scheduled jobs', () => {
  it('daily confirmation marks no-response, escalates once, and is safe to re-run', async () => {
    const t = await setup();
    if (!workingToday()) {
      const run = await runJob(t.deps, 'daily_confirmation', 'test');
      expect(run.stats.nonWorkingDay).toBe(1);
      return;
    }
    const first = await runJob(t.deps, 'daily_confirmation', 'test');
    expect(first.ok).toBe(true);
    expect(first.stats.unconfirmed).toBeGreaterThan(0);
    const p = await doc(t, t.projects[0]!);
    const escalations = p.escalations.length;
    expect(escalations).toBeGreaterThan(0);
    expect(
      p.tasks.every(
        (x) => x.status !== 'completed' || x.confirmations.some((c) => c.outcome === 'completed'),
      ),
    ).toBe(true);
    const second = await runJob(t.deps, 'daily_confirmation', 'test');
    expect(second.stats.unconfirmed ?? 0).toBe(0);
    expect((await doc(t, t.projects[0]!)).escalations).toHaveLength(escalations);
    expect(t.deps.coordination.jobRuns).toHaveLength(2);
  });

  it('can be disabled by an administrator (kill switch) without a deploy', async () => {
    const t = await setup();
    const admin = await t.as('demo-admin');
    const cfg = (await admin.json(admin.get('/api/admin/config'))).config;
    const { updatedAt: _u, updatedBy: _b, schemaVersion: _s, ...editable } = cfg;
    const res = await admin.put('/api/admin/config', {
      ...editable,
      disabledJobs: ['daily_confirmation'],
    });
    expect(res.status).toBe(200);
    const run = await runJob(t.deps, 'daily_confirmation', 'test');
    expect(run.stats.disabled).toBe(1);
    expect((await doc(t, t.projects[0]!)).escalations).toHaveLength(0);
  });

  it('does not run overlapping instances of the same job', async () => {
    const t = await setup();
    await t.deps.coord.acquireLease('job:maintenance', 'someone-else', 60);
    const run = await runJob(t.deps, 'maintenance', 'test');
    expect(run.stats.skippedOverlap).toBe(1);
  });

  it('reconcile re-adds a project whose index entry was lost', async () => {
    const t = await setup();
    const id = t.projects[1]!;
    await t.deps.repos.update(PATHS.index, null, (idx: { projects: { id: string }[] }) => {
      idx.projects = idx.projects.filter((p) => p.id !== id);
    });
    const run = await runJob(t.deps, 'reconcile', 'test');
    expect(run.stats.recovered).toBe(1);
    expect((await t.deps.repos.index(true)).projects.some((p) => p.id === id)).toBe(true);
  });

  it('morning reminders send one digest per owner per day', async () => {
    const t = await setup();
    if (!workingToday()) return;
    await runJob(t.deps, 'morning_reminders', 'test');
    await runJob(t.deps, 'morning_reminders', 'test');
    const digests = t.deps.recordingMailer.sent.filter((m) =>
      m.subject.includes('need your confirmation'),
    );
    const recipients = digests.map((m) => m.to[0]);
    expect(new Set(recipients).size).toBe(recipients.length);
    expect(recipients).toContain('demo-tech1@chat.io');
  });
});

describe('account deactivation', () => {
  it('protects active projects and only completes after transfer and admin approval', async () => {
    const t = await setup();
    const pm = await t.as('demo-pm2');
    const status = await pm.json(pm.get('/api/account/deactivation'));
    expect(status.activePmProjects.map((p: { id: string }) => p.id)).toEqual([t.projects[1]]);
    const bad = await pm.post('/api/account/deactivation', {
      reason: 'Leaving',
      confirmEmail: 'wrong@chat.io',
      acknowledgeConsequences: true,
    });
    expect(bad.status).toBe(422);
    const req = (
      await pm.json(
        pm.post('/api/account/deactivation', {
          reason: 'Leaving',
          confirmEmail: 'demo-pm2@chat.io',
          acknowledgeConsequences: true,
        }),
      )
    ).request;
    expect(req.status).toBe('pending_transfers');
    expect(
      t.deps.recordingMailer.sent.some(
        (m) => m.subject.includes('Deactivation requested') && m.to.includes('demo-head@chat.io'),
      ),
    ).toBe(true);

    const admin = await t.as('demo-admin');
    const blocked = await admin.post(`/api/admin/account-requests/${req.id}/approve`, {
      notes: '',
    });
    expect(blocked.status).toBe(412);

    const head = await t.as('demo-head');
    await head.post(`/api/projects/${t.projects[1]}/reassign-pm`, {
      newPmId: 'demo-pm1',
      reason: 'PM leaving',
      effectiveDate: today(),
      handoverNotes: '',
      confirm: true,
    });
    const approved = await admin.json(
      admin.post(`/api/admin/account-requests/${req.id}/approve`, { notes: 'ok' }),
    );
    expect(approved.request.status).toBe('completed');
    expect((await pm.get('/api/me')).status).toBe(401);
    // Project data is untouched by deactivation.
    const p = await doc(t, t.projects[1]!);
    expect(p.teamHistory.some((h) => h.from.includes('demo-pm2'))).toBe(true);
  });

  it('requires a recent sign-in', async () => {
    const t = await setup();
    let now = Date.now();
    t.deps.clock = () => new Date(now);
    const u = await t.as('demo-csm');
    now += 20 * 60_000;
    const res = await u.post('/api/account/deactivation', {
      reason: '',
      confirmEmail: 'demo-csm@chat.io',
      acknowledgeConsequences: true,
    });
    expect(res.status).toBe(403);
    expect((await readJson(res)).error.code).toBe('reauth_required');
  });
});

describe('email drafts', () => {
  it('fills templates from projects the caller can see, and hides others', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const u = await t.as('demo-pm1');
    const tpl = await u.json(u.get(`/api/email/templates?projectId=${id}`));
    expect(tpl.templates.find((x: { id: string }) => x.id === 'api_followup').body).toContain(
      'Order status API',
    );
    const outsider = await t.as('demo-new');
    expect((await outsider.get(`/api/email/templates?projectId=${id}`)).status).toBe(404);
  });
});

describe('support', () => {
  it('reporters see their own requests; admins triage all', async () => {
    const t = await setup();
    const u = await t.as('demo-tech1');
    const created = await u.post('/api/support', {
      category: 'bug',
      subject: 'Sync failed',
      description: 'Tracker shows failed',
      projectId: t.projects[0],
      priority: 'high',
    });
    expect(created.status).toBe(201);
    const other = await t.as('demo-csm');
    expect((await other.json(other.get('/api/support'))).requests).toEqual([]);
    const admin = await t.as('demo-admin');
    const all = await admin.json(admin.get('/api/support'));
    expect(all.requests).toHaveLength(1);
    const id = all.requests[0].id;
    expect((await u.patch(`/api/support/${id}`, { status: 'resolved' })).status).toBe(403);
    expect(
      (
        await admin.patch(`/api/support/${id}`, {
          status: 'resolved',
          resolutionNotes: 'Retried sync',
        })
      ).status,
    ).toBe(200);
  });

  it('rejects references to projects the reporter cannot see', async () => {
    const t = await setup();
    const u = await t.as('demo-new');
    const res = await u.post('/api/support', {
      category: 'bug',
      subject: 's',
      description: 'd',
      projectId: t.projects[0],
      priority: 'low',
    });
    expect(res.status).toBe(422);
  });
});

describe('analytics', () => {
  it('scopes portfolio analytics to the head and own projects to PMs', async () => {
    const t = await setup();
    const head = await t.as('demo-head');
    const h = await head.json(head.get('/api/analytics'));
    expect(h.scope).toBe('portfolio');
    expect(h.analytics.totals.projects).toBe(2);
    const pm = await t.as('demo-pm2');
    const p = await pm.json(pm.get('/api/analytics'));
    expect(p.scope).toBe('mine');
    expect(p.analytics.projects.map((x: { id: string }) => x.id)).toEqual([t.projects[1]]);
  });
});

describe('telemetry', () => {
  it('accepts redacted client error reports before sign-in, rate limited', async () => {
    const lines: string[] = [];
    const { createLogger } = await import('../src/observability/log');
    const t = await setup({ log: createLogger({}, (l) => lines.push(l)) });
    const c = t.client();
    const res = await c.post('/api/client-errors', {
      message: 'Boom for jane.doe@chat.io Bearer abc.def.ghi',
      kind: 'error',
      route: '/projects?x=secret',
    });
    expect(res.status).toBe(202);
    const logged = lines.find((l) => l.includes('client_error'))!;
    expect(logged).not.toContain('jane.doe@');
    expect(logged).not.toContain('abc.def.ghi');
    expect(logged).not.toContain('secret');
    for (let i = 0; i < 30; i++)
      await c.post('/api/client-errors', { message: 'x', kind: 'error' });
    expect((await c.post('/api/client-errors', { message: 'x', kind: 'error' })).status).toBe(429);
  });

  it('only accepts allow-listed product events', async () => {
    const t = await setup();
    const u = await t.as('demo-pm1');
    expect((await u.post('/api/events', { name: 'view_kanban' })).status).toBe(202);
    expect((await u.post('/api/events', { name: 'anything_else' })).status).toBe(422);
  });
});

describe('admin', () => {
  it('cannot remove their own admin role and cannot deactivate a PM with active projects', async () => {
    const t = await setup();
    const admin = await t.as('demo-admin');
    expect((await admin.put('/api/admin/users/demo-admin', { roles: ['pm'] })).status).toBe(422);
    expect((await admin.put('/api/admin/users/demo-pm1', { status: 'deactivated' })).status).toBe(
      412,
    );
    expect((await admin.put('/api/admin/users/demo-new', { roles: ['tech'] })).status).toBe(200);
    const audit = await admin.json(admin.get('/api/admin/audit'));
    expect(audit.entries.some((e: { action: string }) => e.action === 'admin.user_updated')).toBe(
      true,
    );
  });

  it('non-admins cannot reach admin endpoints', async () => {
    const t = await setup();
    const head = await t.as('demo-head');
    expect((await head.get('/api/admin/users')).status).toBe(403);
    expect((await head.get('/api/admin/config')).status).toBe(403);
  });

  it('revising a deadline through the API preserves the original', async () => {
    const t = await setup();
    const pm = await t.as('demo-pm1');
    const id = t.projects[0]!;
    const before = (await doc(t, id)).tasks.find((x) => x.id === 'T-0010')!;
    const res = await pm.patch(`/api/projects/${id}/tasks/T-0010`, {
      revisedEnd: addDays(before.plannedEnd, 7),
      revisionReason: 'Client holiday',
    });
    expect(res.status).toBe(200);
    const after = (await doc(t, id)).tasks.find((x) => x.id === 'T-0010')!;
    expect(after.plannedEnd).toBe(before.plannedEnd);
    expect(after.revisions).toHaveLength(1);
  });
});

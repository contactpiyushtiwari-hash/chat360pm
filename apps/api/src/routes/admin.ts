import {
  activePmProjects,
  adminUserUpdateSchema,
  canAdminister,
  DomainError,
  forbidden,
  invalid,
  notFound,
  orgConfigSchema,
  reviewDeactivation,
  type DirectoryUser,
} from '@chat360/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireUser, type AppContext, type AppEnv } from '../http/context';
import { runJob, JOB_NAMES, type JobName } from '../jobs/scheduled';

export const adminRoutes = new Hono<AppEnv>();

function requireAdmin(c: AppContext): DirectoryUser {
  const u = requireUser(c);
  if (!canAdminister(u)) throw forbidden('Administrator access is required.');
  return u;
}

adminRoutes.get('/users', async (c) => {
  requireAdmin(c);
  const d = await c.get('deps').repos.directory();
  return c.json({
    users: d.users.map(({ onboarding, ...u }) => ({
      ...u,
      onboardingComplete: !!onboarding.completedAt,
    })),
  });
});

adminRoutes.put('/users/:uid', async (c) => {
  const admin = requireAdmin(c);
  const input = await body(c, adminUserUpdateSchema);
  const deps = c.get('deps');
  const uid = c.req.param('uid');
  const now = deps.clock().toISOString();
  if (uid === admin.id && input.roles && !input.roles.includes('admin')) {
    throw invalid('You cannot remove your own administrator role.');
  }
  if (uid === admin.id && input.status === 'deactivated')
    throw invalid('You cannot deactivate your own account.');
  if (input.status === 'deactivated') {
    const owned = activePmProjects((await deps.repos.index(true)).projects, uid);
    if (owned.length) {
      throw new DomainError(
        'precondition_failed',
        'Transfer this user’s active projects to another PM first.',
        { projects: owned.map((p) => p.id) },
      );
    }
  }
  const { result } = await deps.repos.updateDirectory((d) => {
    const u = d.users.find((x) => x.id === uid);
    if (!u) throw notFound('User');
    const before = { roles: [...u.roles], status: u.status };
    if (input.roles) u.roles = [...new Set(input.roles)];
    if (input.status) u.status = input.status;
    u.updatedAt = now;
    return { before, after: { roles: u.roles, status: u.status } };
  });
  if (input.status === 'deactivated') await deps.sessions.deleteForUser(uid);
  await deps.repos.appendAudit({
    at: now,
    actor: admin.id,
    action: 'admin.user_updated',
    target: uid,
    details: result,
  });
  return c.json({ ok: true, ...result });
});

adminRoutes.get('/config', async (c) => {
  requireAdmin(c);
  return c.json({ config: await c.get('deps').repos.orgConfig() });
});

adminRoutes.put('/config', async (c) => {
  const admin = requireAdmin(c);
  const input = await body(c, orgConfigSchema);
  const deps = c.get('deps');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone });
  } catch {
    throw invalid('Unknown timezone.');
  }
  const now = deps.clock().toISOString();
  const { data } = await deps.repos.updateConfig((cfg) => {
    Object.assign(cfg, input, { updatedAt: now, updatedBy: admin.id });
  });
  await deps.repos.appendAudit({
    at: now,
    actor: admin.id,
    action: 'admin.config_updated',
    target: 'config',
    details: { disabledJobs: input.disabledJobs },
  });
  return c.json({ config: data });
});

adminRoutes.get('/account-requests', async (c) => {
  requireAdmin(c);
  const deps = c.get('deps');
  const [log, d] = await Promise.all([deps.repos.accounts(), deps.repos.directory()]);
  const nameOf = (id: string) => d.users.find((u) => u.id === id)?.displayName ?? id;
  return c.json({
    requests: log.requests
      .map((r) => ({ ...r, userName: nameOf(r.userId) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
});

adminRoutes.post('/account-requests/:rid/:decision{approve|reject}', async (c) => {
  const admin = requireAdmin(c);
  const { notes } = await body(c, z.object({ notes: z.string().max(2000).default('') }));
  const deps = c.get('deps');
  const decision = c.req.param('decision') as 'approve' | 'reject';
  const now = deps.clock().toISOString();
  const idx = await deps.repos.index(true);
  const { result: req } = await deps.repos.updateAccounts((log) =>
    reviewDeactivation(log, c.req.param('rid'), decision, notes, admin, idx.projects, now),
  );

  if (decision === 'reject') {
    await deps.repos.updateDirectory((d) => {
      const u = d.users.find((x) => x.id === req.userId);
      if (u?.status === 'deactivation_requested') u.status = 'active';
    });
  } else {
    // Execute the approved deactivation step by step, recording each outcome.
    const steps: Record<string, { ok: boolean; error?: string }> = {};
    try {
      await deps.sessions.deleteForUser(req.userId);
      steps.revoke_sessions = { ok: true };
    } catch (err) {
      steps.revoke_sessions = { ok: false, error: String(err) };
    }
    try {
      await deps.repos.updateDirectory((d) => {
        const u = d.users.find((x) => x.id === req.userId);
        if (u) {
          u.status = 'deactivated';
          u.updatedAt = now;
        }
      });
      steps.mark_deactivated = { ok: true };
    } catch (err) {
      steps.mark_deactivated = { ok: false, error: String(err) };
    }
    await deps.repos.updateAccounts((log) => {
      const r = log.requests.find((x) => x.id === req.id)!;
      for (const s of r.steps) {
        const o = steps[s.name];
        if (!o) continue;
        s.status = o.ok ? 'done' : 'failed';
        s.at = now;
        if (o.error) s.error = o.error;
      }
      if (r.steps.filter((s) => s.name in steps).every((s) => s.status === 'done')) {
        r.status = 'completed';
        r.completedAt = now;
      }
    });
  }
  await deps.repos.appendAudit({
    at: now,
    actor: admin.id,
    action: `account.deactivation_${decision}d`,
    target: req.id,
    details: { userId: req.userId },
  });
  return c.json({ request: (await deps.repos.accounts()).requests.find((r) => r.id === req.id) });
});

adminRoutes.get('/jobs', async (c) => {
  requireAdmin(c);
  const deps = c.get('deps');
  const config = await deps.repos.orgConfig();
  return c.json({
    jobs: JOB_NAMES,
    disabledJobs: config.disabledJobs,
    runs: await deps.coord.recentJobRuns(50),
  });
});

adminRoutes.post('/jobs/:name/run', async (c) => {
  const admin = requireAdmin(c);
  const name = c.req.param('name') as JobName;
  if (!JOB_NAMES.includes(name)) throw notFound('Job');
  const deps = c.get('deps');
  const run = await runJob(deps, name, `manual:${admin.id}`);
  return c.json({ run });
});

adminRoutes.get('/audit', async (c) => {
  requireAdmin(c);
  const month = c.req.query('month') ?? c.get('deps').clock().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw invalid('month must be YYYY-MM');
  return c.json({ month, entries: (await c.get('deps').repos.auditMonth(month)).entries });
});

/** Deep health for maintainers: storage reachability, mailer configuration, recent job outcomes. */
adminRoutes.get('/health', async (c) => {
  requireAdmin(c);
  const deps = c.get('deps');
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    await deps.repos.store.getJson('_system/config.json');
    checks.storage = { ok: true, detail: deps.config.storageBackend };
  } catch (err) {
    checks.storage = { ok: false, detail: String(err).slice(0, 200) };
  }
  checks.notificationMailbox = {
    ok: deps.mailer.configured,
    detail: deps.mailer.configured ? 'configured' : 'not configured',
  };
  const runs = await deps.coord.recentJobRuns(20);
  checks.recentJobs = {
    ok: runs.every((r) => r.ok),
    detail: `${runs.filter((r) => !r.ok).length} failed of ${runs.length}`,
  };
  return c.json({
    ok: Object.values(checks).every((x) => x.ok),
    checks,
    release: deps.config.release,
  });
});

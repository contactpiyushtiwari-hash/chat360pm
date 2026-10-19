import {
  activePmProjects,
  cancelDeactivation,
  deactivationRequestSchema,
  hasGlobalRole,
  requestDeactivation,
} from '@chat360/core';
import { Hono } from 'hono';
import { body, limit, requireUser, type AppEnv } from '../http/context';
import { requireRecentAuth } from './auth';

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get('/deactivation', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const [log, idx] = await Promise.all([deps.repos.accounts(), deps.repos.index()]);
  const mine = log.requests
    .filter((r) => r.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({
    requests: mine,
    activePmProjects: activePmProjects(idx.projects, user.id).map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
    })),
  });
});

/**
 * Deactivation request. Requires a sign-in within the last 15 minutes and typed confirmation.
 * Never deletes workbooks, client documents, or the Microsoft identity (PRD-ACCT-001..006).
 */
accountRoutes.post('/deactivation', async (c) => {
  const user = requireUser(c);
  requireRecentAuth(c);
  const deps = c.get('deps');
  await limit(c, `deactivation:${user.id}`, 5, 3600);
  const input = await body(c, deactivationRequestSchema);
  const idx = await deps.repos.index(true);
  const now = deps.clock().toISOString();
  const { result } = await deps.repos.updateAccounts((log) =>
    requestDeactivation(log, user, input, idx.projects, now),
  );
  await deps.repos.updateDirectory((d) => {
    const u = d.users.find((x) => x.id === user.id);
    if (u && u.status === 'active') u.status = 'deactivation_requested';
  });
  await deps.repos.appendAudit({
    at: now,
    actor: user.id,
    action: 'account.deactivation_requested',
    target: result.id,
    details: { activePmProjects: result.activePmProjects },
  });
  // Tell the Delivery Head when projects would otherwise be orphaned.
  if (result.activePmProjects.length) {
    const directory = (await deps.repos.directory()).users;
    const heads = directory.filter(
      (u) => u.status === 'active' && hasGlobalRole(u, 'delivery_head'),
    );
    const to = heads.map((h) => h.email).filter(Boolean);
    const outcome = !to.length
      ? ({
          status: 'failed',
          error: 'No active Delivery and Operations Head is configured.',
          retryable: false,
        } as const)
      : await deps.mailer
          .send({
            to,
            subject: `[Chat360 Ops] Deactivation requested by a PM with ${result.activePmProjects.length} active project(s)`,
            body: `${user.displayName} requested account deactivation. Their active projects need a new PM before the request can be approved:\n\n${result.activePmProjects.join('\n')}\n\nReview: ${deps.config.appOrigin}/transfers`,
          })
          .catch((err) => ({ status: 'failed' as const, error: String(err), retryable: true }));
    await deps.repos.updateAccounts((log) => {
      const r = log.requests.find((x) => x.id === result.id)!;
      r.steps.push({
        name: 'notify_delivery_head',
        status: outcome.status === 'accepted' ? 'done' : 'failed',
        at: now,
        ...(outcome.status !== 'accepted'
          ? { error: outcome.status === 'failed' ? outcome.error : outcome.reason }
          : {}),
      });
    });
  }
  deps.analytics.track('account_deactivation_requested', { outcome: result.status });
  return c.json({ request: result }, 201);
});

accountRoutes.post('/deactivation/:rid/cancel', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const now = deps.clock().toISOString();
  const { result } = await deps.repos.updateAccounts((log) =>
    cancelDeactivation(log, c.req.param('rid'), user, now),
  );
  await deps.repos.updateDirectory((d) => {
    const u = d.users.find((x) => x.id === user.id);
    if (u && u.status === 'deactivation_requested') u.status = 'active';
  });
  return c.json({ request: result });
});

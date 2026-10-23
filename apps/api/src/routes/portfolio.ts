import {
  accessSubjectOf,
  can,
  addDays,
  canViewPortfolio,
  computeAnalytics,
  currentDue,
  isOpen,
  projectAccess,
  tasksNeedingDecision,
  type Project,
} from '@chat360/core';
import { Hono } from 'hono';
import { domainContext, mapLimit } from '../deps';
import { requireUser, type AppEnv } from '../http/context';

export const portfolioRoutes = new Hono<AppEnv>();

const MAX_PROJECT_READS = 300;

/** My Tasks Today: tasks I own that are due today or overdue, plus the next few days. */
portfolioRoutes.get('/today', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const idx = await deps.repos.index();
  const mine = idx.projects
    .filter((p) => p.taskOwnerIds.includes(user.id) && p.status === 'active')
    .slice(0, 60);
  const docs = await mapLimit(mine, 6, (p) => deps.repos.project(p.id));
  const horizon = addDays(ctx.today, 7);
  const due: unknown[] = [];
  const upcoming: unknown[] = [];
  for (const p of docs) {
    if (!p) continue;
    const head = {
      projectId: p.id,
      projectName: p.name,
      clientName: p.clientName,
    };
    for (const t of tasksNeedingDecision(p, user.id, ctx.today)) {
      due.push({ ...head, task: t, due: currentDue(t), overdue: currentDue(t) < ctx.today });
    }
    for (const t of p.tasks.filter(
      (t) =>
        t.ownerId === user.id && isOpen(t) && currentDue(t) > ctx.today && currentDue(t) <= horizon,
    )) {
      upcoming.push({ ...head, task: t, due: currentDue(t) });
    }
  }
  return c.json({ today: ctx.today, due, upcoming, delayReasons: ctx.config.delayReasons });
});

portfolioRoutes.get('/escalations', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const idx = await deps.repos.index();
  const head = canViewPortfolio(user);
  const items = idx.projects.flatMap((p) =>
    p.openEscalations
      .filter((e) => head || e.managerId === user.id || e.ownerId === user.id || p.pmId === user.id)
      .filter(() => projectAccess(user, accessSubjectOf(p), ctx.today) !== 'none')
      .map((e) => ({ ...e, projectId: p.id, projectName: p.name, clientName: p.clientName })),
  );
  items.sort((a, b) => a.triggeredAt.localeCompare(b.triggeredAt));
  return c.json({ escalations: items });
});

portfolioRoutes.get('/transfers', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const idx = await deps.repos.index();
  const head = canViewPortfolio(user);
  const items = idx.projects.flatMap((p) =>
    p.transfers
      .filter(
        (t) => head || [t.fromPmId, t.requestedBy, t.newPmId, t.proposedPmId].includes(user.id),
      )
      .map((t) => ({
        ...t,
        projectId: p.id,
        projectName: p.name,
        clientName: p.clientName,
        currentPmId: p.pmId,
      })),
  );
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ transfers: items, canReview: head });
});

/**
 * Delivery analytics. The Delivery Head sees the portfolio; everyone else sees projects where
 * they are PM or a team member (PRD-ANALYTICS-002).
 */
portfolioRoutes.get('/analytics', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const portfolio = canViewPortfolio(user);
  const idx = await deps.repos.index();
  const scoped = idx.projects.filter((p) => {
    const a = projectAccess(user, accessSubjectOf(p), ctx.today);
    return portfolio ? a !== 'none' : a === 'manager' || p.memberIds.includes(user.id);
  });
  const truncated = scoped.length > MAX_PROJECT_READS;
  const docs = (
    await mapLimit(scoped.slice(0, MAX_PROJECT_READS), 6, (p) => deps.repos.project(p.id))
  ).filter((p): p is Project => !!p);
  const directory = await deps.repos.directory();
  return c.json({
    scope: portfolio ? 'portfolio' : 'mine',
    truncated,
    analytics: computeAnalytics(docs, ctx.today, ctx.config, directory.users, 4, (p) =>
      can(user, 'finance.view', accessSubjectOf(p), ctx.today),
    ),
  });
});

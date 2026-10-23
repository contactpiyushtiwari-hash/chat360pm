import {
  accessSubjectOf,
  acknowledgeEscalation,
  addApiDependency,
  addComment,
  apiDependencySchema,
  buildHandoverSummary,
  canCreateProject,
  commentSchema,
  confirmTask,
  confirmTaskSchema,
  createProject,
  createProjectSchema,
  createTask,
  createTaskSchema,
  escalationActionSchema,
  forbidden,
  indexEntryOf,
  projectAccess,
  resolveEscalation,
  resolveEscalationSchema,
  updateApiDependency,
  updateApiDependencySchema,
  updateProject,
  updateProjectSchema,
  updateTask,
  updateTaskSchema,
  updateTeam,
  updateTeamSchema,
  updateFinance,
  updateFinanceSchema,
  can,
  PROJECT_TEMPLATES,
} from '@chat360/core';
import { Hono } from 'hono';
import { generateTracker } from '@chat360/core/workbook';
import { domainContext, nameResolver } from '../deps';
import { body, idempotencyKey, limit, requireUser, type AppEnv } from '../http/context';
import { loadProject, mutateProject, presentProject, redactFinance } from './project-helpers';

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get('/templates', async (c) => {
  requireUser(c);
  const config = await c.get('deps').repos.orgConfig();
  return c.json({
    templates: PROJECT_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      taskCount: t.tasks.length,
    })),
    categories: config.projectCategories,
    destinations: config.destinations.map((d) => ({ id: d.id, label: d.label })),
  });
});

projectRoutes.get('/', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const idx = await deps.repos.index();
  const projects = idx.projects
    .map((p) => ({ ...p, access: projectAccess(user, accessSubjectOf(p), ctx.today) }))
    .filter((p) => p.access !== 'none')
    .map(({ transfers: _t, openEscalations: _e, ...p }) => p)
    .sort((a, b) => a.targetGoLive.localeCompare(b.targetGoLive));
  return c.json({ projects, canCreate: canCreateProject(user) });
});

projectRoutes.post('/', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  await limit(c, `create-project:${user.id}`, 20, 3600);
  const key = idempotencyKey(c, true)!;
  const input = await body(c, createProjectSchema);
  const ctx = await domainContext(deps, user);
  if (!canCreateProject(user))
    throw forbidden('Only Project Managers and the Delivery Head can create projects.');

  // A retried submission (same key) returns the project created by the first attempt.
  const memoKey = `create-project:${user.id}:${key}`;
  const prior = await deps.coord.remember(memoKey, 'pending', 600);
  if (prior === 'pending') {
    return c.json(
      {
        error: {
          code: 'in_progress',
          message: 'This project is already being created. Refresh in a moment.',
          requestId: c.get('requestId'),
        },
      },
      409,
    );
  }
  if (prior) {
    const existing = await deps.repos.project(prior);
    if (existing)
      return c.json({ project: presentProject(existing, user, ctx.today), replayed: true }, 200);
  }

  let project;
  try {
    const directory = await deps.repos.directory();
    project = createProject(input, ctx, {
      findUser: (id) => directory.users.find((u) => u.id === id),
    });
    await deps.repos.createProject(project);
    await deps.repos.upsertIndexEntry(indexEntryOf(project, ctx.today));
  } catch (err) {
    await deps.coord.forget(memoKey);
    throw err;
  }
  await deps.coord.store(memoKey, project.id, 24 * 3600);
  deps.analytics.track('project_created', { projectId: project.id, role: user.roles[0] ?? '' });
  return c.json({ project: presentProject(project, user, ctx.today) }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const { project, ctx } = await loadProject(c, c.req.param('id'));
  return c.json({ project: presentProject(project, ctx.actor, ctx.today) });
});

projectRoutes.patch('/:id', async (c) => {
  const input = await body(c, updateProjectSchema);
  const { project, ctx } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    updateProject(p, input, ctx),
  );
  return c.json({ project: presentProject(project, ctx.actor, ctx.today) });
});

projectRoutes.put('/:id/finance', async (c) => {
  const input = await body(c, updateFinanceSchema);
  const { project, ctx } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    updateFinance(p, input, ctx),
  );
  c.get('deps').analytics.track('finance_updated', { projectId: project.id });
  return c.json({ project: presentProject(project, ctx.actor, ctx.today) });
});

projectRoutes.put('/:id/team', async (c) => {
  const input = await body(c, updateTeamSchema);
  const directory = await c.get('deps').repos.directory();
  const findUser = (id: string) => directory.users.find((u) => u.id === id);
  const { project, result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    updateTeam(p, input, ctx, findUser),
  );
  return c.json({ team: project.team, changes: result });
});

projectRoutes.get('/:id/history', async (c) => {
  const loaded = await loadProject(c, c.req.param('id'));
  const project = redactFinance(loaded.project, loaded.ctx.actor, loaded.ctx.today);
  return c.json({
    teamHistory: project.teamHistory,
    transfers: project.transfers,
    audit: project.audit.slice(-500),
  });
});

projectRoutes.get('/:id/handover', async (c) => {
  const { project, ctx } = await loadProject(c, c.req.param('id'), 'manager');
  return c.json({ handover: buildHandoverSummary(project, ctx.today, ctx.now) });
});

// Tasks
projectRoutes.post('/:id/tasks', async (c) => {
  const key = idempotencyKey(c, true);
  const input = await body(c, createTaskSchema);
  const { project, result, replayedRef } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => createTask(p, input, ctx),
    { idempotencyKey: key },
  );
  const task = result ?? project.tasks.find((t) => t.id === replayedRef);
  if (result) c.get('deps').analytics.track('task_created', { projectId: project.id });
  return c.json({ task, replayed: !result }, result ? 201 : 200);
});

projectRoutes.patch('/:id/tasks/:taskId', async (c) => {
  const input = await body(c, updateTaskSchema);
  const { result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    updateTask(p, c.req.param('taskId'), input, ctx),
  );
  return c.json({ task: result });
});

projectRoutes.post('/:id/tasks/:taskId/comments', async (c) => {
  const input = await body(c, commentSchema);
  const { result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    addComment(p, c.req.param('taskId'), input.body, input.evidenceUrl, ctx),
  );
  return c.json({ comment: result }, 201);
});

projectRoutes.post('/:id/tasks/:taskId/confirm', async (c) => {
  const input = await body(c, confirmTaskSchema);
  const deps = c.get('deps');
  const { project, result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    confirmTask(p, c.req.param('taskId'), input, ctx),
  );
  if (result && !result.replayed) {
    deps.analytics.track('task_confirmed', { projectId: project.id, outcome: input.outcome });
    if (result.escalation)
      deps.analytics.track('escalation_created', {
        projectId: project.id,
        outcome: result.escalation.type,
      });
  }
  return c.json({
    confirmation: result?.confirmation,
    escalation: result?.escalation ?? null,
    task: project.tasks.find((t) => t.id === c.req.param('taskId')),
  });
});

// API dependencies
projectRoutes.post('/:id/apis', async (c) => {
  const key = idempotencyKey(c, true);
  const input = await body(c, apiDependencySchema);
  const { project, result, replayedRef } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => addApiDependency(p, input, ctx),
    { idempotencyKey: key },
  );
  return c.json(
    { api: result ?? project.apis.find((a) => a.id === replayedRef) },
    result ? 201 : 200,
  );
});

projectRoutes.patch('/:id/apis/:apiId', async (c) => {
  const input = await body(c, updateApiDependencySchema);
  const { result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    updateApiDependency(p, c.req.param('apiId'), input, ctx),
  );
  return c.json({ api: result });
});

// Escalations
projectRoutes.post('/:id/escalations/:escId/acknowledge', async (c) => {
  await body(c, escalationActionSchema);
  const { result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    acknowledgeEscalation(p, c.req.param('escId'), ctx),
  );
  return c.json({ escalation: result });
});

projectRoutes.post('/:id/escalations/:escId/resolve', async (c) => {
  const input = await body(c, resolveEscalationSchema);
  const { project, result } = await mutateProject(c, c.req.param('id'), (p, ctx) =>
    resolveEscalation(p, c.req.param('escId'), input.notes, ctx),
  );
  c.get('deps').analytics.track('escalation_resolved', { projectId: project.id });
  return c.json({ escalation: result });
});

/** The Excel tracker, generated on demand from the current project (ADR-021). */
projectRoutes.get('/:id/tracker.xlsx', async (c) => {
  const { project, ctx } = await loadProject(c, c.req.param('id'));
  if (!can(ctx.actor, 'tracker.download', accessSubjectOf(project), ctx.today)) throw forbidden();
  const deps = c.get('deps');
  await limit(c, `tracker:${ctx.actor.id}`, 30, 600);
  const directory = await deps.repos.directory();
  const bytes = generateTracker(redactFinance(project, ctx.actor, ctx.today), {
    config: ctx.config,
    today: ctx.today,
    nameOf: nameResolver(directory.users),
    generatedAt: ctx.now,
  });
  const name = `${project.clientName} - ${project.name} - Tracker.xlsx`.replace(/[^\w .-]+/g, '_');
  deps.analytics.track('tracker_downloaded', { projectId: project.id });
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
});

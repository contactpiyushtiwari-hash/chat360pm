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
  invalid,
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
  can,
  PROJECT_TEMPLATES,
  recordAudit,
} from '@chat360/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { domainContext } from '../deps';
import { body, idempotencyKey, limit, requireUser, type AppEnv } from '../http/context';
import { createWorkbook, syncWorkbook } from '../services/workbook';
import { loadProject, mutateProject, presentProject } from './project-helpers';

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

  // Workbook generation is part of creation; its failure is reported, not hidden, and can be retried.
  const workbook = await createWorkbook(deps, project.id);
  const saved = (await deps.repos.project(project.id)) ?? project;
  return c.json({ project: presentProject(saved, user, ctx.today), workbook }, 201);
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
  const { project } = await loadProject(c, c.req.param('id'));
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
  const { result } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => addComment(p, c.req.param('taskId'), input.body, input.evidenceUrl, ctx),
    { skipSync: true },
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
    workbook: { state: project.workbook.driveItemId ? 'pending' : project.workbook.state },
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

// Workbook
projectRoutes.post('/:id/workbook', async (c) => {
  const { project, ctx } = await loadProject(c, c.req.param('id'), 'contributor');
  if (!can(ctx.actor, 'workbook.sync', accessSubjectOf(project), ctx.today)) throw forbidden();
  await limit(c, `workbook:${project.id}`, 10, 600);
  const outcome = await createWorkbook(c.get('deps'), project.id);
  return c.json({ workbook: outcome }, outcome.status === 'failed' ? 502 : 200);
});

projectRoutes.post('/:id/workbook/sync', async (c) => {
  const { project, ctx } = await loadProject(c, c.req.param('id'), 'contributor');
  if (!can(ctx.actor, 'workbook.sync', accessSubjectOf(project), ctx.today)) throw forbidden();
  await limit(c, `workbook:${project.id}`, 10, 600);
  const outcome = await syncWorkbook(c.get('deps'), project.id, { refresh: true });
  return c.json({ workbook: outcome }, outcome.status === 'failed' ? 502 : 200);
});

projectRoutes.post('/:id/workbook/conflicts/resolve', async (c) => {
  const { keys } = await body(
    c,
    z.object({
      keys: z.array(z.string().max(120)).min(1).max(200),
      resolution: z.literal('use_app'),
    }),
  );
  const { project, ctx } = await loadProject(c, c.req.param('id'), 'manager');
  if (!can(ctx.actor, 'workbook.resolve_conflict', accessSubjectOf(project), ctx.today))
    throw forbidden();
  const known = new Set(project.workbook.conflicts.map((x) => x.key));
  if (keys.some((k) => !known.has(k))) throw invalid('Unknown conflict.');
  const outcome = await syncWorkbook(c.get('deps'), project.id, { force: keys });
  await c.get('deps').repos.updateProject(project.id, (p) => {
    recordAudit(p, ctx.actor.id, ctx.now, 'workbook.conflicts_overwritten', project.id, { keys });
  });
  return c.json({ workbook: outcome });
});

import {
  accessSubjectOf,
  EMAIL_TEMPLATES,
  notFound,
  projectAccess,
  renderTemplate,
  summarizeProject,
  templateVars,
} from '@chat360/core';
import { Hono } from 'hono';
import { domainContext } from '../deps';
import { requireUser, type AppEnv } from '../http/context';

export const emailRoutes = new Hono<AppEnv>();

/** Filled-in email drafts. The browser hands them to the employee's own mail app; nothing is sent here. */
emailRoutes.get('/templates', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const projectId = c.req.query('projectId');
  const project = projectId ? await deps.repos.project(projectId) : null;
  if (
    projectId &&
    (!project || projectAccess(user, accessSubjectOf(project), ctx.today) === 'none')
  )
    throw notFound('Project');
  const vars = templateVars(
    project,
    user.displayName,
    project ? summarizeProject(project, ctx.today) : undefined,
  );
  return c.json({
    templates: EMAIL_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      audience: t.audience,
      subject: renderTemplate(t.subject, vars),
      body: renderTemplate(t.body, vars),
    })),
  });
});

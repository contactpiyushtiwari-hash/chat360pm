import {
  accessSubjectOf,
  canAdminister,
  canViewSupport,
  createSupportRequest,
  invalid,
  notFound,
  projectAccess,
  supportCreateSchema,
  supportUpdateSchema,
  todayIn,
  updateSupportRequest,
} from '@chat360/core';
import { Hono } from 'hono';
import { body, limit, requireUser, type AppEnv } from '../http/context';

export const supportRoutes = new Hono<AppEnv>();

supportRoutes.get('/', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const [log, config] = await Promise.all([deps.repos.support(), deps.repos.orgConfig()]);
  const requests = log.requests
    .filter((r) => canViewSupport(user, r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ requests, isSupportOwner: canAdminister(user), contact: config.supportContact });
});

supportRoutes.get('/:sid', async (c) => {
  const user = requireUser(c);
  const r = (await c.get('deps').repos.support()).requests.find((x) => x.id === c.req.param('sid'));
  if (!r || !canViewSupport(user, r)) throw notFound('Support request');
  return c.json({ request: r });
});

supportRoutes.post('/', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  await limit(c, `support:${user.id}`, 10, 3600);
  const input = await body(c, supportCreateSchema);
  if (input.projectId) {
    // A project may only be referenced by someone who can see it.
    const config = await deps.repos.orgConfig();
    const entry = await deps.repos.indexEntry(input.projectId);
    if (
      !entry ||
      projectAccess(user, accessSubjectOf(entry), todayIn(config.timezone, deps.clock())) === 'none'
    ) {
      throw invalid('Unknown project.');
    }
  }
  const now = deps.clock().toISOString();
  const { result } = await deps.repos.updateSupport((log) =>
    createSupportRequest(log, input, user, now),
  );
  deps.analytics.track('support_request_created', { outcome: input.category });
  return c.json({ request: result }, 201);
});

supportRoutes.patch('/:sid', async (c) => {
  const user = requireUser(c);
  const input = await body(c, supportUpdateSchema);
  const deps = c.get('deps');
  const now = deps.clock().toISOString();
  const { result } = await deps.repos.updateSupport((log) =>
    updateSupportRequest(log, c.req.param('sid'), input, user, now),
  );
  return c.json({ request: result });
});

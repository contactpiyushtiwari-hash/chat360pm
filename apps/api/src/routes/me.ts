import {
  applyOnboardingUpdate,
  canAdminister,
  canCreateProject,
  canViewPortfolio,
  onboardingStatus,
  onboardingUpdateSchema,
} from '@chat360/core';
import { Hono } from 'hono';
import { domainContext } from '../deps';
import { body, requireUser, type AppEnv } from '../http/context';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/me', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      status: user.status,
    },
    permissions: {
      createProject: canCreateProject(user),
      portfolio: canViewPortfolio(user),
      admin: canAdminister(user),
    },
    onboarding: onboardingStatus(user),
    environment: deps.config.environment,
    devAuth: deps.config.devAuth,
    notificationsConfigured: deps.mailer.configured,
    supportContact: ctx.config.supportContact,
    timezone: ctx.config.timezone,
    today: ctx.today,
    release: deps.config.release,
  });
});

meRoutes.patch('/me/onboarding', async (c) => {
  const user = requireUser(c);
  const input = await body(c, onboardingUpdateSchema);
  const deps = c.get('deps');
  const now = deps.clock().toISOString();
  const wasComplete = !!user.onboarding.completedAt;
  const { result } = await deps.repos.updateDirectory((d) => {
    const u = d.users.find((x) => x.id === user.id)!;
    return applyOnboardingUpdate(u, input.completeSteps, input.skipSteps, now);
  });
  if (result.complete && !wasComplete)
    deps.analytics.track('onboarding_completed', { role: user.roles[0] ?? 'none' });
  return c.json({ onboarding: result });
});

/** Colleague picker data: active employees only, minimal fields. */
meRoutes.get('/directory/users', async (c) => {
  requireUser(c);
  const d = await c.get('deps').repos.directory();
  return c.json({
    users: d.users
      .filter((u) => u.status !== 'deactivated')
      .map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, roles: u.roles }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  });
});

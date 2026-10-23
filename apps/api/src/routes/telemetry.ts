import { clientErrorSchema, productEventSchema } from '@chat360/core';
import { Hono } from 'hono';
import { sha256Hex } from '../auth/crypto';
import { body, clientIp, limit, requireUser, type AppEnv } from '../http/context';
import { redactText } from '../observability/redact';

export const telemetryRoutes = new Hono<AppEnv>();

telemetryRoutes.get('/health', (c) => {
  const deps = c.get('deps');
  return c.json({
    status: 'ok',
    environment: deps.config.environment,
    release: deps.config.release,
  });
});

/** Frontend crash reports. Accepted before sign-in too, so rate-limited per IP; content is redacted. */
telemetryRoutes.post('/client-errors', async (c) => {
  await limit(c, `client-errors:${clientIp(c)}`, 30, 60);
  const input = await body(c, clientErrorSchema);
  const errorId = `CLI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  c.get('log').error('client_error', {
    errorId,
    kind: input.kind,
    message: redactText(input.message, 500),
    // Keep only stack frame locations, not values.
    frames: input.stack
      ?.split('\n')
      .slice(0, 8)
      .map((l) => redactText(l.trim(), 200)),
    route: input.route?.replace(/[?#].*$/, ''),
    release: input.release,
    userId: c.get('user')?.id,
  });
  return c.json({ errorId }, 202);
});

/** Product usage events from the web app: allow-listed names and primitive props only. */
telemetryRoutes.post('/events', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  await limit(c, `events:${user.id}`, 120, 60);
  const input = await body(c, productEventSchema);
  // User ids are random UUIDs, so an unkeyed hash is enough to keep them out of analytics.
  const userHash = (await sha256Hex(`analytics-user-v1:${user.id}`)).slice(0, 16);
  deps.analytics.track(input.name, {
    userHash,
    role: user.roles[0] ?? 'none',
    outcome: String(input.props.outcome ?? ''),
  });
  return c.json({ ok: true }, 202);
});

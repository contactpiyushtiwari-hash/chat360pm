import { Hono } from 'hono';
import type { Deps } from './deps';
import type { AppEnv } from './http/context';
import { csrfGuard, errorHandler, loadSession, requestContext } from './http/middleware';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { authRoutes, registerDevAuth } from './routes/auth';
import { emailRoutes } from './routes/email';
import { meRoutes } from './routes/me';
import { portfolioRoutes } from './routes/portfolio';
import { projectRoutes } from './routes/projects';
import { supportRoutes } from './routes/support';
import { telemetryRoutes } from './routes/telemetry';
import { transferRoutes } from './routes/transfers';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requestContext);
  app.use('/api/*', csrfGuard);
  app.use('/api/*', loadSession);
  app.onError(errorHandler);

  registerDevAuth(app, deps);
  app.route('/api/auth', authRoutes);
  app.route('/api', telemetryRoutes);
  app.route('/api', meRoutes);
  app.route('/api/projects', projectRoutes);
  app.route('/api/projects', transferRoutes);
  app.route('/api', portfolioRoutes);
  app.route('/api/support', supportRoutes);
  app.route('/api/account', accountRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/email', emailRoutes);

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'not_found',
          message: 'No such endpoint.',
          requestId: c.get('requestId') ?? 'unknown',
        },
      },
      404,
    ),
  );
  return app;
}

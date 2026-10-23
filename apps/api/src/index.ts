import type { Deps } from './deps';
import { ConfigError, loadConfig, type Env } from './env';
import { createApp } from './app';
import { coordinatorStub, DurableCoordination, DurableSessionStore } from './do/coordinator';
import { jobsForCron, runJob } from './jobs/scheduled';
import { analyticsEngineSink, createLogger } from './observability/log';
import { NotConfiguredMailer } from './services/notifications';
import { D1DocStore } from './store/d1-store';
import { ReadCache, Repos } from './store/repos';

export { Coordinator } from './do/coordinator';

let cached: { deps: Deps; app: ReturnType<typeof createApp> } | null = null;

/** Builds production dependencies once per isolate. Config errors fail closed with a 503. */
function build(env: Env) {
  if (cached) return cached;
  const config = loadConfig(env);
  if (config.storageBackend !== 'd1') {
    throw new ConfigError(
      'The Worker runtime requires D1 storage; use the dev server for in-memory mode.',
    );
  }
  if (!env.DB) throw new ConfigError('The D1 binding DB is missing (see docs/deployment.md).');
  const log = createLogger({
    service: 'chat360-ops-api',
    env: config.environment,
    release: config.release,
  });
  const stub = coordinatorStub(env.COORDINATOR);
  const deps: Deps = {
    config,
    repos: new Repos(new D1DocStore(env.DB), new ReadCache()),
    sessions: new DurableSessionStore(stub),
    coord: new DurableCoordination(stub),
    mailer: new NotConfiguredMailer(),
    analytics: analyticsEngineSink(env.ANALYTICS, log),
    log,
    clock: () => new Date(),
    pending: [],
  };
  cached = { deps, app: createApp(deps) };
  return cached;
}

function configFailure(err: unknown) {
  console.error(JSON.stringify({ level: 'error', msg: 'configuration_error', error: String(err) }));
  return Response.json(
    {
      error: {
        code: 'service_misconfigured',
        message:
          'The service is not configured correctly. Administrators have been notified in the logs.',
      },
    },
    { status: 503 },
  );
}

export default {
  async fetch(request, env, ctx) {
    let built;
    try {
      built = build(env);
    } catch (err) {
      return configFailure(err);
    }
    return built.app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    let built;
    try {
      built = build(env);
    } catch (err) {
      configFailure(err);
      return;
    }
    for (const job of jobsForCron(controller.cron)) {
      ctx.waitUntil(runJob(built.deps, job, `cron:${controller.cron}`));
    }
  },
} satisfies ExportedHandler<Env>;

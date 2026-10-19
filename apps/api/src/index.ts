import { createOidcClient } from './auth/oidc';
import type { Deps } from './deps';
import { ConfigError, loadConfig, type Env } from './env';
import { createApp } from './app';
import { coordinatorStub, DurableCoordination, DurableSessionStore } from './do/coordinator';
import { GraphClient } from './graph/client';
import { GraphDocStore } from './graph/drive-store';
import { GraphMailer, NotConfiguredMailer } from './graph/mailer';
import { appTokenProvider } from './graph/tokens';
import { GraphUserGraph } from './graph/user-graph';
import { GraphWorkbookGateway } from './graph/workbook';
import { jobsForCron, runJob } from './jobs/scheduled';
import { analyticsEngineSink, createLogger } from './observability/log';
import { ReadCache, Repos } from './store/repos';

export { Coordinator } from './do/coordinator';

let cached: { deps: Deps; app: ReturnType<typeof createApp> } | null = null;

/** Builds production dependencies once per isolate. Config errors fail closed with a 503. */
function build(env: Env) {
  if (cached) return cached;
  const config = loadConfig(env);
  if (config.storageBackend !== 'graph' || !config.graph || !config.entra) {
    throw new ConfigError(
      'The Worker runtime requires Microsoft Graph storage; use the dev server for in-memory mode.',
    );
  }
  const log = createLogger({
    service: 'chat360-ops-api',
    env: config.environment,
    release: config.release,
  });
  const appGraph = new GraphClient({ token: appTokenProvider(config.entra), log });
  const stub = coordinatorStub(env.COORDINATOR);
  const deps: Deps = {
    config,
    repos: new Repos(
      new GraphDocStore(appGraph, config.graph.driveId, config.graph.rootPath),
      new ReadCache(),
    ),
    workbooks: new GraphWorkbookGateway(appGraph, config.graph.driveId),
    sessions: new DurableSessionStore(stub),
    coord: new DurableCoordination(stub),
    mailer: config.notificationMailbox
      ? new GraphMailer(appGraph, config.notificationMailbox)
      : new NotConfiguredMailer(),
    userGraphFor: (token) => new GraphUserGraph(new GraphClient({ token: async () => token, log })),
    oidc: createOidcClient({
      ...config.entra,
      redirectUri: `${config.appOrigin}/api/auth/callback`,
    }),
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

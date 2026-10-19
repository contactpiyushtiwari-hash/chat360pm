import type { Deps } from '../src/deps';
import { loadConfig, type Env } from '../src/env';
import { createLogger, MemoryAnalytics } from '../src/observability/log';
import type { Logger } from '../src/ports';
import {
  FakeUserGraph,
  MemoryCoordination,
  MemoryDocStore,
  MemorySessionStore,
  MemoryWorkbookGateway,
  RecordingMailer,
} from '../src/store/memory';
import { ReadCache, Repos } from '../src/store/repos';

// Fixed, obviously non-production keys for local development and tests only.
export const DEV_KEY = btoa(String.fromCharCode(...new Array(32).fill(7)));

export interface MemoryDeps extends Deps {
  store: MemoryDocStore;
  workbookGateway: MemoryWorkbookGateway;
  sessionStore: MemorySessionStore;
  coordination: MemoryCoordination;
  recordingMailer: RecordingMailer;
  userGraph: FakeUserGraph;
  analyticsSink: MemoryAnalytics;
  settle(): Promise<void>;
}

export function memoryDeps(
  opts: { env?: Partial<Env>; clock?: () => Date; log?: Logger; mailerConfigured?: boolean } = {},
): MemoryDeps {
  const config = loadConfig({
    ENVIRONMENT: 'development',
    DEV_AUTH: 'enabled',
    STORAGE_BACKEND: 'memory',
    APP_ORIGIN: 'http://localhost:5173',
    ALLOWED_EMAIL_DOMAINS: 'chat.io',
    TOKEN_ENCRYPTION_KEY: DEV_KEY,
    COOKIE_SECRET: DEV_KEY,
    ...opts.env,
  });
  const store = new MemoryDocStore();
  const workbookGateway = new MemoryWorkbookGateway(store);
  const sessionStore = new MemorySessionStore();
  const coordination = new MemoryCoordination();
  const recordingMailer = new RecordingMailer(opts.mailerConfigured ?? true);
  const userGraph = new FakeUserGraph();
  const analyticsSink = new MemoryAnalytics();
  const pending: Promise<unknown>[] = [];
  const clock = opts.clock ?? (() => new Date());
  const deps: MemoryDeps = {
    config,
    repos: new Repos(store, new ReadCache(() => clock().getTime())),
    workbooks: workbookGateway,
    sessions: sessionStore,
    coord: coordination,
    mailer: recordingMailer,
    userGraphFor: () => userGraph,
    oidc: null,
    analytics: analyticsSink,
    log: opts.log ?? createLogger({ service: 'chat360-ops-api', env: 'dev' }, () => undefined),
    clock,
    pending,
    store,
    workbookGateway,
    sessionStore,
    coordination,
    recordingMailer,
    userGraph,
    analyticsSink,
    async settle() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
  return deps;
}

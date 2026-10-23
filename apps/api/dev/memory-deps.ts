import type { Deps } from '../src/deps';
import { loadConfig, type Env } from '../src/env';
import { createLogger, MemoryAnalytics } from '../src/observability/log';
import type { Logger } from '../src/ports';
import {
  MemoryCoordination,
  MemoryDocStore,
  MemorySessionStore,
  RecordingMailer,
} from '../src/store/memory';
import { ReadCache, Repos } from '../src/store/repos';

export interface MemoryDeps extends Deps {
  store: MemoryDocStore;
  sessionStore: MemorySessionStore;
  coordination: MemoryCoordination;
  recordingMailer: RecordingMailer;
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
    SETUP_CODE: 'dev-setup-code',
    ...opts.env,
  });
  const store = new MemoryDocStore();
  const sessionStore = new MemorySessionStore();
  const coordination = new MemoryCoordination();
  const recordingMailer = new RecordingMailer(opts.mailerConfigured ?? true);
  const analyticsSink = new MemoryAnalytics();
  const pending: Promise<unknown>[] = [];
  const clock = opts.clock ?? (() => new Date());
  const deps: MemoryDeps = {
    config,
    repos: new Repos(store, new ReadCache(() => clock().getTime())),
    sessions: sessionStore,
    coord: coordination,
    mailer: recordingMailer,
    analytics: analyticsSink,
    log: opts.log ?? createLogger({ service: 'chat360-ops-api', env: 'dev' }, () => undefined),
    clock,
    pending,
    store,
    sessionStore,
    coordination,
    recordingMailer,
    analyticsSink,
    async settle() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
  return deps;
}

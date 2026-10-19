/**
 * Local development server: the real Hono app with in-memory adapters and developer sign-in.
 * No Microsoft 365 calls are made; emails and calendar actions are recorded, not sent.
 * Use `pnpm --filter @chat360/api dev:worker` with .dev.vars to run against a real tenant.
 */
import { serve } from '@hono/node-server';
import { createApp } from '../src/app';
import { createLogger } from '../src/observability/log';
import { runJob } from '../src/jobs/scheduled';
import { memoryDeps } from './memory-deps';
import { seedDemo } from './seed';

const port = Number(process.env.PORT ?? 8787);
const deps = memoryDeps({
  env: { APP_ORIGIN: process.env.APP_ORIGIN ?? 'http://localhost:5173' },
  log: createLogger({ service: 'chat360-ops-api', env: 'dev' }),
});
await seedDemo(deps);
const app = createApp(deps);

// Background work (Excel sync, notifications) settles on its own; keep the list from growing.
setInterval(() => void deps.settle(), 2000).unref();
if (process.env.DEV_CRON === '1')
  setInterval(() => void runJob(deps, 'maintenance', 'dev-interval'), 60_000).unref();

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`Chat360 Ops API (in-memory, dev sign-in) on http://localhost:${info.port}`);
});

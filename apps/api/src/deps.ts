import { todayIn, type DirectoryUser, type DomainContext, type OrgConfig } from '@chat360/core';
import type { AppConfig } from './env';
import type { AnalyticsSink, Coordination, Logger, Mailer, SessionStore } from './ports';
import type { Repos } from './store/repos';

/** Everything the app needs, assembled once per isolate (Worker) or process (dev server/tests). */
export interface Deps {
  config: AppConfig;
  repos: Repos;
  sessions: SessionStore;
  coord: Coordination;
  mailer: Mailer;
  analytics: AnalyticsSink;
  log: Logger;
  clock: () => Date;
  /** Background work not tied to a request's waitUntil (dev server/tests collect it here). */
  pending: Promise<unknown>[];
}

export function timeContext(deps: Deps, config: OrgConfig) {
  const d = deps.clock();
  return { now: d.toISOString(), today: todayIn(config.timezone, d) };
}

export async function domainContext(deps: Deps, actor: DirectoryUser): Promise<DomainContext> {
  const config = await deps.repos.orgConfig();
  return { actor, config, ...timeContext(deps, config) };
}

/** A non-human actor for scheduled work. It holds no roles and is never stored as a user. */
export const SYSTEM_ACTOR: DirectoryUser = {
  id: 'system',
  tenantId: '',
  email: '',
  displayName: 'Chat360 Ops (system)',
  roles: [],
  status: 'active',
  onboarding: { completedSteps: [], skippedSteps: [] },
  identityHistory: [],
  createdAt: '',
  updatedAt: '',
};

export function nameResolver(users: DirectoryUser[]) {
  const map = new Map(users.map((u) => [u.id, u.displayName]));
  return (id: string | null) => (id ? (map.get(id) ?? 'Unknown user') : '');
}

/** Runs promises with bounded concurrency so one job cannot flood storage. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

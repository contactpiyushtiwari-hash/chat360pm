import {
  applyEscalationSla,
  indexEntryOf,
  isWorkingDay,
  calendarOf,
  recordMissedConfirmations,
  tasksNeedingDecision,
  currentDue,
  transfersNeedingExecution,
  type Project,
  type ProjectIndexEntry,
} from '@chat360/core';
import { randomToken } from '../auth/crypto';
import { mapLimit, nameResolver, SYSTEM_ACTOR, timeContext, type Deps } from '../deps';
import type { JobRun } from '../ports';
import { PATHS } from '../store/repos';
import { deliverNotifications } from '../services/notifications';
import { executeTransfer } from '../services/transfers';
import { syncWorkbook } from '../services/workbook';

export const JOB_NAMES = [
  'daily_confirmation',
  'morning_reminders',
  'maintenance',
  'reconcile',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Maps wrangler.toml cron expressions to jobs. */
export function jobsForCron(cron: string): JobName[] {
  switch (cron) {
    case '30 3 * * *':
      return ['morning_reminders', 'reconcile'];
    case '30 13 * * *':
      return ['daily_confirmation'];
    case '15 * * * *':
      return ['maintenance'];
    default:
      return [];
  }
}

type Stats = Record<string, number>;
const bump = (s: Stats, k: string, n = 1) => (s[k] = (s[k] ?? 0) + n);

/**
 * Runs a job under a lease so overlapping triggers (or a manual run) never process concurrently.
 * Every per-project step is idempotent, so a crashed or duplicated run is safe to repeat; nothing
 * here assumes exactly-once execution (ADR-006).
 */
export async function runJob(deps: Deps, job: JobName, trigger: string): Promise<JobRun> {
  const config = await deps.repos.orgConfig();
  const { now, today } = timeContext(deps, config);
  const run: JobRun = {
    id: `${job}:${now}`,
    job,
    startedAt: now,
    finishedAt: now,
    ok: true,
    stats: {},
    errors: [],
  };
  if (config.disabledJobs.includes(job)) {
    run.stats.disabled = 1;
    deps.log.warn('job_disabled', { job, trigger });
    await deps.coord.recordJobRun(run);
    return run;
  }
  const owner = randomToken(8);
  if (!(await deps.coord.acquireLease(`job:${job}`, owner, 15 * 60))) {
    run.stats.skippedOverlap = 1;
    await deps.coord.recordJobRun(run);
    return run;
  }
  try {
    const idx = await deps.repos.index(true);
    const active = idx.projects.filter((p) => p.status === 'active');
    const each = async (fn: (p: ProjectIndexEntry) => Promise<void>, list = active) => {
      await mapLimit(list, 4, async (p) => {
        try {
          await fn(p);
        } catch (err) {
          run.ok = false;
          run.errors.push(`${p.id}: ${String(err).slice(0, 200)}`);
          deps.log.error('job_project_failed', { job, projectId: p.id, error: String(err) });
        }
      });
    };

    if (job === 'daily_confirmation') {
      if (!isWorkingDay(today, calendarOf(config))) run.stats.nonWorkingDay = 1;
      else
        await each(async (p) => {
          const { result, data } = await deps.repos.updateProject(p.id, (doc) =>
            recordMissedConfirmations(doc, { now, today, config }),
          );
          bump(run.stats, 'unconfirmed', result.unconfirmed.length);
          bump(run.stats, 'escalations', result.escalated.length);
          await deps.repos.upsertIndexEntry(indexEntryOf(data, today));
          const n = await deliverNotifications(deps, p.id);
          bump(run.stats, 'notificationsSent', n.sent);
          bump(run.stats, 'notificationsFailed', n.failed);
          await syncAndCount(deps, p.id, run, true);
        });
    }

    if (job === 'morning_reminders') {
      if (!isWorkingDay(today, calendarOf(config))) run.stats.nonWorkingDay = 1;
      else await sendReminders(deps, active, today, run);
      // Weekly planning: the This Week / Last Week sheets roll over on the first working day.
      await each(async (p) => syncAndCount(deps, p.id, run, true));
    }

    if (job === 'maintenance') {
      await each(async (p) => {
        const { result: bumped, data } = await deps.repos.updateProject(p.id, (doc) =>
          applyEscalationSla(doc, { now, today, config }),
        );
        bump(run.stats, 'slaEscalations', bumped.length);
        if (bumped.length) await deps.repos.upsertIndexEntry(indexEntryOf(data, today));
        const n = await deliverNotifications(deps, p.id);
        bump(run.stats, 'notificationsSent', n.sent);
        bump(run.stats, 'notificationsFailed', n.failed);
        for (const t of transfersNeedingExecution(data, today)) {
          const r = await executeTransfer(deps, p.id, t.id, SYSTEM_ACTOR);
          bump(run.stats, r.status === 'completed' ? 'transfersCompleted' : 'transfersIncomplete');
        }
        if (
          data.workbook.driveItemId &&
          (data.workbook.syncedRevision < data.revision || data.workbook.state === 'failed')
        ) {
          await syncAndCount(deps, p.id, run, false);
        }
      });
      await deps.coord.purgeExpired();
    }

    if (job === 'reconcile') await reconcileIndex(deps, today, run);
  } catch (err) {
    run.ok = false;
    run.errors.push(String(err).slice(0, 300));
    deps.log.error('job_failed', { job, error: String(err) });
  } finally {
    await deps.coord.releaseLease(`job:${job}`, owner);
    run.finishedAt = deps.clock().toISOString();
    run.errors = run.errors.slice(0, 50);
    await deps.coord.recordJobRun(run).catch(() => undefined);
    deps.log[run.ok ? 'info' : 'error']('job_finished', {
      job,
      trigger,
      stats: run.stats,
      errors: run.errors.length,
    });
  }
  return run;
}

async function syncAndCount(deps: Deps, projectId: string, run: JobRun, refresh: boolean) {
  const r = await syncWorkbook(deps, projectId, { refresh });
  bump(run.stats, `sync_${r.status}`);
  if (r.status === 'failed') {
    run.ok = false;
    run.errors.push(`${projectId}: workbook sync failed: ${r.error}`);
  }
}

/** One digest per owner of tasks due today. Deduplicated per owner per date via the Coordinator. */
async function sendReminders(deps: Deps, active: ProjectIndexEntry[], today: string, run: JobRun) {
  if (!deps.mailer.configured) {
    run.stats.remindersNotConfigured = 1;
    return;
  }
  const docs = (await mapLimit(active, 4, (p) => deps.repos.project(p.id))).filter(
    (p): p is Project => !!p,
  );
  const directory = (await deps.repos.directory()).users;
  const nameOf = nameResolver(directory);
  const byOwner = new Map<string, string[]>();
  for (const p of docs) {
    const owners = new Set(p.tasks.map((t) => t.ownerId).filter((x): x is string => !!x));
    for (const o of owners) {
      for (const t of tasksNeedingDecision(p, o, today)) {
        const lines = byOwner.get(o) ?? [];
        lines.push(
          `- ${p.clientName} — ${p.name}: ${t.id} ${t.title} (due ${currentDue(t)}${currentDue(t) < today ? ', OVERDUE' : ''})`,
        );
        byOwner.set(o, lines);
      }
    }
  }
  for (const [ownerId, lines] of byOwner) {
    const u = directory.find((x) => x.id === ownerId && x.status !== 'deactivated');
    if (!u?.email) continue;
    if (await deps.coord.remember(`reminder:${today}:${ownerId}`, '1', 36 * 3600)) {
      bump(run.stats, 'remindersDuplicateSkipped');
      continue;
    }
    const r = await deps.mailer.send({
      to: [u.email],
      subject: `[Chat360 Ops] ${lines.length} task(s) need your confirmation today`,
      body: `Hi ${nameOf(ownerId)},\n\nPlease mark each task Completed or Not completed by end of day:\n\n${lines.join('\n')}\n\n${deps.config.appOrigin}/today`,
    });
    bump(run.stats, r.status === 'accepted' ? 'remindersSent' : 'remindersFailed');
    if (r.status !== 'accepted')
      run.errors.push(`reminder ${ownerId}: ${r.status === 'failed' ? r.error : r.reason}`);
  }
}

/**
 * Rebuilds index entries from project documents: refreshes summaries for the new day, drops
 * nothing, and re-adds projects whose index write was interrupted (found by scanning folders).
 */
async function reconcileIndex(deps: Deps, today: string, run: JobRun) {
  const config = await deps.repos.orgConfig();
  const idx = await deps.repos.index(true);
  const known = new Set(idx.projects.map((p) => p.folderPath));
  for (const p of idx.projects) {
    const doc = await deps.repos.store.getJson<Project>(PATHS.project(p.folderPath));
    if (!doc) {
      run.errors.push(`${p.id}: project.json missing at ${p.folderPath}`);
      run.ok = false;
      continue;
    }
    await deps.repos.upsertIndexEntry(indexEntryOf(doc.data, today));
    bump(run.stats, 'refreshed');
  }
  for (const d of config.destinations) {
    for (const folder of await deps.repos.store.listFolders(d.path)) {
      const path = `${d.path}/${folder}`;
      if (known.has(path)) continue;
      const doc = await deps.repos.store.getJson<Project>(PATHS.project(path));
      if (doc?.data?.id) {
        await deps.repos.upsertIndexEntry(indexEntryOf(doc.data, today));
        bump(run.stats, 'recovered');
      }
    }
  }
}

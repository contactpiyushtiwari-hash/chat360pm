import {
  accessSubjectOf,
  can,
  findAppliedOperation,
  indexEntryOf,
  markOperationApplied,
  notFound,
  projectAccess,
  summarizeProject,
  type DirectoryUser,
  type DomainContext,
  type Project,
  type ProjectAccessLevel,
} from '@chat360/core';
import { domainContext } from '../deps';
import { requireUser, type AppContext } from '../http/context';
import { deliverNotifications } from '../services/notifications';
import { syncWorkbook } from '../services/workbook';

const RANK: Record<ProjectAccessLevel, number> = {
  none: 0,
  read: 1,
  contributor: 2,
  manager: 3,
  portfolio: 4,
};

/** Loads a project the caller may see. Missing and forbidden look the same (no existence leak). */
export async function loadProject(c: AppContext, id: string, min: ProjectAccessLevel = 'read') {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const project = /^PRJ-[0-9A-Z]{8}$/.test(id) ? await deps.repos.project(id) : null;
  if (!project) throw notFound('Project');
  const access = projectAccess(user, accessSubjectOf(project), ctx.today);
  if (RANK[access] < RANK[min]) throw notFound('Project');
  return { project, access, ctx };
}

export interface MutateOptions {
  idempotencyKey?: string | null;
  /** Skip background Excel sync (e.g. when the caller syncs itself). */
  skipSync?: boolean;
}

/**
 * Runs a domain mutation against the latest project document with compare-and-swap, then
 * refreshes the project index and schedules Excel sync and notification delivery in the background.
 * With an idempotency key, a repeated request returns the entity ref from the first application.
 */
export async function mutateProject<R>(
  c: AppContext,
  id: string,
  fn: (p: Project, ctx: DomainContext) => R,
  opts: MutateOptions = {},
): Promise<{ project: Project; result: R | null; replayedRef: string | null; ctx: DomainContext }> {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  if (!/^PRJ-[0-9A-Z]{8}$/.test(id)) throw notFound('Project');
  let replayedRef: string | null = null;
  const { data, result, changed } = await deps.repos.updateProject(id, (p) => {
    if (projectAccess(user, accessSubjectOf(p), ctx.today) === 'none') throw notFound('Project');
    replayedRef = null;
    if (opts.idempotencyKey) {
      const prior = findAppliedOperation(p, opts.idempotencyKey);
      if (prior !== undefined) {
        replayedRef = prior;
        return null;
      }
    }
    const r = fn(p, ctx);
    if (opts.idempotencyKey) markOperationApplied(p, opts.idempotencyKey, refOf(r));
    return r;
  });
  if (changed) await afterProjectWrite(c, data, ctx, opts);
  return { project: data, result: replayedRef !== null ? null : result, replayedRef, ctx };
}

function refOf(r: unknown): string {
  if (r && typeof r === 'object' && 'id' in r && typeof (r as { id: unknown }).id === 'string')
    return (r as { id: string }).id;
  return '';
}

export async function afterProjectWrite(
  c: AppContext,
  project: Project,
  ctx: DomainContext,
  opts: MutateOptions = {},
) {
  const deps = c.get('deps');
  await deps.repos.upsertIndexEntry(indexEntryOf(project, ctx.today));
  const bg = c.get('background');
  const hasPending =
    project.escalations.some((e) => e.notifications.some((n) => n.status === 'pending')) ||
    project.transfers.some((t) => t.notifications.some((n) => n.status === 'pending'));
  if (hasPending) bg(deliverNotifications(deps, project.id));
  if (!opts.skipSync && project.workbook.driveItemId) bg(syncWorkbook(deps, project.id));
}

/** Project for the browser: internal bookkeeping removed, plus the caller's permissions. */
/**
 * Removes commercial figures for callers who may not see them: the finance record itself, the
 * amounts recorded in finance audit entries, and the finance block of transfer handover snapshots.
 */
export function redactFinance(project: Project, user: DirectoryUser, today: string): Project {
  if (can(user, 'finance.view', accessSubjectOf(project), today)) return project;
  const { finance: _f, ...rest } = project;
  return {
    ...rest,
    audit: project.audit.map((a) =>
      a.action === 'finance.updated' ? { ...a, details: { fields: a.details?.fields } } : a,
    ),
    transfers: project.transfers.map((t) => {
      const { finance: _sf, ...snapshot } = t.snapshot;
      return { ...t, snapshot };
    }),
  };
}

export function presentProject(project: Project, user: DirectoryUser, today: string) {
  const subject = accessSubjectOf(project);
  const access = projectAccess(user, subject, today);
  const { appliedOperations: _a, workbook, ...rest } = redactFinance(project, user, today);
  const { rowHashes: _h, ...wb } = workbook;
  return {
    ...rest,
    workbook: wb,
    summary: summarizeProject(project, today),
    access,
    permissions: {
      edit: can(user, 'project.edit', subject, today),
      viewFinance: can(user, 'finance.view', subject, today),
      editFinance: can(user, 'finance.edit', subject, today),
      editTeam: can(user, 'project.team.edit', subject, today),
      createTask: can(user, 'task.create', subject, today),
      manageApis: can(user, 'api.manage', subject, today),
      manageEscalations: can(user, 'escalation.manage', subject, today),
      syncWorkbook: can(user, 'workbook.sync', subject, today),
      resolveConflicts: can(user, 'workbook.resolve_conflict', subject, today),
      requestTransfer: can(user, 'transfer.request', subject, today),
      reviewTransfers: can(user, 'transfer.review', subject, today),
      reassignPm: can(user, 'pm.reassign', subject, today),
      logCommunication: can(user, 'communication.log', subject, today),
    },
  };
}

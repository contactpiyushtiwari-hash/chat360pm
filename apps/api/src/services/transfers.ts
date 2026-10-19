import {
  applyPmAssignment,
  completeIfReady,
  findTransfer,
  indexEntryOf,
  isEffective,
  recordStepOutcome,
  refreshPendingTransfers,
  type DirectoryUser,
} from '@chat360/core';
import { domainContext, type Deps } from '../deps';
import { deliverNotifications } from './notifications';
import { syncWorkbook } from './workbook';

/**
 * Executes an approved transfer. OneDrive offers no multi-document transaction, so every step
 * is recorded on the transfer before moving on, every step is idempotent, and the transfer is
 * reported completed only after the required steps succeed (ADR-007). Safe to re-run.
 */
export async function executeTransfer(
  deps: Deps,
  projectId: string,
  transferId: string,
  actor: DirectoryUser,
) {
  const ctx = await domainContext(deps, actor);
  const current = await deps.repos.project(projectId);
  if (!current) throw new Error(`Project ${projectId} not found`);
  const t = findTransfer(current, transferId);
  if (t.status !== 'approved' || !isEffective(t, ctx.today)) return t;

  // Step 1 (required): assign the new PM inside the project document's atomic write.
  let { data: project } = await deps.repos.updateProject(projectId, (p) =>
    applyPmAssignment(p, transferId, ctx),
  );

  // Step 2 (required): update the project index so access and listings follow the new PM.
  let indexOk = true;
  try {
    await deps.repos.upsertIndexEntry(indexEntryOf(project, ctx.today));
  } catch (err) {
    indexOk = false;
    deps.log.error('transfer_index_update_failed', { projectId, transferId, error: String(err) });
  }
  ({ data: project } = await deps.repos.updateProject(projectId, (p) => {
    recordStepOutcome(
      p,
      transferId,
      'update_index',
      indexOk ? { ok: true } : { ok: false, error: 'Project index update failed; will retry' },
      ctx.now,
    );
    completeIfReady(p, transferId, actor.id, ctx.now);
  }));
  if (indexOk)
    await deps.repos.upsertIndexEntry(indexEntryOf(project, ctx.today)).catch(() => undefined);

  // Optional, tracked steps: Excel and notifications. Their failure does not undo the transfer.
  const sync = await syncWorkbook(deps, projectId);
  const notify = await deliverNotifications(deps, projectId).catch((err) => ({
    sent: 0,
    failed: 1,
    error: String(err),
  }));
  ({ data: project } = await deps.repos.updateProject(projectId, (p) => {
    recordStepOutcome(
      p,
      transferId,
      'sync_workbook',
      sync.status === 'synced' || sync.status === 'up_to_date'
        ? { ok: true }
        : sync.status === 'not_created'
          ? { skipped: 'No workbook exists for this project' }
          : { ok: false, error: sync.status === 'failed' ? sync.error : `Workbook ${sync.status}` },
      ctx.now,
    );
    recordStepOutcome(
      p,
      transferId,
      'notify',
      !deps.mailer.configured
        ? { skipped: 'Notification mailbox not configured' }
        : notify.failed
          ? { ok: false, error: `${notify.failed} notification(s) failed` }
          : { ok: true },
      ctx.now,
    );
  }));

  // A completed transfer may unblock a pending account-deactivation request.
  const index = await deps.repos.index(true);
  await deps.repos
    .updateAccounts((log) => refreshPendingTransfers(log, index.projects, ctx.now))
    .catch(() => undefined);

  const final = findTransfer(project, transferId);
  deps.analytics.track(
    final.status === 'completed' ? 'transfer_completed' : 'transfer_execution_incomplete',
    {
      projectId,
      outcome: final.status,
    },
  );
  return final;
}

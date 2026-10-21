import { indexEntryOf, type Project } from '@chat360/core';
import {
  desiredRows,
  generateTracker,
  headerBlock,
  initialRowHashes,
  planTableSync,
  trackerTables,
  type SyncPlan,
} from '@chat360/core/workbook';
import { nameResolver, timeContext, type Deps } from '../deps';
import { randomToken } from '../auth/crypto';
import { redactText } from '../observability/redact';
import { PreconditionFailedError, type CellWrite, type WorkbookWrite } from '../ports';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type WorkbookOutcome =
  | {
      status: 'created' | 'synced' | 'up_to_date' | 'busy' | 'not_created';
      webUrl?: string | null;
      conflicts?: number;
    }
  | { status: 'conflict'; conflicts: number; schemaErrors: string[] }
  | { status: 'failed'; error: string };

function errorText(err: unknown) {
  return redactText(err instanceof Error ? `${err.name}: ${err.message}` : String(err), 300);
}

/** Generates the tracker (six delivery sheets + Finance) and uploads it next to project.json. Never overwrites a file. */
export async function createWorkbook(deps: Deps, projectId: string): Promise<WorkbookOutcome> {
  const project = await deps.repos.project(projectId);
  if (!project) return { status: 'failed', error: 'Project not found' };
  if (project.workbook.driveItemId)
    return { status: 'up_to_date', webUrl: project.workbook.webUrl };
  const [config, directory] = await Promise.all([deps.repos.orgConfig(), deps.repos.directory()]);
  const { now, today } = timeContext(deps, config);
  const nameOf = nameResolver(directory.users);
  const path = `${project.folderPath}/${project.workbook.fileName}`;
  try {
    const bytes = generateTracker(project, { config, today, nameOf, generatedAt: now });
    const hashes = initialRowHashes(
      trackerTables(config),
      desiredRows(project, config, today, nameOf),
    );
    const file = await deps.repos.store.putFile(path, bytes, XLSX_MIME, { ifNoneMatch: '*' });
    const { data } = await deps.repos.updateProject(projectId, (p) => {
      p.workbook = {
        ...p.workbook,
        driveItemId: file.itemId,
        webUrl: file.webUrl,
        state: p.revision > project.revision ? 'pending' : 'synced',
        syncedRevision: project.revision,
        lastSyncedAt: now,
        lastAttemptAt: now,
        lastError: null,
        rowHashes: hashes,
        conflicts: [],
      };
      if (!p.documents.some((d) => d.kind === 'tracker')) {
        p.documents.push({ label: 'Project tracker (Excel)', url: file.webUrl, kind: 'tracker' });
      }
    });
    await deps.repos.upsertIndexEntry(indexEntryOf(data, today));
    deps.analytics.track('workbook_generated', { projectId, outcome: 'ok' });
    return { status: 'created', webUrl: file.webUrl };
  } catch (err) {
    const error =
      err instanceof PreconditionFailedError
        ? `A file named "${project.workbook.fileName}" already exists in the project folder. Rename or move it, then retry.`
        : errorText(err);
    deps.log.error('workbook_generation_failed', { projectId, error });
    deps.analytics.track('workbook_generated', { projectId, outcome: 'failed' });
    await deps.repos
      .updateProject(projectId, (p) => {
        p.workbook.state = 'failed';
        p.workbook.lastError = error;
        p.workbook.lastAttemptAt = now;
        p.workbook.attempts += 1;
      })
      .catch((e) =>
        deps.log.error('workbook_state_record_failed', { projectId, error: String(e) }),
      );
    return { status: 'failed', error };
  }
}

/**
 * Brings the Excel tables in line with the project document (see core planTableSync for the
 * safety rules). Serialised per project with a lease; loops until Excel reflects the latest
 * revision or nothing more can be done.
 */
export async function syncWorkbook(
  deps: Deps,
  projectId: string,
  opts: { force?: string[]; refresh?: boolean } = {},
): Promise<WorkbookOutcome> {
  const owner = randomToken(8);
  const lease = `sync:${projectId}`;
  if (!(await deps.coord.acquireLease(lease, owner, 120))) return { status: 'busy' };
  try {
    let outcome: WorkbookOutcome = { status: 'up_to_date' };
    for (let loop = 0; loop < 3; loop++) {
      const project = await deps.repos.project(projectId);
      if (!project?.workbook.driveItemId) return { status: 'not_created' };
      const forceSet = new Set(loop === 0 ? (opts.force ?? []) : []);
      const behind = project.workbook.syncedRevision < project.revision;
      if (!behind && forceSet.size === 0 && !(opts.refresh && loop === 0)) return outcome;
      outcome = await syncOnce(deps, project, forceSet);
      if (outcome.status === 'failed') return outcome;
    }
    return outcome;
  } finally {
    await deps.coord.releaseLease(lease, owner);
  }
}

async function syncOnce(
  deps: Deps,
  project: Project,
  force: Set<string>,
): Promise<WorkbookOutcome> {
  const [config, directory] = await Promise.all([deps.repos.orgConfig(), deps.repos.directory()]);
  const { now, today } = timeContext(deps, config);
  const nameOf = nameResolver(directory.users);
  const itemId = project.workbook.driveItemId!;
  const defs = trackerTables(config);
  const rev = project.revision;
  try {
    await deps.repos.updateProject(project.id, (p) => {
      p.workbook.state = 'syncing';
      p.workbook.lastAttemptAt = now;
    });
    const desired = desiredRows(project, config, today, nameOf);
    const tables = await deps.workbooks.readTables(
      itemId,
      defs.map((d) => d.name),
    );
    const plans = new Map<string, SyncPlan>();
    const writes: WorkbookWrite[] = [];
    for (const def of defs) {
      const snap = tables.find((t) => t.name === def.name);
      if (!snap) {
        const missing = planTableSync(
          def,
          { headers: [], rows: [], firstDataRow: 0 },
          [],
          project.workbook.rowHashes,
          { now },
        );
        missing.schemaError = `The "${def.sheet}" sheet (${def.name}) is not in this workbook, which was created before it existed. Other sheets are still updated.`;
        plans.set(def.name, missing);
        continue;
      }
      const tableForce = new Set(
        [...force]
          .filter((k) => k.startsWith(`${def.name}:`))
          .map((k) => k.slice(def.name.length + 1)),
      );
      const plan = planTableSync(def, snap, desired[def.name] ?? [], project.workbook.rowHashes, {
        now,
        force: tableForce,
      });
      plans.set(def.name, plan);
      if (plan.patches.length || plan.appends.length) {
        writes.push({
          sheet: snap.sheet,
          table: def.name,
          patches: plan.patches,
          appends: plan.appends,
        });
      }
    }
    const hdr = headerBlock(project, nameOf);
    const cells: CellWrite[] = [
      { sheet: 'Gantt Chart', address: 'D2', values: [[hdr.pm]] },
      ...[...new Set(tables.map((t) => t.sheet))].map((sheet) => ({
        sheet,
        address: 'A1',
        values: [[hdr.title]],
      })),
    ];
    const results = await deps.workbooks.write(itemId, writes, cells);
    const failed = results.filter((r) => !r.ok);
    const okTables = new Set(
      defs.map((d) => d.name).filter((n) => !failed.some((f) => f.table === n)),
    );
    const conflicts = [...plans.values()].flatMap((p) => p.conflicts);
    const schemaErrors = [...plans.values()]
      .map((p) => p.schemaError)
      .filter((e): e is string => !!e);

    await deps.repos.updateProject(project.id, (p) => {
      const hashes = { ...p.workbook.rowHashes };
      for (const [table, plan] of plans) {
        if (!okTables.has(table)) continue;
        for (const k of Object.keys(hashes)) if (k.startsWith(`${table}:`)) delete hashes[k];
        Object.assign(hashes, plan.hashes);
      }
      p.workbook.rowHashes = hashes;
      p.workbook.conflicts = conflicts;
      p.workbook.lastAttemptAt = now;
      p.workbook.attempts = failed.length ? p.workbook.attempts + 1 : 0;
      if (failed.length) {
        p.workbook.state = 'failed';
        p.workbook.lastError = failed
          .map((f) => `${f.table}: ${f.error ?? 'failed'}`)
          .join('; ')
          .slice(0, 500);
      } else {
        p.workbook.syncedRevision = rev;
        p.workbook.lastSyncedAt = now;
        p.workbook.lastError = schemaErrors.length ? schemaErrors.join('; ') : null;
        p.workbook.state =
          conflicts.length || schemaErrors.length
            ? 'conflict'
            : p.revision > rev
              ? 'pending'
              : 'synced';
      }
    });
    if (failed.length) {
      deps.log.error('workbook_sync_partial_failure', { projectId: project.id, failed });
      return { status: 'failed', error: failed.map((f) => f.error).join('; ') };
    }
    if (conflicts.length || schemaErrors.length) {
      deps.log.warn('workbook_sync_conflicts', {
        projectId: project.id,
        conflicts: conflicts.length,
        schemaErrors,
      });
      return { status: 'conflict', conflicts: conflicts.length, schemaErrors };
    }
    return { status: 'synced', webUrl: project.workbook.webUrl };
  } catch (err) {
    const error = errorText(err);
    deps.log.error('workbook_sync_failed', { projectId: project.id, error });
    await deps.repos
      .updateProject(project.id, (p) => {
        p.workbook.state = 'failed';
        p.workbook.lastError = error;
        p.workbook.lastAttemptAt = now;
        p.workbook.attempts += 1;
      })
      .catch(() => undefined);
    return { status: 'failed', error };
  }
}

import type { WorkCalendar } from './dates';
import { newAuditId } from './ids';
import type { AuditEntry, DirectoryUser, IsoDate, IsoInstant, OrgConfig, Project } from './types';

/** Everything a domain operation needs about "who" and "when". Injected for testability. */
export interface DomainContext {
  actor: DirectoryUser;
  now: IsoInstant;
  today: IsoDate;
  config: OrgConfig;
}

/** Context for scheduled jobs, which act as the system rather than a person. */
export interface SystemContext {
  now: IsoInstant;
  today: IsoDate;
  config: OrgConfig;
}

export function calendarOf(config: OrgConfig): WorkCalendar {
  return { workingDays: config.workingDays, holidays: config.holidays };
}

export function recordAudit(
  project: Project,
  actor: string,
  now: IsoInstant,
  action: string,
  target: string,
  details?: Record<string, unknown>,
): AuditEntry {
  const entry: AuditEntry = { id: newAuditId(), at: now, actor, action, target, details };
  project.audit.push(entry);
  return entry;
}

const MAX_APPLIED_OPERATIONS = 200;

/** Returns the entity reference recorded for an idempotency key, if it was already applied. */
export function findAppliedOperation(project: Project, key: string): string | undefined {
  const hit = project.appliedOperations.find((e) => e === key || e.startsWith(`${key}|`));
  return hit === undefined ? undefined : hit.slice(key.length + 1);
}

/**
 * Records an idempotency key (and the entity it produced) on the document, bounded FIFO.
 * Callers check `findAppliedOperation` first so a retried request does not repeat its effect.
 */
export function markOperationApplied(project: Project, key: string, ref = ''): void {
  project.appliedOperations.push(`${key}|${ref}`);
  if (project.appliedOperations.length > MAX_APPLIED_OPERATIONS) {
    project.appliedOperations.splice(0, project.appliedOperations.length - MAX_APPLIED_OPERATIONS);
  }
}

/** Bumps revision/updatedAt after any mutation so Excel sync knows it is behind. */
export function touch(project: Project, now: IsoInstant): void {
  project.revision += 1;
  project.updatedAt = now;
  if (project.workbook.state !== 'not_created' && project.workbook.state !== 'conflict') {
    project.workbook.state = 'pending';
  }
}

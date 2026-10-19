import { recordAudit, touch, type DomainContext } from './context';
import { addDays } from './dates';
import { DomainError, forbidden, invalid, invalidTransition, notFound } from './errors';
import { newNotificationId, newTransferId } from './ids';
import { accessSubjectOf, can, hasGlobalRole } from './rbac';
import { assessHealth, teamChange } from './project';
import type { TransferDraftInput } from './schemas';
import { currentDue, isOpen } from './tasks';
import type {
  DirectoryUser,
  HandoverSummary,
  IsoDate,
  NotificationRecord,
  Project,
  TransferRequest,
  TransferStatus,
  TransferStep,
  TransferStepName,
  UserId,
} from './types';

/** Builds the handover context from live project data (prepopulates transfer requests). */
export function buildHandoverSummary(
  project: Project,
  today: IsoDate,
  now: string,
): HandoverSummary {
  const open = project.tasks.filter(isOpen);
  const { health, reasons } = assessHealth(project, today);
  const horizon = addDays(today, 14);
  const isUat = (phase: string) => /uat/i.test(phase);
  return {
    generatedAt: now,
    health,
    healthReasons: reasons,
    openTasks: open.map((t) => ({
      id: t.id,
      title: t.title,
      ownerId: t.ownerId,
      due: currentDue(t),
      status: t.status,
    })),
    upcomingDeadlines: open
      .filter((t) => currentDue(t) <= horizon)
      .sort((a, b) => currentDue(a).localeCompare(currentDue(b)))
      .map((t) => ({ id: t.id, title: t.title, due: currentDue(t) })),
    pendingApis: project.apis
      .filter((a) => a.readiness !== 'ready')
      .map((a) => ({ id: a.id, name: a.name, readiness: a.readiness, targetDate: a.targetDate })),
    uatIssues: open
      .filter((t) => isUat(t.phase))
      .map((t) => ({ id: t.id, title: t.title, status: t.status, due: currentDue(t) })),
    clientCommitments: project.tasks
      .filter((t) => t.clientCommitment && t.status !== 'cancelled')
      .map((t) => ({ id: t.id, title: t.title, due: currentDue(t), status: t.status })),
    openEscalations: project.escalations
      .filter((e) => e.status !== 'resolved')
      .map((e) => ({ id: e.id, taskId: e.taskId, severity: e.severity, reason: e.reason })),
    documents: [
      ...(project.workbook.webUrl
        ? [{ label: 'Project tracker (Excel)', url: project.workbook.webUrl }]
        : []),
      ...project.documents.map((d) => ({ label: d.label, url: d.url })),
    ],
    blockers: open
      .filter((t) => t.blocker.trim())
      .map((t) => ({ id: t.id, title: t.title, blocker: t.blocker })),
  };
}

const ACTIVE_STATUSES: TransferStatus[] = ['draft', 'submitted', 'under_review', 'approved'];

const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'approved', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
};

function transition(
  t: TransferRequest,
  to: TransferStatus,
  by: UserId | 'system',
  now: string,
  note?: string,
) {
  if (!TRANSITIONS[t.status].includes(to)) {
    throw invalidTransition(`Transfer cannot move from ${t.status} to ${to}.`);
  }
  t.history.push({ at: now, by, from: t.status, to, ...(note ? { note } : {}) });
  t.status = to;
}

export function findTransfer(project: Project, id: string): TransferRequest {
  const t = project.transfers.find((x) => x.id === id);
  if (!t) throw notFound(`Transfer ${id}`);
  return t;
}

export function activeTransfer(project: Project): TransferRequest | undefined {
  return project.transfers.find((t) => ACTIVE_STATUSES.includes(t.status));
}

function notification(kind: string, recipients: UserId[], now: string): NotificationRecord {
  return {
    id: newNotificationId(),
    kind,
    recipientIds: recipients,
    status: recipients.length ? 'pending' : 'skipped',
    attempts: 0,
    lastAttemptAt: now,
    ...(recipients.length ? {} : { lastError: 'No recipients configured.' }),
  };
}

function initialSteps(): TransferStep[] {
  return [
    { name: 'assign_pm', required: true, status: 'pending', attempts: 0 },
    { name: 'update_index', required: true, status: 'pending', attempts: 0 },
    { name: 'sync_workbook', required: false, status: 'pending', attempts: 0 },
    { name: 'notify', required: false, status: 'pending', attempts: 0 },
  ];
}

function assertEligiblePm(user: DirectoryUser | undefined, currentPm: UserId) {
  if (!user || user.status !== 'active') throw invalid('The new PM must be an active employee.');
  if (!user.roles.includes('pm')) throw invalid('The new PM must hold the Project Manager role.');
  if (user.id === currentPm) throw invalid('The new PM is already the current PM.');
}

/** Delivery heads who should hear about transfers: the project's assigned head, else all heads. */
export function transferReviewers(project: Project, directory: DirectoryUser[]): UserId[] {
  if (project.team.deliveryHead) return [project.team.deliveryHead];
  return directory
    .filter((u) => u.status === 'active' && hasGlobalRole(u, 'delivery_head'))
    .map((u) => u.id);
}

/** Path A: the current PM raises a transfer request (draft or submitted). */
export function requestTransfer(
  project: Project,
  input: TransferDraftInput,
  ctx: DomainContext,
  directory: DirectoryUser[],
): TransferRequest {
  if (!can(ctx.actor, 'transfer.request', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the current PM of this project can request a transfer.');
  }
  if (activeTransfer(project)) {
    throw new DomainError('conflict', 'This project already has an active transfer request.');
  }
  if (input.proposedPmId) {
    assertEligiblePm(
      directory.find((u) => u.id === input.proposedPmId),
      project.team.pm,
    );
  }
  const t: TransferRequest = {
    id: newTransferId(),
    kind: 'pm_request',
    status: 'draft',
    fromPmId: project.team.pm,
    proposedPmId: input.proposedPmId,
    newPmId: null,
    reason: input.reason,
    requestedEffectiveDate: input.requestedEffectiveDate,
    handoverNotes: input.handoverNotes,
    snapshot: buildHandoverSummary(project, ctx.today, ctx.now),
    requestedBy: ctx.actor.id,
    createdAt: ctx.now,
    execution: { steps: initialSteps() },
    notifications: [],
    history: [{ at: ctx.now, by: ctx.actor.id, from: null, to: 'draft' }],
  };
  project.transfers.push(t);
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.created', t.id);
  if (input.submit) submitTransfer(project, t.id, ctx, directory);
  touch(project, ctx.now);
  return t;
}

export function submitTransfer(
  project: Project,
  id: string,
  ctx: DomainContext,
  directory: DirectoryUser[],
) {
  const t = findTransfer(project, id);
  if (t.requestedBy !== ctx.actor.id)
    throw forbidden('Only the requester can submit this transfer.');
  transition(t, 'submitted', ctx.actor.id, ctx.now);
  t.submittedAt = ctx.now;
  t.snapshot = buildHandoverSummary(project, ctx.today, ctx.now);
  t.notifications.push(
    notification('transfer.submitted', transferReviewers(project, directory), ctx.now),
  );
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.submitted', t.id);
  touch(project, ctx.now);
  return t;
}

function assertReviewer(project: Project, ctx: DomainContext) {
  if (!can(ctx.actor, 'transfer.review', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the Delivery and Operations Head can review transfers.');
  }
}

export function startReview(project: Project, id: string, ctx: DomainContext) {
  assertReviewer(project, ctx);
  const t = findTransfer(project, id);
  transition(t, 'under_review', ctx.actor.id, ctx.now);
  t.reviewStartedAt = ctx.now;
  t.reviewedBy = ctx.actor.id;
  touch(project, ctx.now);
  return t;
}

export function approveTransfer(
  project: Project,
  id: string,
  newPmId: UserId | undefined,
  notes: string,
  ctx: DomainContext,
  directory: DirectoryUser[],
) {
  assertReviewer(project, ctx);
  const t = findTransfer(project, id);
  const chosen = newPmId ?? t.proposedPmId;
  if (!chosen) throw invalid('Select the new PM before approving.');
  assertEligiblePm(
    directory.find((u) => u.id === chosen),
    project.team.pm,
  );
  transition(t, 'approved', ctx.actor.id, ctx.now, notes || undefined);
  t.newPmId = chosen;
  t.reviewedBy = ctx.actor.id;
  t.decidedAt = ctx.now;
  t.decisionNotes = notes;
  t.notifications.push(notification('transfer.approved', [t.fromPmId, chosen], ctx.now));
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.approved', t.id, { newPmId: chosen });
  touch(project, ctx.now);
  return t;
}

export function rejectTransfer(project: Project, id: string, reason: string, ctx: DomainContext) {
  assertReviewer(project, ctx);
  if (!reason.trim()) throw invalid('A rejection reason is required.');
  const t = findTransfer(project, id);
  transition(t, 'rejected', ctx.actor.id, ctx.now, reason);
  t.rejectionReason = reason;
  t.reviewedBy = ctx.actor.id;
  t.decidedAt = ctx.now;
  t.notifications.push(notification('transfer.rejected', [t.requestedBy], ctx.now));
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.rejected', t.id);
  touch(project, ctx.now);
  return t;
}

export function cancelTransfer(project: Project, id: string, ctx: DomainContext) {
  const t = findTransfer(project, id);
  const isHead = can(ctx.actor, 'transfer.review', accessSubjectOf(project), ctx.today);
  if (t.requestedBy !== ctx.actor.id && !isHead)
    throw forbidden('Only the requester can cancel this transfer.');
  transition(t, 'cancelled', ctx.actor.id, ctx.now);
  t.cancelledAt = ctx.now;
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.cancelled', t.id);
  touch(project, ctx.now);
  return t;
}

/** Path B: the Delivery Head reassigns the PM directly. Recorded as an approved transfer. */
export function directReassignment(
  project: Project,
  input: { newPmId: UserId; reason: string; effectiveDate: IsoDate; handoverNotes: string },
  ctx: DomainContext,
  directory: DirectoryUser[],
): TransferRequest {
  if (!can(ctx.actor, 'pm.reassign', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the Delivery and Operations Head can reassign the PM.');
  }
  assertEligiblePm(
    directory.find((u) => u.id === input.newPmId),
    project.team.pm,
  );
  const existing = activeTransfer(project);
  if (existing && existing.status === 'approved') {
    throw new DomainError(
      'conflict',
      'An approved transfer is already being executed for this project.',
    );
  }
  // A direct reassignment supersedes a pending PM request; that request is cancelled with a note.
  if (existing) {
    existing.history.push({
      at: ctx.now,
      by: ctx.actor.id,
      from: existing.status,
      to: 'cancelled',
      note: 'Superseded by direct reassignment',
    });
    existing.status = 'cancelled';
    existing.cancelledAt = ctx.now;
  }
  const t: TransferRequest = {
    id: newTransferId(),
    kind: 'direct_reassignment',
    status: 'approved',
    fromPmId: project.team.pm,
    proposedPmId: input.newPmId,
    newPmId: input.newPmId,
    reason: input.reason,
    requestedEffectiveDate: input.effectiveDate,
    handoverNotes: input.handoverNotes,
    snapshot: buildHandoverSummary(project, ctx.today, ctx.now),
    requestedBy: ctx.actor.id,
    createdAt: ctx.now,
    reviewedBy: ctx.actor.id,
    decidedAt: ctx.now,
    execution: { steps: initialSteps() },
    notifications: [notification('transfer.reassigned', [project.team.pm, input.newPmId], ctx.now)],
    history: [
      { at: ctx.now, by: ctx.actor.id, from: null, to: 'approved', note: 'Direct reassignment' },
    ],
  };
  project.transfers.push(t);
  recordAudit(project, ctx.actor.id, ctx.now, 'transfer.direct_reassignment', t.id, {
    newPmId: input.newPmId,
  });
  touch(project, ctx.now);
  return t;
}

export function stepOf(t: TransferRequest, name: TransferStepName): TransferStep {
  const s = t.execution.steps.find((x) => x.name === name);
  if (!s) throw new Error(`Missing step ${name}`);
  return s;
}

/**
 * Step 1 of execution (inside the project document's compare-and-swap write).
 * Idempotent: re-running after success is a no-op. Never touches tasks, deadlines, history or
 * task ownership; it changes only the current PM and records history.
 */
export function applyPmAssignment(project: Project, id: string, ctx: DomainContext) {
  const t = findTransfer(project, id);
  if (t.status !== 'approved') throw invalidTransition('Only approved transfers can be executed.');
  if (!t.newPmId) throw invalid('The transfer has no new PM.');
  const step = stepOf(t, 'assign_pm');
  t.executedBy = ctx.actor.id;
  if (step.status === 'done') return t;
  step.attempts += 1;
  const fromPm = project.team.pm;
  if (fromPm !== t.newPmId) {
    project.team.pm = t.newPmId;
    project.teamHistory.push(teamChange('pm', [fromPm], [t.newPmId], ctx, t.reason, t.id));
    const until = addDays(ctx.today, ctx.config.formerPmAccessDays);
    project.formerPms = project.formerPms.filter(
      (f) => f.userId !== fromPm && f.userId !== t.newPmId,
    );
    if (ctx.config.formerPmAccessDays > 0) project.formerPms.push({ userId: fromPm, until });
  }
  step.status = 'done';
  step.at = ctx.now;
  delete step.error;
  recordAudit(project, ctx.actor.id, ctx.now, 'project.pm_assigned', project.id, {
    transferId: t.id,
    from: fromPm,
    to: t.newPmId,
  });
  touch(project, ctx.now);
  return t;
}

export function recordStepOutcome(
  project: Project,
  id: string,
  name: TransferStepName,
  outcome: { ok: true } | { ok: false; error: string } | { skipped: string },
  now: string,
) {
  const t = findTransfer(project, id);
  const step = stepOf(t, name);
  step.attempts += 1;
  step.at = now;
  if ('skipped' in outcome) {
    step.status = 'skipped';
    step.error = outcome.skipped;
  } else if (outcome.ok) {
    step.status = 'done';
    delete step.error;
  } else {
    step.status = 'failed';
    step.error = outcome.error;
    t.execution.lastError = `${name}: ${outcome.error}`;
  }
  return t;
}

/**
 * Marks the transfer completed only when every required step succeeded. Optional steps
 * (workbook sync, notifications) stay visible with their own status.
 */
export function completeIfReady(
  project: Project,
  id: string,
  by: UserId | 'system',
  now: string,
): boolean {
  const t = findTransfer(project, id);
  if (t.status === 'completed') return true;
  if (t.status !== 'approved') return false;
  const ready = t.execution.steps.filter((s) => s.required).every((s) => s.status === 'done');
  if (!ready) return false;
  transition(t, 'completed', by, now);
  t.completedAt = now;
  delete t.execution.lastError;
  t.notifications.push(notification('transfer.completed', [t.fromPmId, t.newPmId!], now));
  recordAudit(project, by, now, 'transfer.completed', t.id);
  touch(project, now);
  return true;
}

/**
 * Approved transfers whose effective date has arrived: new approvals and interrupted executions
 * the scheduled job should (re)run.
 */
export function transfersNeedingExecution(project: Project, today: IsoDate): TransferRequest[] {
  return project.transfers.filter((t) => t.status === 'approved' && isEffective(t, today));
}

export function isEffective(t: TransferRequest, today: IsoDate): boolean {
  return t.requestedEffectiveDate <= today;
}

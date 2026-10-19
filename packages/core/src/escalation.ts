import { calendarOf, recordAudit, touch, type DomainContext, type SystemContext } from './context';
import { isWorkingDay } from './dates';
import { DomainError, forbidden, invalid, invalidTransition, notFound } from './errors';
import { newNotificationId, sequenceId } from './ids';
import { accessSubjectOf, can } from './rbac';
import type { ConfirmTaskInput } from './schemas';
import {
  completeTaskFields,
  currentDue,
  findTask,
  humanConfirmationOn,
  isOpen,
  reviseDeadline,
} from './tasks';
import type {
  Escalation,
  EscalationType,
  NotificationRecord,
  OrgConfig,
  Project,
  ProjectRole,
  Severity,
  Task,
  TaskConfirmation,
  UserId,
} from './types';

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function taskSeverity(task: Task): Severity {
  if (task.priority === 'critical') return 'critical';
  if (task.priority === 'high' || task.isMilestone || task.clientCommitment) return 'high';
  return 'low';
}

function managerFor(project: Project, role: ProjectRole): UserId | null {
  switch (role) {
    case 'pm':
      return project.team.pm;
    case 'delivery_head':
      return project.team.deliveryHead;
    case 'fde':
      return project.team.fde;
    case 'sales_poc':
      return project.team.salesPoc;
    case 'csm':
      return project.team.csm;
    case 'tech':
      return project.team.tech[0] ?? null;
  }
}

/**
 * Resolves the manager for a level. If the task owner would be their own escalation manager
 * (e.g. the PM owns the task), the escalation skips to the next level so it reaches someone else.
 */
export function resolveLevel(
  project: Project,
  config: OrgConfig,
  startLevel: number,
  ownerId: UserId | null,
) {
  const levels = [...config.escalation.levels].sort((a, b) => a.level - b.level);
  let candidate = levels.find((l) => l.level >= startLevel) ?? levels.at(-1)!;
  for (const l of levels.filter((x) => x.level >= candidate.level)) {
    candidate = l;
    const manager = managerFor(project, l.role);
    if (manager && manager !== ownerId) return { policy: l, managerId: manager };
  }
  return { policy: candidate, managerId: managerFor(project, candidate.role) };
}

function newNotification(kind: string, recipient: UserId | null, now: string): NotificationRecord {
  return {
    id: newNotificationId(),
    kind,
    recipientIds: recipient ? [recipient] : [],
    status: recipient ? 'pending' : 'skipped',
    attempts: 0,
    ...(recipient ? {} : { lastError: 'No manager is assigned for this escalation level.' }),
    lastAttemptAt: now,
  };
}

export interface RaiseEscalationInput {
  type: EscalationType;
  task: Task;
  date: string;
  reasonCategory: string;
  reason: string;
  impact: string;
  nextAction: string;
  revisedEta: string | null;
  originalDue: string;
}

/**
 * Creates an escalation exactly once per (type, task, date). Re-running is a no-op that
 * returns the existing record, so scheduled jobs can safely retry.
 */
export function raiseEscalation(
  project: Project,
  input: RaiseEscalationInput,
  by: UserId | 'system',
  now: string,
  config: OrgConfig,
): { escalation: Escalation; created: boolean } {
  const dedupeKey = `${input.type}:${input.task.id}:${input.date}`;
  const existing = project.escalations.find((e) => e.dedupeKey === dedupeKey);
  if (existing) return { escalation: existing, created: false };

  const { policy, managerId } = resolveLevel(project, config, 1, input.task.ownerId);
  project.counters.escalation += 1;
  const escalation: Escalation = {
    id: sequenceId('ESC', project.counters.escalation, 4),
    dedupeKey,
    type: input.type,
    taskId: input.task.id,
    ownerId: input.task.ownerId,
    level: policy.level,
    severity: maxSeverity(policy.severity, taskSeverity(input.task)),
    originalDue: input.originalDue,
    reasonCategory: input.reasonCategory,
    reason: input.reason,
    impact: input.impact,
    nextAction: input.nextAction,
    revisedEta: input.revisedEta,
    managerRole: policy.role,
    managerId,
    triggeredAt: now,
    triggeredBy: by,
    status: 'open',
    levelSince: now,
    levelHistory: [{ level: policy.level, at: now, managerId, by }],
    notifications: [newNotification(`escalation.${input.type}`, managerId, now)],
  };
  project.escalations.push(escalation);
  recordAudit(project, by, now, 'escalation.raised', escalation.id, {
    taskId: input.task.id,
    type: input.type,
    level: escalation.level,
  });
  return { escalation, created: true };
}

function openEscalationFor(project: Project, taskId: string) {
  return project.escalations.find((e) => e.taskId === taskId && e.status !== 'resolved');
}

export interface ConfirmResult {
  confirmation: TaskConfirmation;
  escalation: Escalation | null;
  replayed: boolean;
}

/**
 * The explicit daily decision on a task that is due (or overdue) today.
 * Completed → closes the task. Not completed → revised ETA (original deadline preserved) and
 * an escalation per policy. A task is never completed automatically.
 */
export function confirmTask(
  project: Project,
  taskId: string,
  input: ConfirmTaskInput,
  ctx: DomainContext,
): ConfirmResult {
  const task = findTask(project, taskId);
  const subject = accessSubjectOf(project);
  const isOwner = task.ownerId === ctx.actor.id;
  if (!isOwner && !can(ctx.actor, 'task.edit_any', subject, ctx.today)) {
    throw forbidden('Only the task owner or the PM can confirm this task.');
  }

  const prior = humanConfirmationOn(task, ctx.today);
  if (prior) {
    if (prior.outcome === input.outcome)
      return { confirmation: prior, escalation: null, replayed: true };
    throw new DomainError('conflict', `This task was already confirmed as ${prior.outcome} today.`);
  }
  if (!isOpen(task)) throw invalidTransition('Only open tasks can be confirmed.');
  if (currentDue(task) > ctx.today) {
    throw invalid('This task is not due yet. Update it from the task view instead.');
  }

  const originalDue = currentDue(task);
  let confirmation: TaskConfirmation;
  let escalation: Escalation | null = null;

  if (input.outcome === 'completed') {
    confirmation = {
      date: ctx.today,
      outcome: 'completed',
      by: ctx.actor.id,
      at: ctx.now,
      notes: input.notes,
      ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
    };
    completeTaskFields(task, ctx.today, input.notes, input.evidenceUrl, ctx.actor.id, ctx.now);
  } else {
    if (input.revisedEta <= ctx.today) throw invalid('Revised ETA must be after today.');
    if (!ctx.config.delayReasons.some((r) => r.id === input.reasonCategory)) {
      throw invalid('Unknown delay reason category.');
    }
    confirmation = {
      date: ctx.today,
      outcome: 'not_completed',
      by: ctx.actor.id,
      at: ctx.now,
      reasonCategory: input.reasonCategory,
      reason: input.reason,
      impact: input.impact,
      nextAction: input.nextAction,
      revisedEta: input.revisedEta,
    };
    reviseDeadline(task, input.revisedEta, `Not completed: ${input.reason}`, ctx);
    task.nextAction = input.nextAction;
    if (task.status === 'not_started') {
      task.status = 'in_progress';
      task.actualStart ??= ctx.today;
    }
    if (ctx.config.escalation.onNotCompleted) {
      escalation = raiseEscalation(
        project,
        {
          type: 'not_completed',
          task,
          date: ctx.today,
          reasonCategory: input.reasonCategory,
          reason: input.reason,
          impact: input.impact,
          nextAction: input.nextAction,
          revisedEta: input.revisedEta,
          originalDue,
        },
        ctx.actor.id,
        ctx.now,
        ctx.config,
      ).escalation;
    }
  }

  task.confirmations.push(confirmation);
  task.updatedAt = ctx.now;
  task.history.push({
    at: ctx.now,
    by: ctx.actor.id,
    action: `confirmed_${input.outcome}`,
    changes: { status: { from: null, to: task.status } },
  });
  recordAudit(project, ctx.actor.id, ctx.now, `task.confirmed.${input.outcome}`, task.id);
  touch(project, ctx.now);
  return { confirmation, escalation, replayed: false };
}

/**
 * Scheduled end-of-day check. For every open task due today or earlier with no human decision
 * today, records `no_response` (never completion) and escalates once per task while an
 * escalation is open. Safe to run repeatedly.
 */
export function recordMissedConfirmations(project: Project, ctx: SystemContext) {
  const result = { unconfirmed: [] as string[], escalated: [] as string[] };
  if (project.status !== 'active') return result;
  if (!isWorkingDay(ctx.today, calendarOf(ctx.config))) return result;

  for (const task of project.tasks) {
    if (!isOpen(task) || currentDue(task) > ctx.today) continue;
    if (humanConfirmationOn(task, ctx.today)) continue;
    const already = task.confirmations.some((c) => c.date === ctx.today && c.by === 'system');
    if (!already) {
      task.confirmations.push({
        date: ctx.today,
        outcome: 'no_response',
        by: 'system',
        at: ctx.now,
      });
      task.history.push({ at: ctx.now, by: 'system', action: 'marked_unconfirmed', changes: {} });
      result.unconfirmed.push(task.id);
    }
    if (ctx.config.escalation.onNoResponse && !openEscalationFor(project, task.id)) {
      const { created, escalation } = raiseEscalation(
        project,
        {
          type: 'no_response',
          task,
          date: ctx.today,
          reasonCategory: 'no_response',
          reason: 'No completion decision was recorded by the end of the working day.',
          impact: '',
          nextAction: 'Owner to confirm status and provide a revised ETA.',
          revisedEta: null,
          originalDue: currentDue(task),
        },
        'system',
        ctx.now,
        ctx.config,
      );
      if (created) result.escalated.push(escalation.id);
    }
  }
  if (result.unconfirmed.length || result.escalated.length) touch(project, ctx.now);
  return result;
}

/** Moves unacknowledged/unresolved escalations up a level once their SLA is exceeded. */
export function applyEscalationSla(project: Project, ctx: SystemContext) {
  const bumped: string[] = [];
  const nowMs = Date.parse(ctx.now);
  const maxLevel = Math.max(...ctx.config.escalation.levels.map((l) => l.level));
  for (const esc of project.escalations) {
    if (esc.status === 'resolved' || esc.level >= maxLevel) continue;
    const policy = ctx.config.escalation.levels.find((l) => l.level === esc.level);
    if (!policy) continue;
    if (nowMs - Date.parse(esc.levelSince) < policy.slaHours * 3_600_000) continue;
    const { policy: next, managerId } = resolveLevel(
      project,
      ctx.config,
      esc.level + 1,
      esc.ownerId,
    );
    if (next.level <= esc.level) continue;
    esc.level = next.level;
    esc.managerRole = next.role;
    esc.managerId = managerId;
    esc.severity = maxSeverity(esc.severity, next.severity);
    esc.levelSince = ctx.now;
    esc.levelHistory.push({ level: next.level, at: ctx.now, managerId, by: 'system' });
    esc.notifications.push(newNotification('escalation.sla_breach', managerId, ctx.now));
    recordAudit(project, 'system', ctx.now, 'escalation.level_raised', esc.id, {
      level: next.level,
    });
    bumped.push(esc.id);
  }
  if (bumped.length) touch(project, ctx.now);
  return bumped;
}

function findEscalation(project: Project, id: string): Escalation {
  const esc = project.escalations.find((e) => e.id === id);
  if (!esc) throw notFound(`Escalation ${id}`);
  return esc;
}

function assertCanManage(project: Project, esc: Escalation, ctx: DomainContext) {
  if (esc.managerId === ctx.actor.id) return;
  if (!can(ctx.actor, 'escalation.manage', accessSubjectOf(project), ctx.today)) {
    throw forbidden(
      'Only the escalation manager, PM, or Delivery Head can act on this escalation.',
    );
  }
}

export function acknowledgeEscalation(project: Project, id: string, ctx: DomainContext) {
  const esc = findEscalation(project, id);
  assertCanManage(project, esc, ctx);
  if (esc.status !== 'open') throw invalidTransition('Only open escalations can be acknowledged.');
  esc.status = 'acknowledged';
  esc.acknowledgedAt = ctx.now;
  esc.acknowledgedBy = ctx.actor.id;
  recordAudit(project, ctx.actor.id, ctx.now, 'escalation.acknowledged', esc.id);
  touch(project, ctx.now);
  return esc;
}

export function resolveEscalation(project: Project, id: string, notes: string, ctx: DomainContext) {
  const esc = findEscalation(project, id);
  assertCanManage(project, esc, ctx);
  if (esc.status === 'resolved') throw invalidTransition('This escalation is already resolved.');
  if (!notes.trim()) throw invalid('Resolution notes are required.');
  esc.status = 'resolved';
  esc.resolvedAt = ctx.now;
  esc.resolvedBy = ctx.actor.id;
  esc.resolutionNotes = notes;
  esc.acknowledgedAt ??= ctx.now;
  esc.acknowledgedBy ??= ctx.actor.id;
  recordAudit(project, ctx.actor.id, ctx.now, 'escalation.resolved', esc.id);
  touch(project, ctx.now);
  return esc;
}

/** Pending notifications across escalations, for the delivery worker. */
export function pendingEscalationNotifications(project: Project) {
  const out: { escalation: Escalation; notification: NotificationRecord }[] = [];
  for (const escalation of project.escalations) {
    for (const notification of escalation.notifications) {
      if (notification.status === 'pending' || notification.status === 'failed') {
        out.push({ escalation, notification });
      }
    }
  }
  return out;
}

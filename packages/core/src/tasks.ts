import { calendarOf, recordAudit, touch, type DomainContext } from './context';
import { workingDaysAfter } from './dates';
import { DomainError, forbidden, invalid, invalidTransition, notFound } from './errors';
import { sequenceId } from './ids';
import { accessSubjectOf, can, canUpdateTask, teamMemberIds } from './rbac';
import type { CreateTaskInput, UpdateTaskInput } from './schemas';
import type { IsoDate, Project, Task, TaskHistoryEntry, TaskStatus } from './types';

export const OPEN_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked'];

export function isOpen(task: Task): boolean {
  return OPEN_STATUSES.includes(task.status);
}

/** The deadline currently in force: the latest revision, else the original. */
export function currentDue(task: Task): IsoDate {
  return task.revisedEnd ?? task.plannedEnd;
}

export function isOverdue(task: Task, today: IsoDate): boolean {
  return isOpen(task) && currentDue(task) < today;
}

/** Working days the task is past its current due date (0 if not overdue). */
export function daysLate(task: Task, today: IsoDate, cal: Parameters<typeof workingDaysAfter>[2]) {
  return isOpen(task) ? workingDaysAfter(currentDue(task), today, cal) : 0;
}

export function findTask(project: Project, taskId: string): Task {
  const task = project.tasks.find((t) => t.id === taskId);
  if (!task) throw notFound(`Task ${taskId}`);
  return task;
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress', 'blocked', 'completed', 'cancelled'],
  in_progress: ['blocked', 'completed', 'cancelled'],
  blocked: ['in_progress', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['not_started'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

function assertAssignable(project: Project, ownerId: string | null): void {
  if (ownerId && !teamMemberIds(project.team).includes(ownerId)) {
    throw invalid('Task owner must be a member of the project team.', { ownerId });
  }
}

function assertDependencies(project: Project, taskId: string, deps: string[]): void {
  const ids = new Set(project.tasks.map((t) => t.id));
  for (const d of deps) {
    if (d === taskId) throw invalid('A task cannot depend on itself.');
    if (!ids.has(d)) throw invalid(`Dependency ${d} does not exist.`);
  }
  // Reject cycles: walk dependencies from each dep and make sure we never reach taskId.
  const graph = new Map(project.tasks.map((t) => [t.id, t.dependencies]));
  graph.set(taskId, deps);
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) throw invalid('Dependencies would create a cycle.');
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(graph.get(cur) ?? []));
  }
}

function nextWbsId(project: Project, parentId: string | null): string {
  if (parentId) {
    const parent = findTask(project, parentId);
    const siblings = project.tasks.filter((t) => t.parentId === parentId).length;
    return `${parent.wbsId}.${siblings + 1}`;
  }
  return String(project.tasks.filter((t) => t.parentId === null).length + 1);
}

/** Builds a task without permission checks. Used by templates and by `createTask`. */
export function buildTask(project: Project, input: CreateTaskInput, by: string, now: string): Task {
  project.counters.task += 1;
  const id = sequenceId('T', project.counters.task, 4);
  if (input.parentId) findTask(project, input.parentId);
  assertDependencies(project, id, input.dependencies);
  return {
    id,
    wbsId: input.wbsId || nextWbsId(project, input.parentId),
    parentId: input.parentId,
    phase: input.phase,
    title: input.title,
    description: input.description,
    ownerId: input.ownerId,
    priority: input.priority,
    status: 'not_started',
    isMilestone: input.isMilestone,
    clientCommitment: input.clientCommitment,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    revisedEnd: null,
    revisions: [],
    actualStart: null,
    actualEnd: null,
    dependencies: input.dependencies,
    blocker: '',
    progress: 0,
    remarks: '',
    nextAction: '',
    confirmations: [],
    comments: [],
    history: [{ at: now, by, action: 'created', changes: {} }],
    createdAt: now,
    createdBy: by,
    updatedAt: now,
  };
}

export function createTask(project: Project, input: CreateTaskInput, ctx: DomainContext): Task {
  const subject = accessSubjectOf(project);
  if (!can(ctx.actor, 'task.create', subject, ctx.today)) {
    throw forbidden('Only the project PM or Delivery Head can create tasks.');
  }
  assertAssignable(project, input.ownerId);
  const task = buildTask(project, input, ctx.actor.id, ctx.now);
  project.tasks.push(task);
  recordAudit(project, ctx.actor.id, ctx.now, 'task.created', task.id, { title: task.title });
  touch(project, ctx.now);
  return task;
}

/** Fields an owner (without manager rights) may change on their own task. */
const OWNER_FIELDS = new Set<keyof UpdateTaskInput>([
  'status',
  'statusReason',
  'closureNotes',
  'evidenceUrl',
  'revisedEnd',
  'revisionReason',
  'actualStart',
  'blocker',
  'progress',
  'remarks',
  'nextAction',
  'expectedUpdatedAt',
]);

export function updateTask(
  project: Project,
  taskId: string,
  input: UpdateTaskInput,
  ctx: DomainContext,
): Task {
  const task = findTask(project, taskId);
  const access = canUpdateTask(ctx.actor, task, accessSubjectOf(project), ctx.today);
  if (access === 'none') throw forbidden('You cannot update this task.');
  if (access === 'own') {
    const extra = Object.keys(input).filter((k) => !OWNER_FIELDS.has(k as keyof UpdateTaskInput));
    if (extra.length) throw forbidden(`Only the PM can change: ${extra.join(', ')}.`);
  }
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== task.updatedAt) {
    throw new DomainError(
      'conflict',
      'This task was changed by someone else. Reload to see the latest version.',
      { currentUpdatedAt: task.updatedAt },
    );
  }

  const changes: TaskHistoryEntry['changes'] = {};
  const set = <K extends keyof Task>(key: K, value: Task[K]) => {
    if (JSON.stringify(task[key]) === JSON.stringify(value)) return;
    changes[key] = { from: task[key], to: value };
    task[key] = value;
  };

  if (input.title !== undefined) set('title', input.title);
  if (input.phase !== undefined) set('phase', input.phase);
  if (input.description !== undefined) set('description', input.description);
  if (input.priority !== undefined) set('priority', input.priority);
  if (input.isMilestone !== undefined) set('isMilestone', input.isMilestone);
  if (input.clientCommitment !== undefined) set('clientCommitment', input.clientCommitment);
  if (input.blocker !== undefined) set('blocker', input.blocker);
  if (input.progress !== undefined) set('progress', input.progress);
  if (input.remarks !== undefined) set('remarks', input.remarks);
  if (input.nextAction !== undefined) set('nextAction', input.nextAction);
  if (input.actualStart !== undefined) set('actualStart', input.actualStart);

  if (input.ownerId !== undefined && input.ownerId !== task.ownerId) {
    assertAssignable(project, input.ownerId);
    if (!input.ownerChangeReason?.trim())
      throw invalid('A reason is required to change the owner.');
    set('ownerId', input.ownerId);
    changes.ownerChangeReason = { from: null, to: input.ownerChangeReason };
  }

  if (input.plannedStart !== undefined) {
    if (input.plannedStart > task.plannedEnd) {
      throw invalid('Planned start cannot be after the original deadline.');
    }
    set('plannedStart', input.plannedStart);
  }

  if (input.dependencies !== undefined) {
    assertDependencies(project, task.id, input.dependencies);
    set('dependencies', input.dependencies);
  }

  if (input.revisedEnd !== undefined && input.revisedEnd !== currentDue(task)) {
    reviseDeadline(task, input.revisedEnd, input.revisionReason ?? '', ctx);
    changes.revisedEnd = { from: task.revisions.at(-1)!.from, to: input.revisedEnd };
  }

  if (input.status !== undefined && input.status !== task.status) {
    const previous = task.status;
    applyStatus(task, input.status, input, access, ctx);
    changes.status = { from: previous, to: task.status };
  }

  if (Object.keys(changes).length === 0) return task;
  task.updatedAt = ctx.now;
  task.history.push({ at: ctx.now, by: ctx.actor.id, action: 'updated', changes });
  recordAudit(project, ctx.actor.id, ctx.now, 'task.updated', task.id, {
    fields: Object.keys(changes),
  });
  touch(project, ctx.now);
  return task;
}

/** Records a new deadline while preserving the original and every previous revision. */
export function reviseDeadline(
  task: Task,
  to: IsoDate,
  reason: string,
  ctx: Pick<DomainContext, 'actor' | 'now'>,
): void {
  if (!reason.trim()) throw invalid('A reason is required when revising a deadline.');
  if (to < task.plannedStart) throw invalid('Revised deadline cannot be before the planned start.');
  task.revisions.push({ from: currentDue(task), to, reason, by: ctx.actor.id, at: ctx.now });
  task.revisedEnd = to;
}

function applyStatus(
  task: Task,
  to: TaskStatus,
  input: UpdateTaskInput,
  access: 'any' | 'own',
  ctx: DomainContext,
): void {
  const from = task.status;
  if (!canTransition(from, to)) {
    throw invalidTransition(`A task cannot move from ${from} to ${to}.`);
  }
  if ((from === 'completed' || from === 'cancelled') && access !== 'any') {
    throw forbidden('Only the PM can reopen a closed task.');
  }
  if ((from === 'completed' || to === 'cancelled') && !input.statusReason?.trim()) {
    throw invalid('A reason is required to reopen or cancel a task.');
  }
  if (to === 'blocked' && !(input.blocker ?? task.blocker).trim()) {
    throw invalid('Describe the blocker when marking a task as blocked.');
  }
  if (to === 'completed') {
    if (!input.closureNotes?.trim())
      throw invalid('Closure notes are required to complete a task.');
    completeTaskFields(
      task,
      ctx.today,
      input.closureNotes,
      input.evidenceUrl,
      ctx.actor.id,
      ctx.now,
    );
    return;
  }
  if (to === 'in_progress' && !task.actualStart) task.actualStart = ctx.today;
  if (from === 'completed') {
    task.actualEnd = null;
    task.progress = Math.min(task.progress, 90);
  }
  task.status = to;
}

export function completeTaskFields(
  task: Task,
  today: IsoDate,
  notes: string,
  evidenceUrl: string | undefined,
  by: string,
  now: string,
): void {
  task.status = 'completed';
  task.actualEnd = today;
  task.actualStart ??= today;
  task.progress = 100;
  task.blocker = '';
  task.comments.push({
    id: `C-${task.comments.length + 1}`,
    at: now,
    by,
    body: `Closure notes: ${notes}`,
    ...(evidenceUrl ? { evidenceUrl } : {}),
  });
}

export function addComment(
  project: Project,
  taskId: string,
  body: string,
  evidenceUrl: string | undefined,
  ctx: DomainContext,
) {
  const task = findTask(project, taskId);
  if (canUpdateTask(ctx.actor, task, accessSubjectOf(project), ctx.today) === 'none') {
    throw forbidden('You cannot comment on this task.');
  }
  project.counters.comment += 1;
  const comment = {
    id: sequenceId('C', project.counters.comment, 5),
    at: ctx.now,
    by: ctx.actor.id,
    body,
    ...(evidenceUrl ? { evidenceUrl } : {}),
  };
  task.comments.push(comment);
  task.updatedAt = ctx.now;
  touch(project, ctx.now);
  return comment;
}

/** Tasks that require a decision today from `userId`: open and due today or earlier. */
export function tasksNeedingDecision(project: Project, userId: string, today: IsoDate): Task[] {
  return project.tasks.filter(
    (t) =>
      t.ownerId === userId && isOpen(t) && currentDue(t) <= today && !humanConfirmationOn(t, today),
  );
}

export function humanConfirmationOn(task: Task, date: IsoDate) {
  return task.confirmations.find((c) => c.date === date && c.by !== 'system');
}

export function ageingDays(task: Task, today: IsoDate, ctx: Pick<DomainContext, 'config'>) {
  return daysLate(task, today, calendarOf(ctx.config));
}

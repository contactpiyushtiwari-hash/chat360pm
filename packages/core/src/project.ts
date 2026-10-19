import { calendarOf, recordAudit, touch, type DomainContext } from './context';
import { addDays, daysBetween, weekStart } from './dates';
import { forbidden, invalid } from './errors';
import { newProjectId, randomId } from './ids';
import { accessSubjectOf, can, canCreateProject, taskOwnerIdsOf, teamMemberIds } from './rbac';
import type { CreateProjectInput, UpdateProjectInput, UpdateTeamInput } from './schemas';
import { currentDue, isOpen, isOverdue, buildTask } from './tasks';
import { findTemplate, planFromTemplate } from './templates';
import { GLOBAL_ROLE_LABELS } from './types';
import type {
  DirectoryUser,
  IsoDate,
  Project,
  ProjectHealth,
  ProjectIndexEntry,
  ProjectRole,
  ProjectSummary,
  ProjectTeam,
  TeamChange,
  UserId,
} from './types';

/** Folder names must be safe for OneDrive: strip characters OneDrive rejects. */
export function safeFolderName(s: string): string {
  return s
    .replace(/["*:<>?/\\|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export interface CreateProjectOptions {
  /** Looks up directory users so team assignments can be validated. */
  findUser: (id: UserId) => DirectoryUser | undefined;
  id?: string;
}

export function createProject(
  input: CreateProjectInput,
  ctx: DomainContext,
  options: CreateProjectOptions,
): Project {
  if (!canCreateProject(ctx.actor)) {
    throw forbidden('Only Project Managers and the Delivery Head can create projects.');
  }
  const template = findTemplate(input.templateId);
  if (!template) throw invalid('Unknown project template.', { templateId: input.templateId });
  const destination = ctx.config.destinations.find((d) => d.id === input.destinationId);
  if (!destination) throw invalid('Destination is not an approved OneDrive location.');
  if (!ctx.config.projectCategories.includes(input.category)) {
    throw invalid('Unknown project category.');
  }

  const team: ProjectTeam = {
    pm: input.pmId,
    tech: [...new Set(input.techIds)],
    fde: input.fdeId,
    salesPoc: input.salesPocId,
    csm: input.csmId,
    deliveryHead: input.deliveryHeadId,
  };
  validateTeam(team, options.findUser);

  const id = options.id ?? newProjectId();
  const folderName = safeFolderName(`${id} ${input.clientName} - ${input.name}`);
  const project: Project = {
    schemaVersion: 1,
    id,
    revision: 1,
    clientName: input.clientName,
    name: input.name,
    category: input.category,
    status: 'active',
    startDate: input.startDate,
    targetGoLive: input.targetGoLive,
    languages: input.languages,
    integrations: input.integrations,
    qaUatWorkflow: input.qaUatWorkflow,
    templateId: input.templateId,
    destinationId: destination.id,
    folderPath: `${destination.path}/${folderName}`,
    team,
    formerPms: [],
    teamHistory: [],
    counters: { task: 0, api: 0, escalation: 0, comment: 0, comm: 0 },
    tasks: [],
    apis: [],
    escalations: [],
    transfers: [],
    documents: [],
    communications: [],
    workbook: {
      driveItemId: null,
      webUrl: null,
      fileName: `${safeFolderName(`${input.clientName} - ${input.name}`)} - Tracker.xlsx`,
      state: 'not_created',
      syncedRevision: 0,
      lastSyncedAt: null,
      lastAttemptAt: null,
      lastError: null,
      attempts: 0,
      rowHashes: {},
      conflicts: [],
    },
    audit: [],
    appliedOperations: [],
    createdAt: ctx.now,
    createdBy: ctx.actor.id,
    updatedAt: ctx.now,
  };

  for (const role of ['pm', 'tech', 'fde', 'sales_poc', 'csm', 'delivery_head'] as ProjectRole[]) {
    const to = roleMembers(team, role);
    if (to.length) {
      project.teamHistory.push(teamChange(role, [], to, ctx, 'Project created'));
    }
  }

  const plan = planFromTemplate(
    template,
    input.startDate,
    input.targetGoLive,
    team,
    calendarOf(ctx.config),
  );
  for (const t of plan) project.tasks.push(buildTask(project, t, 'system', ctx.now));

  recordAudit(project, ctx.actor.id, ctx.now, 'project.created', id, {
    templateId: template.id,
    tasks: project.tasks.length,
  });
  return project;
}

function validateTeam(team: ProjectTeam, findUser: CreateProjectOptions['findUser']) {
  const check = (id: UserId | null, label: string, role?: DirectoryUser['roles'][number]) => {
    if (!id) return;
    const u = findUser(id);
    if (!u || u.status === 'deactivated') throw invalid(`${label} must be an active employee.`);
    if (role && !u.roles.includes(role)) {
      throw invalid(`${label} must hold the ${GLOBAL_ROLE_LABELS[role]} role.`);
    }
  };
  check(team.pm, 'Project Manager', 'pm');
  team.tech.forEach((t) => check(t, 'Tech team member'));
  check(team.fde, 'FDE');
  check(team.salesPoc, 'Sales POC');
  check(team.csm, 'Customer Success Manager');
  check(team.deliveryHead, 'Delivery and Operations Head', 'delivery_head');
}

export function roleMembers(team: ProjectTeam, role: ProjectRole): UserId[] {
  switch (role) {
    case 'pm':
      return [team.pm];
    case 'tech':
      return team.tech;
    case 'fde':
      return team.fde ? [team.fde] : [];
    case 'sales_poc':
      return team.salesPoc ? [team.salesPoc] : [];
    case 'csm':
      return team.csm ? [team.csm] : [];
    case 'delivery_head':
      return team.deliveryHead ? [team.deliveryHead] : [];
  }
}

export function teamChange(
  role: ProjectRole,
  from: UserId[],
  to: UserId[],
  ctx: Pick<DomainContext, 'actor' | 'now'>,
  reason: string,
  transferId?: string,
): TeamChange {
  return {
    id: `TC-${randomId(8)}`,
    at: ctx.now,
    by: ctx.actor.id,
    role,
    from,
    to,
    reason,
    ...(transferId ? { transferId } : {}),
  };
}

export function updateProject(project: Project, input: UpdateProjectInput, ctx: DomainContext) {
  if (!can(ctx.actor, 'project.edit', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the PM or Delivery Head can edit project details.');
  }
  if (input.category && !ctx.config.projectCategories.includes(input.category)) {
    throw invalid('Unknown project category.');
  }
  if (input.targetGoLive && input.targetGoLive < project.startDate) {
    throw invalid('Target go-live must be on or after the start date.');
  }
  const changed: string[] = [];
  const { reason, ...fields } = input;
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const key = k as keyof typeof fields;
    if (JSON.stringify(project[key]) !== JSON.stringify(v)) {
      (project as unknown as Record<string, unknown>)[key] = v;
      changed.push(key);
    }
  }
  if (!changed.length) return project;
  recordAudit(project, ctx.actor.id, ctx.now, 'project.updated', project.id, {
    fields: changed,
    reason,
  });
  touch(project, ctx.now);
  return project;
}

/**
 * Changes non-PM team roles. The PM changes only via the transfer workflow so that
 * every PM change has a reason, an approver and a handover record (PRD-TRANSFER-001).
 * Task owners are never changed implicitly.
 */
export function updateTeam(
  project: Project,
  input: UpdateTeamInput,
  ctx: DomainContext,
  findUser: CreateProjectOptions['findUser'],
) {
  if (!can(ctx.actor, 'project.team.edit', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the PM or Delivery Head can change the project team.');
  }
  const next: ProjectTeam = {
    ...project.team,
    tech: input.techIds ? [...new Set(input.techIds)] : project.team.tech,
    fde: input.fdeId !== undefined ? input.fdeId : project.team.fde,
    salesPoc: input.salesPocId !== undefined ? input.salesPocId : project.team.salesPoc,
    csm: input.csmId !== undefined ? input.csmId : project.team.csm,
    deliveryHead:
      input.deliveryHeadId !== undefined ? input.deliveryHeadId : project.team.deliveryHead,
  };
  validateTeam(next, findUser);
  const changes: TeamChange[] = [];
  for (const role of ['tech', 'fde', 'sales_poc', 'csm', 'delivery_head'] as ProjectRole[]) {
    const from = roleMembers(project.team, role);
    const to = roleMembers(next, role);
    if (JSON.stringify([...from].sort()) !== JSON.stringify([...to].sort())) {
      changes.push(teamChange(role, from, to, ctx, input.reason));
    }
  }
  if (!changes.length) return [];
  project.team = next;
  project.teamHistory.push(...changes);
  recordAudit(project, ctx.actor.id, ctx.now, 'project.team_updated', project.id, {
    roles: changes.map((c) => c.role),
  });
  touch(project, ctx.now);
  return changes;
}

/**
 * Rule-based health. These are explicit, documented thresholds (docs/prd.md PRD-ANALYTICS-003),
 * not a predictive score.
 */
export function assessHealth(
  project: Project,
  today: IsoDate,
): { health: ProjectHealth; reasons: string[] } {
  if (project.status !== 'active')
    return { health: 'green', reasons: [`Project is ${project.status}`] };
  const red: string[] = [];
  const amber: string[] = [];
  const overdue = project.tasks.filter((t) => isOverdue(t, today));
  const open = project.tasks.filter(isOpen);
  const done = project.tasks.filter((t) => t.status === 'completed').length;
  const active = project.tasks.filter((t) => t.status !== 'cancelled').length;
  const completion = active ? done / active : 1;
  const daysToGoLive = daysBetween(today, project.targetGoLive);
  const openEsc = project.escalations.filter((e) => e.status !== 'resolved');

  if (openEsc.some((e) => e.severity === 'high' || e.severity === 'critical')) {
    red.push('High or critical escalation is open');
  } else if (openEsc.length) {
    amber.push(`${openEsc.length} open escalation(s)`);
  }
  if (overdue.length >= 3) red.push(`${overdue.length} tasks overdue`);
  else if (overdue.length) amber.push(`${overdue.length} task(s) overdue`);
  if (daysToGoLive < 0 && open.length) red.push('Target go-live date has passed with open tasks');
  else if (daysToGoLive <= 14 && completion < 0.7)
    red.push('Go-live within 14 days and under 70% complete');
  else if (daysToGoLive <= 30 && completion < 0.5)
    amber.push('Go-live within 30 days and under 50% complete');
  const lateApis = project.apis.filter(
    (a) => a.readiness !== 'ready' && a.targetDate !== null && a.targetDate < today,
  );
  if (lateApis.length) amber.push(`${lateApis.length} API dependency(ies) past target date`);

  if (red.length) return { health: 'red', reasons: [...red, ...amber] };
  if (amber.length) return { health: 'amber', reasons: amber };
  return { health: 'green', reasons: ['No overdue work, escalations or go-live risk detected'] };
}

export function summarizeProject(project: Project, today: IsoDate): ProjectSummary {
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const { health, reasons } = assessHealth(project, today);
  return {
    openTasks: project.tasks.filter(isOpen).length,
    overdueTasks: project.tasks.filter((t) => isOverdue(t, today)).length,
    dueThisWeek: project.tasks.filter(
      (t) => isOpen(t) && currentDue(t) >= ws && currentDue(t) <= we,
    ).length,
    completedTasks: project.tasks.filter((t) => t.status === 'completed').length,
    totalTasks: project.tasks.filter((t) => t.status !== 'cancelled').length,
    openEscalations: project.escalations.filter((e) => e.status !== 'resolved').length,
    pendingApis: project.apis.filter((a) => a.readiness !== 'ready').length,
    health,
    healthReasons: reasons,
    computedFor: today,
  };
}

export function indexEntryOf(project: Project, today: IsoDate): ProjectIndexEntry {
  return {
    id: project.id,
    name: project.name,
    clientName: project.clientName,
    category: project.category,
    status: project.status,
    pmId: project.team.pm,
    memberIds: teamMemberIds(project.team),
    taskOwnerIds: taskOwnerIdsOf(project.tasks),
    formerPms: project.formerPms,
    deliveryHeadId: project.team.deliveryHead,
    folderPath: project.folderPath,
    workbookUrl: project.workbook.webUrl,
    workbookState: project.workbook.state,
    startDate: project.startDate,
    targetGoLive: project.targetGoLive,
    summary: summarizeProject(project, today),
    transfers: project.transfers.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      fromPmId: t.fromPmId,
      proposedPmId: t.proposedPmId,
      newPmId: t.newPmId,
      requestedBy: t.requestedBy,
      createdAt: t.createdAt,
      reason: t.reason.slice(0, 200),
    })),
    openEscalations: project.escalations
      .filter((e) => e.status !== 'resolved')
      .map((e) => ({
        id: e.id,
        taskId: e.taskId,
        taskTitle: project.tasks.find((t) => t.id === e.taskId)?.title ?? '',
        ownerId: e.ownerId,
        managerId: e.managerId,
        level: e.level,
        severity: e.severity,
        status: e.status,
        type: e.type,
        triggeredAt: e.triggeredAt,
        reason: e.reason.slice(0, 200),
      })),
    revision: project.revision,
    updatedAt: project.updatedAt,
  };
}

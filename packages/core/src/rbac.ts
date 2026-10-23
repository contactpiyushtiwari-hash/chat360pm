import type {
  DirectoryUser,
  FormerPmAccess,
  GlobalRole,
  IsoDate,
  Project,
  ProjectIndexEntry,
  ProjectRole,
  ProjectTeam,
  Task,
  UserId,
} from './types';

/** The minimum a permission check needs to know about a project. */
export interface AccessSubject {
  pmId: UserId;
  deliveryHeadId: UserId | null;
  /** Everyone holding any project role. */
  memberIds: UserId[];
  taskOwnerIds: UserId[];
  formerPms: FormerPmAccess[];
  /** Present when checking against the full project document. */
  team?: ProjectTeam;
}

export function accessSubjectOf(p: Project | ProjectIndexEntry): AccessSubject {
  if ('team' in p) {
    return {
      pmId: p.team.pm,
      deliveryHeadId: p.team.deliveryHead,
      memberIds: teamMemberIds(p.team),
      taskOwnerIds: taskOwnerIdsOf(p.tasks),
      formerPms: p.formerPms,
      team: p.team,
    };
  }
  return {
    pmId: p.pmId,
    deliveryHeadId: p.deliveryHeadId,
    memberIds: p.memberIds,
    taskOwnerIds: p.taskOwnerIds,
    formerPms: p.formerPms,
  };
}

export function taskOwnerIdsOf(tasks: Task[]): UserId[] {
  return uniq(tasks.map((t) => t.ownerId).filter((x): x is UserId => !!x));
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function hasGlobalRole(user: DirectoryUser, role: GlobalRole): boolean {
  return user.status !== 'deactivated' && user.roles.includes(role);
}

export function isActive(user: DirectoryUser): boolean {
  return user.status === 'active' || user.status === 'deactivation_requested';
}

export function teamMemberIds(team: ProjectTeam): UserId[] {
  return uniq(
    [team.pm, ...team.tech, team.fde, team.salesPoc, team.csm, team.deliveryHead].filter(
      (x): x is UserId => !!x,
    ),
  );
}

export function projectRolesOf(team: ProjectTeam, userId: UserId): ProjectRole[] {
  const roles: ProjectRole[] = [];
  if (team.pm === userId) roles.push('pm');
  if (team.tech.includes(userId)) roles.push('tech');
  if (team.fde === userId) roles.push('fde');
  if (team.salesPoc === userId) roles.push('sales_poc');
  if (team.csm === userId) roles.push('csm');
  if (team.deliveryHead === userId) roles.push('delivery_head');
  return roles;
}

export type ProjectAccessLevel = 'none' | 'read' | 'contributor' | 'manager' | 'portfolio';

/**
 * Access ladder for a project:
 * - portfolio: Delivery and Operations Head (global) — full visibility and reassignment.
 * - manager: the project's current PM or assigned Delivery Head.
 * - contributor: any other team member, or a task owner.
 * - read: a former PM inside the configured retention window.
 *
 * Administrators get no implicit project access (PRD-SEC-004).
 */
export function projectAccess(
  user: DirectoryUser,
  subject: AccessSubject,
  today: IsoDate,
): ProjectAccessLevel {
  if (!isActive(user)) return 'none';
  if (hasGlobalRole(user, 'delivery_head')) return 'portfolio';
  if (subject.pmId === user.id || subject.deliveryHeadId === user.id) return 'manager';
  if (subject.memberIds.includes(user.id) || subject.taskOwnerIds.includes(user.id)) {
    return 'contributor';
  }
  if (subject.formerPms.some((f) => f.userId === user.id && f.until >= today)) return 'read';
  return 'none';
}

const RANK: Record<ProjectAccessLevel, number> = {
  none: 0,
  read: 1,
  contributor: 2,
  manager: 3,
  portfolio: 4,
};

export type ProjectAction =
  | 'project.view'
  | 'project.edit'
  | 'project.team.edit'
  | 'task.create'
  | 'task.edit_any'
  | 'api.manage'
  | 'escalation.manage'
  | 'tracker.download'
  | 'transfer.request'
  | 'finance.view'
  | 'finance.edit'
  | 'transfer.review'
  | 'pm.reassign';

const REQUIRED: Record<ProjectAction, ProjectAccessLevel> = {
  'project.view': 'read',
  'project.edit': 'manager',
  'project.team.edit': 'manager',
  'task.create': 'manager',
  'task.edit_any': 'manager',
  'api.manage': 'contributor',
  'escalation.manage': 'manager',
  'tracker.download': 'read',
  'transfer.request': 'manager',
  'finance.view': 'contributor',
  'finance.edit': 'contributor',
  'transfer.review': 'portfolio',
  'pm.reassign': 'portfolio',
};

export function can(
  user: DirectoryUser,
  action: ProjectAction,
  subject: AccessSubject,
  today: IsoDate,
): boolean {
  const level = projectAccess(user, subject, today);
  if (RANK[level] < RANK[REQUIRED[action]]) return false;
  // Only the current PM may raise a transfer for their own project.
  if (action === 'transfer.request') return subject.pmId === user.id;
  // Commercial figures: contributors see them only as Sales POC or CSM, and only Sales POC edits.
  if ((action === 'finance.view' || action === 'finance.edit') && level === 'contributor') {
    if (!subject.team) return false;
    const roles = projectRolesOf(subject.team, user.id);
    return roles.includes('sales_poc') || (action === 'finance.view' && roles.includes('csm'));
  }
  // API records are technical work: limit contributors to tech / FDE / PM roles.
  if (action === 'api.manage' && level === 'contributor') {
    if (!subject.team) return false;
    const roles = projectRolesOf(subject.team, user.id);
    return roles.includes('tech') || roles.includes('fde');
  }
  return true;
}

/** Owners can update execution fields of their own tasks; managers can edit any task. */
export function canUpdateTask(
  user: DirectoryUser,
  task: Task,
  subject: AccessSubject,
  today: IsoDate,
): 'any' | 'own' | 'none' {
  if (can(user, 'task.edit_any', subject, today)) return 'any';
  const level = projectAccess(user, subject, today);
  if (RANK[level] >= RANK.contributor && task.ownerId === user.id) return 'own';
  return 'none';
}

export function canCreateProject(user: DirectoryUser): boolean {
  return isActive(user) && (hasGlobalRole(user, 'pm') || hasGlobalRole(user, 'delivery_head'));
}

export function canAdminister(user: DirectoryUser): boolean {
  return isActive(user) && hasGlobalRole(user, 'admin');
}

export function canViewPortfolio(user: DirectoryUser): boolean {
  return isActive(user) && hasGlobalRole(user, 'delivery_head');
}

import {
  addWorkingDays,
  onOrNextWorkingDay,
  workingDaysInclusive,
  type WorkCalendar,
} from './dates';
import type { CreateTaskInput } from './schemas';
import type { Priority, ProjectTeam, UserId } from './types';

type OwnerRole = 'pm' | 'tech' | 'fde' | 'sales_poc' | 'csm' | 'none';

interface TemplateTask {
  phase: string;
  title: string;
  /** Relative share of the project duration. */
  weight: number;
  owner: OwnerRole;
  priority?: Priority;
  milestone?: boolean;
  clientCommitment?: boolean;
  /** Indexes (within the template) of tasks this one depends on. Default: previous task. */
  dependsOn?: number[];
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  tasks: TemplateTask[];
}

/**
 * Built-in starter plans. They are a starting point: the PM edits dates and owners afterwards.
 * Chat360 can replace these once its real tracker template is supplied (see ADR-008).
 */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'standard_bot',
    label: 'Standard bot implementation',
    description: 'Discovery → BRD → flow design → build → integrations → QA → UAT → go-live.',
    tasks: [
      {
        phase: 'Discovery',
        title: 'Commercial handover and SOW review',
        weight: 1,
        owner: 'sales_poc',
        dependsOn: [],
      },
      {
        phase: 'Discovery',
        title: 'Kick-off meeting with client',
        weight: 1,
        owner: 'pm',
        clientCommitment: true,
      },
      { phase: 'Requirements', title: 'Prepare BRD', weight: 3, owner: 'pm' },
      {
        phase: 'Requirements',
        title: 'BRD sign-off',
        weight: 1,
        owner: 'pm',
        milestone: true,
        clientCommitment: true,
      },
      { phase: 'Design', title: 'Bot flow design', weight: 3, owner: 'fde' },
      { phase: 'Build', title: 'Build bot flows', weight: 6, owner: 'fde', priority: 'high' },
      {
        phase: 'Integrations',
        title: 'Collect client API documentation',
        weight: 2,
        owner: 'tech',
        dependsOn: [3],
      },
      {
        phase: 'Integrations',
        title: 'Implement and test integrations',
        weight: 5,
        owner: 'tech',
        priority: 'high',
        dependsOn: [6],
      },
      { phase: 'QA', title: 'Internal QA', weight: 3, owner: 'tech', dependsOn: [5, 7] },
      { phase: 'UAT', title: 'Client UAT', weight: 4, owner: 'csm', clientCommitment: true },
      {
        phase: 'UAT',
        title: 'UAT sign-off',
        weight: 1,
        owner: 'pm',
        milestone: true,
        clientCommitment: true,
      },
      {
        phase: 'Go-Live',
        title: 'Production go-live',
        weight: 1,
        owner: 'fde',
        milestone: true,
        priority: 'critical',
        clientCommitment: true,
      },
      { phase: 'Hypercare', title: 'Hypercare and adoption check-in', weight: 2, owner: 'csm' },
    ],
  },
  {
    id: 'integration_only',
    label: 'Integration project',
    description: 'API-led delivery: requirements → API readiness → build → test → go-live.',
    tasks: [
      {
        phase: 'Discovery',
        title: 'Scope and SOW review',
        weight: 1,
        owner: 'sales_poc',
        dependsOn: [],
      },
      {
        phase: 'Requirements',
        title: 'Integration requirements and API list',
        weight: 2,
        owner: 'tech',
      },
      {
        phase: 'Build',
        title: 'Implement integrations',
        weight: 5,
        owner: 'tech',
        priority: 'high',
      },
      { phase: 'QA', title: 'Integration testing', weight: 3, owner: 'tech' },
      { phase: 'UAT', title: 'Client UAT', weight: 2, owner: 'csm', clientCommitment: true },
      {
        phase: 'Go-Live',
        title: 'Go-live',
        weight: 1,
        owner: 'pm',
        milestone: true,
        priority: 'critical',
        clientCommitment: true,
      },
    ],
  },
  {
    id: 'blank',
    label: 'Blank project',
    description: 'No starter tasks. The PM builds the WBS manually.',
    tasks: [],
  },
];

export function findTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

function ownerFor(role: OwnerRole, team: ProjectTeam): UserId | null {
  switch (role) {
    case 'pm':
      return team.pm;
    case 'tech':
      return team.tech[0] ?? null;
    case 'fde':
      return team.fde;
    case 'sales_poc':
      return team.salesPoc;
    case 'csm':
      return team.csm;
    case 'none':
      return null;
  }
}

/**
 * Lays template tasks sequentially across the working days between start and go-live,
 * proportional to weight. Dependencies are expressed as template indexes and mapped to
 * the task ids that will be assigned in order (T-0001, T-0002, ...), offset by `firstTaskNumber`.
 */
export function planFromTemplate(
  template: ProjectTemplate,
  start: string,
  goLive: string,
  team: ProjectTeam,
  cal: WorkCalendar,
  firstTaskNumber = 1,
): CreateTaskInput[] {
  if (template.tasks.length === 0) return [];
  const startDay = onOrNextWorkingDay(start, cal);
  const totalDays = Math.max(workingDaysInclusive(startDay, goLive, cal), template.tasks.length);
  const totalWeight = template.tasks.reduce((s, t) => s + t.weight, 0);
  const idOf = (i: number) => `T-${String(firstTaskNumber + i).padStart(4, '0')}`;
  let offset = 0;
  const phaseNumbers = new Map<string, number>();
  const phaseCounters = new Map<string, number>();

  return template.tasks.map((t, i) => {
    const span = Math.max(1, Math.round((t.weight / totalWeight) * totalDays));
    const plannedStart = addWorkingDays(startDay, Math.min(offset, totalDays - 1), cal);
    const plannedEnd = addWorkingDays(startDay, Math.min(offset + span - 1, totalDays - 1), cal);
    offset += span;
    if (!phaseNumbers.has(t.phase)) phaseNumbers.set(t.phase, phaseNumbers.size + 1);
    const n = (phaseCounters.get(t.phase) ?? 0) + 1;
    phaseCounters.set(t.phase, n);
    const deps = t.dependsOn ?? (i > 0 ? [i - 1] : []);
    return {
      title: t.title,
      phase: t.phase,
      description: '',
      ownerId: ownerFor(t.owner, team),
      priority: t.priority ?? 'medium',
      plannedStart,
      plannedEnd,
      isMilestone: t.milestone ?? false,
      clientCommitment: t.clientCommitment ?? false,
      dependencies: deps.map(idOf),
      parentId: null,
      wbsId: `${phaseNumbers.get(t.phase)}.${n}`,
    };
  });
}

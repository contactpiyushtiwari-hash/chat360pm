import { toExcelSerial } from '../dates';
import { currentDue, humanConfirmationOn } from '../tasks';
import { lastWeekRows, thisWeekRows, type WeekTaskRow } from '../weekly';
import {
  GLOBAL_ROLE_LABELS,
  PRIORITY_LABELS,
  PROJECT_ROLE_LABELS,
  TASK_STATUS_LABELS,
  type ApiReadiness,
  type ApiTesting,
  type OrgConfig,
  type Project,
  type UserId,
} from '../types';

export type CellValue = string | number;
export type ColumnType = 'text' | 'longtext' | 'date' | 'number' | 'percent';

export interface ColumnDef {
  header: string;
  type: ColumnType;
  width: number;
  /** Excel formula in table input form, e.g. `IF([@Status]="Completed",0,1)`. Not app-managed. */
  formula?: string;
  list?: readonly string[];
}

export interface TableDef {
  name: string;
  sheet: string;
  /** 1-based row of the table header. */
  headerRow: number;
  /** Headers whose values (joined) identify a row. */
  keyColumns: string[];
  columns: ColumnDef[];
}

export const SHEETS = [
  'Gantt Chart',
  'WBS',
  'API List Pending',
  'Escalation Matrix',
  'Last Week Task',
  'This Week Task',
] as const;

const STATUS_LIST = Object.values(TASK_STATUS_LABELS);
const PRIORITY_LIST = Object.values(PRIORITY_LABELS);
const READINESS_LABELS: Record<ApiReadiness, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  ready: 'Ready',
  blocked: 'Blocked',
};
const TESTING_LABELS: Record<ApiTesting, string> = {
  not_tested: 'Not Tested',
  in_testing: 'In Testing',
  passed: 'Passed',
  failed: 'Failed',
};
const SEVERITY_LIST = ['Low', 'Medium', 'High', 'Critical'];
const YES_NO = ['Yes', 'No'];

/** Excel weekend mask for NETWORKDAYS.INTL: 7 chars Mon..Sun, "1" = non-working day. */
export function weekendMask(workingDays: number[]): string {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => (workingDays.includes(d) ? '0' : '1')).join('');
}

export function trackerTables(config: Pick<OrgConfig, 'workingDays'>): TableDef[] {
  const mask = weekendMask(config.workingDays);
  return [
    {
      name: 'tblGantt',
      sheet: 'Gantt Chart',
      headerRow: 5,
      keyColumns: ['Task ID'],
      columns: [
        { header: 'Task ID', type: 'text', width: 10 },
        { header: 'WBS ID', type: 'text', width: 8 },
        { header: 'Milestone / Task', type: 'text', width: 38 },
        { header: 'Type', type: 'text', width: 11, list: ['Milestone', 'Task'] },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Planned Start', type: 'date', width: 13 },
        { header: 'Planned End', type: 'date', width: 13 },
        { header: 'Revised End', type: 'date', width: 13 },
        { header: 'Status', type: 'text', width: 13, list: STATUS_LIST },
        { header: 'Dependencies', type: 'text', width: 16 },
        { header: '% Complete', type: 'percent', width: 11 },
      ],
    },
    {
      name: 'tblWBS',
      sheet: 'WBS',
      headerRow: 5,
      keyColumns: ['Task ID'],
      columns: [
        { header: 'WBS ID', type: 'text', width: 8 },
        { header: 'Task ID', type: 'text', width: 10 },
        { header: 'Phase', type: 'text', width: 15 },
        { header: 'Task', type: 'text', width: 36 },
        { header: 'Description', type: 'longtext', width: 36 },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Priority', type: 'text', width: 10, list: PRIORITY_LIST },
        { header: 'Planned Start', type: 'date', width: 13 },
        { header: 'Planned End', type: 'date', width: 13 },
        { header: 'Revised End', type: 'date', width: 13 },
        {
          header: 'Current Due',
          type: 'date',
          width: 13,
          formula: 'IF([@[Revised End]]<>"",[@[Revised End]],[@[Planned End]])',
        },
        { header: 'Actual Start', type: 'date', width: 13 },
        { header: 'Actual End', type: 'date', width: 13 },
        { header: 'Status', type: 'text', width: 13, list: STATUS_LIST },
        { header: 'Dependencies', type: 'text', width: 16 },
        {
          header: 'Days Late',
          type: 'number',
          width: 10,
          formula: `IF(OR([@Status]="Completed",[@Status]="Cancelled",[@[Current Due]]=""),"",MAX(0,NETWORKDAYS.INTL([@[Current Due]],TODAY(),"${mask}")-1))`,
        },
        { header: 'Remarks', type: 'longtext', width: 30 },
      ],
    },
    {
      name: 'tblAPIs',
      sheet: 'API List Pending',
      headerRow: 5,
      keyColumns: ['API ID'],
      columns: [
        { header: 'API ID', type: 'text', width: 9 },
        { header: 'API Name', type: 'text', width: 26 },
        { header: 'Purpose', type: 'longtext', width: 30 },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Readiness', type: 'text', width: 13, list: Object.values(READINESS_LABELS) },
        { header: 'Testing Status', type: 'text', width: 14, list: Object.values(TESTING_LABELS) },
        { header: 'Blocker', type: 'longtext', width: 26 },
        { header: 'Dependency', type: 'text', width: 22 },
        { header: 'Next Action', type: 'longtext', width: 26 },
        { header: 'Target Date', type: 'date', width: 13 },
        { header: 'Technical Reference', type: 'text', width: 30 },
        {
          header: 'Days to Target',
          type: 'number',
          width: 13,
          formula: 'IF(OR([@Readiness]="Ready",[@[Target Date]]=""),"",[@[Target Date]]-TODAY())',
        },
      ],
    },
    {
      name: 'tblEscalationMatrix',
      sheet: 'Escalation Matrix',
      headerRow: 5,
      keyColumns: ['Level'],
      columns: [
        { header: 'Level', type: 'number', width: 8 },
        { header: 'Responsible Role', type: 'text', width: 28 },
        { header: 'Manager Mapping', type: 'text', width: 26 },
        { header: 'Severity', type: 'text', width: 10, list: SEVERITY_LIST },
        { header: 'Escalation Condition', type: 'longtext', width: 48 },
        { header: 'SLA (hours)', type: 'number', width: 11 },
      ],
    },
    {
      name: 'tblEscalationLog',
      sheet: 'Escalation Matrix',
      headerRow: 15,
      keyColumns: ['Escalation ID'],
      columns: [
        { header: 'Escalation ID', type: 'text', width: 13 },
        { header: 'Task ID', type: 'text', width: 10 },
        { header: 'Task', type: 'text', width: 28 },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Type', type: 'text', width: 14 },
        { header: 'Level', type: 'number', width: 7 },
        { header: 'Severity', type: 'text', width: 10, list: SEVERITY_LIST },
        { header: 'Reason', type: 'longtext', width: 30 },
        { header: 'Impact', type: 'longtext', width: 24 },
        { header: 'Next Action', type: 'longtext', width: 24 },
        { header: 'Original Due', type: 'date', width: 13 },
        { header: 'Revised ETA', type: 'date', width: 13 },
        { header: 'Raised At', type: 'text', width: 17 },
        { header: 'Manager', type: 'text', width: 20 },
        { header: 'Notification', type: 'text', width: 14 },
        { header: 'Acknowledgement', type: 'text', width: 22 },
        {
          header: 'Resolution Status',
          type: 'text',
          width: 16,
          list: ['Open', 'Acknowledged', 'Resolved'],
        },
      ],
    },
    {
      name: 'tblLastWeek',
      sheet: 'Last Week Task',
      headerRow: 5,
      keyColumns: ['Week Of', 'Task ID'],
      columns: [
        { header: 'Week Of', type: 'date', width: 12 },
        { header: 'Task ID', type: 'text', width: 10 },
        { header: 'Task', type: 'text', width: 34 },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Original Deadline', type: 'date', width: 15 },
        { header: 'Completion Date', type: 'date', width: 15 },
        { header: 'Status', type: 'text', width: 13, list: STATUS_LIST },
        { header: 'Carry Forward', type: 'text', width: 13, list: YES_NO },
        { header: 'Delay Reason', type: 'longtext', width: 28 },
        { header: 'Blocker', type: 'longtext', width: 24 },
        { header: 'Closure Notes', type: 'longtext', width: 30 },
      ],
    },
    {
      name: 'tblThisWeek',
      sheet: 'This Week Task',
      headerRow: 5,
      keyColumns: ['Week Of', 'Task ID'],
      columns: [
        { header: 'Week Of', type: 'date', width: 12 },
        { header: 'Task ID', type: 'text', width: 10 },
        { header: 'Task', type: 'text', width: 34 },
        { header: 'Owner', type: 'text', width: 20 },
        { header: 'Priority', type: 'text', width: 10, list: PRIORITY_LIST },
        { header: 'Due Date', type: 'date', width: 13 },
        { header: 'Status', type: 'text', width: 13, list: STATUS_LIST },
        { header: 'Dependencies', type: 'text', width: 16 },
        { header: 'Blocker', type: 'longtext', width: 24 },
        { header: 'Next Action', type: 'longtext', width: 24 },
        { header: 'Revised ETA', type: 'date', width: 13 },
        { header: 'Completion Confirmation', type: 'text', width: 26 },
      ],
    },
  ];
}

export interface DesiredRow {
  key: string;
  values: Record<string, CellValue>;
}

export type NameOf = (id: UserId | null) => string;

const d = (date: string | null | undefined): CellValue => (date ? toExcelSerial(date) : '');

/** Normalised identity for a row, so app keys and Excel cells compare equal. */
export function rowKey(parts: CellValue[]): string {
  return parts.map((p) => normalizeCell(p)).join('|');
}

export function normalizeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}

function formatInstant(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function confirmationLabel(row: WeekTaskRow, today: string, nameOf: NameOf): string {
  const t = row.task;
  if (t.status === 'completed') return `Completed ${t.actualEnd ?? ''}`.trim();
  const c = humanConfirmationOn(t, today);
  if (c?.outcome === 'not_completed') return `Not completed (${nameOf(c.by as UserId)})`;
  const missed = t.confirmations.some((x) => x.outcome === 'no_response');
  if (missed) return 'No response recorded';
  return currentDue(t) <= today ? 'Awaiting confirmation' : 'Not due yet';
}

/** Desired app-managed rows for every table. Formula columns are excluded (Excel computes them). */
export function desiredRows(
  project: Project,
  config: OrgConfig,
  today: string,
  nameOf: NameOf,
): Record<string, DesiredRow[]> {
  const status = (s: keyof typeof TASK_STATUS_LABELS) => TASK_STATUS_LABELS[s];
  const tasks = [...project.tasks].sort((a, b) =>
    a.wbsId.localeCompare(b.wbsId, undefined, { numeric: true }),
  );
  const weekRow = (r: WeekTaskRow) => rowKey([toExcelSerial(r.weekOf), r.task.id]);

  return {
    tblGantt: tasks.map((t) => ({
      key: rowKey([t.id]),
      values: {
        'Task ID': t.id,
        'WBS ID': t.wbsId,
        'Milestone / Task': t.title,
        Type: t.isMilestone ? 'Milestone' : 'Task',
        Owner: nameOf(t.ownerId),
        'Planned Start': d(t.plannedStart),
        'Planned End': d(t.plannedEnd),
        'Revised End': d(t.revisedEnd),
        Status: status(t.status),
        Dependencies: t.dependencies.join(', '),
        '% Complete': t.progress / 100,
      },
    })),
    tblWBS: tasks.map((t) => ({
      key: rowKey([t.id]),
      values: {
        'WBS ID': t.wbsId,
        'Task ID': t.id,
        Phase: t.phase,
        Task: t.title,
        Description: t.description,
        Owner: nameOf(t.ownerId),
        Priority: PRIORITY_LABELS[t.priority],
        'Planned Start': d(t.plannedStart),
        'Planned End': d(t.plannedEnd),
        'Revised End': d(t.revisedEnd),
        'Actual Start': d(t.actualStart),
        'Actual End': d(t.actualEnd),
        Status: status(t.status),
        Dependencies: t.dependencies.join(', '),
        Remarks: [t.blocker && `Blocker: ${t.blocker}`, t.remarks].filter(Boolean).join(' | '),
      },
    })),
    tblAPIs: project.apis.map((a) => ({
      key: rowKey([a.id]),
      values: {
        'API ID': a.id,
        'API Name': a.name,
        Purpose: a.purpose,
        Owner: nameOf(a.ownerId),
        Readiness: READINESS_LABELS[a.readiness],
        'Testing Status': TESTING_LABELS[a.testing],
        Blocker: a.blocker,
        Dependency: a.dependency,
        'Next Action': a.nextAction,
        'Target Date': d(a.targetDate),
        'Technical Reference': a.technicalReference,
      },
    })),
    tblEscalationMatrix: [...config.escalation.levels]
      .sort((a, b) => a.level - b.level)
      .map((l) => {
        const managers: Record<string, UserId | null> = {
          pm: project.team.pm,
          delivery_head: project.team.deliveryHead,
          fde: project.team.fde,
          sales_poc: project.team.salesPoc,
          csm: project.team.csm,
          tech: project.team.tech[0] ?? null,
        };
        const mgr = managers[l.role] ?? null;
        return {
          key: rowKey([l.level]),
          values: {
            Level: l.level,
            'Responsible Role': PROJECT_ROLE_LABELS[l.role] ?? GLOBAL_ROLE_LABELS.pm,
            'Manager Mapping': mgr ? nameOf(mgr) : 'Unassigned',
            Severity: l.severity[0]!.toUpperCase() + l.severity.slice(1),
            'Escalation Condition': l.condition,
            'SLA (hours)': l.slaHours,
          },
        };
      }),
    tblEscalationLog: project.escalations.map((e) => {
      const task = project.tasks.find((t) => t.id === e.taskId);
      const latest = e.notifications.at(-1);
      return {
        key: rowKey([e.id]),
        values: {
          'Escalation ID': e.id,
          'Task ID': e.taskId,
          Task: task?.title ?? '',
          Owner: nameOf(e.ownerId),
          Type: e.type.replace('_', ' '),
          Level: e.level,
          Severity: e.severity[0]!.toUpperCase() + e.severity.slice(1),
          Reason: e.reason,
          Impact: e.impact,
          'Next Action': e.nextAction,
          'Original Due': d(e.originalDue),
          'Revised ETA': d(e.revisedEta),
          'Raised At': formatInstant(e.triggeredAt, config.timezone),
          Manager: nameOf(e.managerId),
          Notification: latest ? latest.status.replace('_', ' ') : '',
          Acknowledgement: e.acknowledgedAt
            ? `${nameOf(e.acknowledgedBy ?? null)} ${formatInstant(e.acknowledgedAt, config.timezone)}`
            : 'Pending',
          'Resolution Status': e.status[0]!.toUpperCase() + e.status.slice(1),
        },
      };
    }),
    tblLastWeek: lastWeekRows(project, today).map((r) => ({
      key: weekRow(r),
      values: {
        'Week Of': d(r.weekOf),
        'Task ID': r.task.id,
        Task: r.task.title,
        Owner: nameOf(r.task.ownerId),
        'Original Deadline': d(r.task.plannedEnd),
        'Completion Date': d(r.task.actualEnd),
        Status: status(r.task.status),
        'Carry Forward': r.carriedForward ? 'Yes' : 'No',
        'Delay Reason': r.delayReason,
        Blocker: r.task.blocker,
        'Closure Notes': r.closureNotes,
      },
    })),
    tblThisWeek: thisWeekRows(project, today).map((r) => ({
      key: weekRow(r),
      values: {
        'Week Of': d(r.weekOf),
        'Task ID': r.task.id,
        Task: r.task.title,
        Owner: nameOf(r.task.ownerId),
        Priority: PRIORITY_LABELS[r.task.priority],
        'Due Date': d(r.due),
        Status: status(r.task.status),
        Dependencies: r.task.dependencies.join(', '),
        Blocker: r.task.blocker,
        'Next Action': r.task.nextAction,
        'Revised ETA': currentDue(r.task) > r.due ? d(currentDue(r.task)) : '',
        'Completion Confirmation': confirmationLabel(r, today, nameOf),
      },
    })),
  };
}

/** Header cells written above the tables (outside any table). */
export function headerBlock(project: Project, nameOf: NameOf) {
  return {
    title: `Chat360 · ${project.clientName} — ${project.name}`,
    projectId: project.id,
    pm: nameOf(project.team.pm),
    start: project.startDate,
    goLive: project.targetGoLive,
  };
}

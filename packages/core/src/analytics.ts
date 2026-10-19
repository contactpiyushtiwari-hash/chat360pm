import { calendarOf } from './context';
import { addDays, weekStart, workingDaysAfter } from './dates';
import { summarizeProject } from './project';
import { isOpen, isOverdue } from './tasks';
import { weekRows } from './weekly';
import type { DirectoryUser, IsoDate, OrgConfig, Project, ProjectHealth, UserId } from './types';

/**
 * Business delivery metrics. Every figure is a count or ratio derived from recorded project
 * data; definitions live in docs/prd.md (PRD-ANALYTICS-*). Ratios are null when the
 * denominator is zero, rather than a misleading 0% or 100%.
 */
export interface DeliveryAnalytics {
  asOf: IsoDate;
  totals: { projects: number; activeProjects: number; tasks: number; openTasks: number };
  health: Record<ProjectHealth, number>;
  onTimeDelivery: { completed: number; onTime: number; rate: number | null };
  overdueTasks: number;
  weeklyCommitment: {
    weekOf: IsoDate;
    committed: number;
    completed: number;
    rate: number | null;
  }[];
  goLiveRisks: {
    projectId: string;
    name: string;
    targetGoLive: IsoDate;
    health: ProjectHealth;
    reasons: string[];
  }[];
  pendingApis: { total: number; pastTarget: number };
  uatAgeing: { projectId: string; taskId: string; title: string; daysOpen: number }[];
  escalationAgeing: { open: number; buckets: Record<'lt1d' | '1to3d' | '3to7d' | 'gt7d', number> };
  blockerSides: { client: number; internal: number };
  workload: { userId: UserId; name: string; openTasks: number; overdue: number }[];
  delayReasons: { id: string; label: string; count: number }[];
  confirmation: { decisions: number; noResponse: number; responseRate: number | null };
  transfers: { requested: number; completed: number; rejected: number; direct: number };
  projects: {
    id: string;
    name: string;
    clientName: string;
    pmId: UserId;
    health: ProjectHealth;
    overdue: number;
    openTasks: number;
  }[];
}

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

export function computeAnalytics(
  projects: Project[],
  today: IsoDate,
  config: OrgConfig,
  directory: DirectoryUser[],
  weeks = 4,
): DeliveryAnalytics {
  const cal = calendarOf(config);
  const nameOf = (id: UserId) => directory.find((u) => u.id === id)?.displayName ?? 'Unknown user';
  const health: Record<ProjectHealth, number> = { green: 0, amber: 0, red: 0 };
  const workload = new Map<UserId, { openTasks: number; overdue: number }>();
  const reasons = new Map<string, number>();
  let completed = 0;
  let onTime = 0;
  let decisions = 0;
  let noResponse = 0;
  let tasks = 0;
  let openTasks = 0;
  let overdue = 0;
  const escBuckets = { lt1d: 0, '1to3d': 0, '3to7d': 0, gt7d: 0 };
  let openEsc = 0;
  const blockerSides = { client: 0, internal: 0 };
  const transfers = { requested: 0, completed: 0, rejected: 0, direct: 0 };
  const goLiveRisks: DeliveryAnalytics['goLiveRisks'] = [];
  const uatAgeing: DeliveryAnalytics['uatAgeing'] = [];
  let pendingApis = 0;
  let apisPastTarget = 0;
  const projectRows: DeliveryAnalytics['projects'] = [];
  const sideOf = (id: string) => config.delayReasons.find((r) => r.id === id)?.side;

  for (const p of projects) {
    const summary = summarizeProject(p, today);
    if (p.status === 'active') health[summary.health] += 1;
    projectRows.push({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      pmId: p.team.pm,
      health: summary.health,
      overdue: summary.overdueTasks,
      openTasks: summary.openTasks,
    });
    if (
      p.status === 'active' &&
      p.targetGoLive <= addDays(today, 30) &&
      summary.health !== 'green'
    ) {
      goLiveRisks.push({
        projectId: p.id,
        name: p.name,
        targetGoLive: p.targetGoLive,
        health: summary.health,
        reasons: summary.healthReasons,
      });
    }
    for (const t of p.tasks) {
      if (t.status === 'cancelled') continue;
      tasks++;
      if (isOpen(t)) {
        openTasks++;
        if (t.ownerId) {
          const w = workload.get(t.ownerId) ?? { openTasks: 0, overdue: 0 };
          w.openTasks++;
          if (isOverdue(t, today)) w.overdue++;
          workload.set(t.ownerId, w);
        }
        if (isOverdue(t, today)) overdue++;
        if (/uat/i.test(t.phase) && t.actualStart) {
          uatAgeing.push({
            projectId: p.id,
            taskId: t.id,
            title: t.title,
            daysOpen: workingDaysAfter(t.actualStart, today, cal),
          });
        }
      }
      if (t.status === 'completed' && t.actualEnd) {
        completed++;
        if (t.actualEnd <= t.plannedEnd) onTime++;
      }
      for (const c of t.confirmations) {
        if (c.outcome === 'no_response') noResponse++;
        else decisions++;
        if (c.outcome === 'not_completed' && c.reasonCategory) {
          reasons.set(c.reasonCategory, (reasons.get(c.reasonCategory) ?? 0) + 1);
          const side = sideOf(c.reasonCategory);
          if (side) blockerSides[side]++;
        }
      }
    }
    for (const a of p.apis) {
      if (a.readiness === 'ready') continue;
      pendingApis++;
      if (a.targetDate && a.targetDate < today) apisPastTarget++;
    }
    for (const e of p.escalations) {
      if (e.status === 'resolved') continue;
      openEsc++;
      const days = (Date.parse(`${today}T23:59:59Z`) - Date.parse(e.triggeredAt)) / 86_400_000;
      if (days < 1) escBuckets.lt1d++;
      else if (days < 3) escBuckets['1to3d']++;
      else if (days < 7) escBuckets['3to7d']++;
      else escBuckets.gt7d++;
    }
    for (const tr of p.transfers) {
      if (tr.kind === 'direct_reassignment') transfers.direct++;
      else if (tr.status !== 'draft') transfers.requested++;
      if (tr.status === 'completed') transfers.completed++;
      if (tr.status === 'rejected') transfers.rejected++;
    }
  }

  const weekly: DeliveryAnalytics['weeklyCommitment'] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(weekStart(today), -7 * i);
    let committed = 0;
    let done = 0;
    for (const p of projects) {
      for (const row of weekRows(p, ws, today)) {
        if (row.carriedIn) continue;
        committed++;
        if (row.completedInWeek) done++;
      }
    }
    weekly.push({ weekOf: ws, committed, completed: done, rate: ratio(done, committed) });
  }

  return {
    asOf: today,
    totals: {
      projects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'active').length,
      tasks,
      openTasks,
    },
    health,
    onTimeDelivery: { completed, onTime, rate: ratio(onTime, completed) },
    overdueTasks: overdue,
    weeklyCommitment: weekly,
    goLiveRisks: goLiveRisks.sort((a, b) => a.targetGoLive.localeCompare(b.targetGoLive)),
    pendingApis: { total: pendingApis, pastTarget: apisPastTarget },
    uatAgeing: uatAgeing.sort((a, b) => b.daysOpen - a.daysOpen).slice(0, 20),
    escalationAgeing: { open: openEsc, buckets: escBuckets },
    blockerSides,
    workload: [...workload.entries()]
      .map(([userId, w]) => ({ userId, name: nameOf(userId), ...w }))
      .sort((a, b) => b.openTasks - a.openTasks),
    delayReasons: [...reasons.entries()]
      .map(([id, count]) => ({
        id,
        label: config.delayReasons.find((r) => r.id === id)?.label ?? id,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    confirmation: { decisions, noResponse, responseRate: ratio(decisions, decisions + noResponse) },
    transfers,
    projects: projectRows,
  };
}

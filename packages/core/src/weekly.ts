import { addDays, weekStart } from './dates';
import { currentDue, isOpen } from './tasks';
import type { IsoDate, Project, Task } from './types';

export interface WeekTaskRow {
  weekOf: IsoDate;
  task: Task;
  /** Deadline in force for this week's commitment. */
  due: IsoDate;
  /** Arrived from an earlier week: overdue and not committed for this week. */
  carriedIn: boolean;
  /** Not completed by the end of this week, so it carries into the next. */
  carriedForward: boolean;
  delayReason: string;
  closureNotes: string;
  completedInWeek: boolean;
}

function lastNotCompleted(task: Task, from: IsoDate, to: IsoDate) {
  return [...task.confirmations]
    .reverse()
    .find((c) => c.outcome === 'not_completed' && c.date >= from && c.date <= to);
}

function closureNotes(task: Task) {
  return [...task.confirmations].reverse().find((c) => c.outcome === 'completed')?.notes ?? '';
}

/**
 * Weekly commitment rows for the ISO week starting `ws`. A task belongs to a week when its
 * deadline (original or any revision) fell in that week, it was completed that week, or it was
 * still open and already overdue at the start of the week (carried forward).
 */
export function weekRows(project: Project, ws: IsoDate, asOf: IsoDate): WeekTaskRow[] {
  const we = addDays(ws, 6);
  const inWeek = (d: IsoDate | null) => !!d && d >= ws && d <= we;
  const rows: WeekTaskRow[] = [];
  for (const task of project.tasks) {
    if (task.status === 'cancelled' || task.plannedStart > we) continue;
    const deadlines = [task.plannedEnd, ...task.revisions.map((r) => r.to)];
    const committed = deadlines.some(inWeek);
    const completedInWeek = task.status === 'completed' && inWeek(task.actualEnd);
    const dueBefore = deadlines.filter((d) => d < ws);
    const carriedIn =
      dueBefore.length > 0 &&
      (isOpen(task) || (task.actualEnd !== null && task.actualEnd >= ws)) &&
      !committed;
    if (!committed && !completedInWeek && !carriedIn) continue;
    const doneByWeekEnd =
      task.status === 'completed' && task.actualEnd !== null && task.actualEnd <= we;
    const dueInWeek = deadlines.filter(inWeek).sort().at(0);
    const reason = lastNotCompleted(task, ws, asOf < we ? asOf : we);
    rows.push({
      weekOf: ws,
      task,
      due: dueInWeek ?? currentDue(task),
      carriedIn,
      carriedForward: !doneByWeekEnd,
      delayReason: reason?.reason ?? '',
      closureNotes: completedInWeek ? closureNotes(task) : '',
      completedInWeek,
    });
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due) || a.task.id.localeCompare(b.task.id));
}

export function thisWeekRows(project: Project, today: IsoDate) {
  return weekRows(project, weekStart(today), today);
}

export function lastWeekRows(project: Project, today: IsoDate) {
  return weekRows(project, addDays(weekStart(today), -7), today);
}

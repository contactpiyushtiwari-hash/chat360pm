import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  addDays,
  currentDue,
  daysBetween,
  isOverdue,
  weekStart,
  type Task,
} from '@chat360/core';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, EmptyState } from './ui';

interface ViewProps {
  tasks: Task[];
  today: string;
  onOpen: (t: Task) => void;
}

export function TaskList({ tasks, today, onOpen }: ViewProps) {
  const { nameOf } = useSession();
  if (!tasks.length)
    return <EmptyState title="No tasks match">Change the filters, or add a task.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">WBS</th>
            <th scope="col">Task</th>
            <th scope="col">Owner</th>
            <th scope="col">Due</th>
            <th scope="col">Status</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={isOverdue(t, today) ? 'row-overdue' : ''}>
              <td data-label="WBS" className="mono">
                {t.wbsId}
              </td>
              <td data-label="Task">
                <button type="button" className="link-btn" onClick={() => onOpen(t)}>
                  {t.isMilestone && <span aria-label="Milestone">◆ </span>}
                  {t.title}
                </button>
                <div className="hint">
                  <span className="mono">{t.id}</span> · {t.phase}
                  {t.blocker && (
                    <>
                      {' '}
                      · <span className="text-warning">Blocked: {t.blocker}</span>
                    </>
                  )}
                </div>
              </td>
              <td data-label="Owner">{nameOf(t.ownerId)}</td>
              <td data-label="Due">
                {fmtDate(currentDue(t))}
                {t.revisedEnd && <div className="hint">orig. {fmtDate(t.plannedEnd)}</div>}
              </td>
              <td data-label="Status">
                <Badge
                  value={isOverdue(t, today) ? 'red' : t.status}
                  label={
                    isOverdue(t, today)
                      ? `Overdue (${t.status.replace('_', ' ')})`
                      : TASK_STATUS_LABELS[t.status]
                  }
                />
              </td>
              <td data-label="Progress">
                <progress max={100} value={t.progress} aria-label={`${t.progress}% complete`} />{' '}
                {t.progress}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskKanban({ tasks, today, onOpen }: ViewProps) {
  const { nameOf } = useSession();
  return (
    <div className="kanban">
      {TASK_STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <section key={s} className="kanban-col" aria-label={TASK_STATUS_LABELS[s]}>
            <h3>
              {TASK_STATUS_LABELS[s]} <span className="tab-count">{col.length}</span>
            </h3>
            {col.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`kanban-card ${isOverdue(t, today) ? 'kanban-overdue' : ''}`}
                onClick={() => onOpen(t)}
              >
                <span className="mono small">{t.id}</span>
                <strong>{t.title}</strong>
                <span className="hint">
                  {nameOf(t.ownerId)} · due {fmtDate(currentDue(t))}
                </span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Week-scale Gantt. The list view is the accessible equivalent; bars carry text labels too. */
export function TaskGantt({
  tasks,
  today,
  onOpen,
  start,
  goLive,
}: ViewProps & { start: string; goLive: string }) {
  if (!tasks.length) return <EmptyState title="No tasks to chart" />;
  const from = weekStart(tasks.reduce((m, t) => (t.plannedStart < m ? t.plannedStart : m), start));
  const end = [goLive, ...tasks.map(currentDue)].reduce((m, d) => (d > m ? d : m), goLive);
  const span = Math.max(7, daysBetween(from, addDays(end, 7)));
  const weeks = Math.ceil(span / 7);
  const pos = (d: string) => (daysBetween(from, d) / span) * 100;
  return (
    <div
      className="gantt"
      role="img"
      aria-label="Gantt chart of tasks. Use the list view for full details."
    >
      <div className="gantt-scroll">
        <div className="gantt-inner" style={{ minWidth: `${Math.max(640, weeks * 56 + 220)}px` }}>
          <div className="gantt-header">
            <div className="gantt-label" />
            <div className="gantt-track">
              {Array.from({ length: weeks }, (_, i) => (
                <span
                  key={i}
                  className="gantt-week"
                  style={{ left: `${pos(addDays(from, i * 7))}%` }}
                >
                  {fmtDate(addDays(from, i * 7)).slice(0, 6)}
                </span>
              ))}
              <span
                className="gantt-today"
                style={{ left: `${pos(today)}%` }}
                title={`Today ${fmtDate(today)}`}
              />
              <span
                className="gantt-golive"
                style={{ left: `${pos(goLive)}%` }}
                title={`Go-live ${fmtDate(goLive)}`}
              />
            </div>
          </div>
          {tasks.map((t) => {
            const left = pos(t.plannedStart);
            const right = pos(addDays(currentDue(t), 1));
            const late = isOverdue(t, today);
            return (
              <div key={t.id} className="gantt-row">
                <button
                  type="button"
                  className="gantt-label link-btn"
                  onClick={() => onOpen(t)}
                  title={t.title}
                >
                  <span className="mono small">{t.wbsId}</span> {t.title}
                </button>
                <div className="gantt-track">
                  {t.isMilestone ? (
                    <span
                      className={`gantt-milestone ${late ? 'late' : ''}`}
                      style={{ left: `${pos(currentDue(t))}%` }}
                      aria-label={`${t.title}: milestone ${fmtDate(currentDue(t))}`}
                    />
                  ) : (
                    <span
                      className={`gantt-bar status-${t.status} ${late ? 'late' : ''}`}
                      style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }}
                      aria-label={`${t.title}: ${fmtDate(t.plannedStart)} to ${fmtDate(currentDue(t))}`}
                    >
                      <span className="gantt-progress" style={{ width: `${t.progress}%` }} />
                    </span>
                  )}
                  {t.revisedEnd && t.revisedEnd !== t.plannedEnd && (
                    <span
                      className="gantt-baseline"
                      style={{ left: `${pos(t.plannedEnd)}%` }}
                      title={`Original deadline ${fmtDate(t.plannedEnd)}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint gantt-legend">
        <span className="legend-swatch bar" /> planned → current due ·{' '}
        <span className="legend-swatch late" /> overdue · ◆ milestone ·{' '}
        <span className="legend-swatch baseline" /> original deadline ·{' '}
        <span className="legend-swatch today" /> today
      </p>
    </div>
  );
}

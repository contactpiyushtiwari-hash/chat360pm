import { Link } from 'react-router';
import type { DeliveryAnalytics } from '@chat360/core';
import { fmtDate, pct } from '../lib/format';
import { useResource } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';

function Bar({ value, max, tone = 'info' }: { value: number; max: number; tone?: string }) {
  return (
    <span className="hbar" aria-hidden="true">
      <span
        className={`hbar-fill hbar-${tone}`}
        style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }}
      />
    </span>
  );
}

export function AnalyticsPage() {
  const { nameOf } = useSession();
  const r = useResource<{
    scope: 'portfolio' | 'mine';
    truncated: boolean;
    analytics: DeliveryAnalytics;
  }>('/api/analytics');
  if (r.loading)
    return (
      <>
        <PageHeader title="Analytics" />
        <Skeleton lines={8} />
      </>
    );
  if (r.error)
    return (
      <>
        <PageHeader title="Analytics" />
        <ErrorState error={r.error} onRetry={r.reload} />
      </>
    );
  const { analytics: a, scope, truncated } = r.data!;
  const maxLoad = Math.max(1, ...a.workload.map((w) => w.openTasks));
  const maxReason = Math.max(1, ...a.delayReasons.map((d) => d.count));
  return (
    <>
      <PageHeader
        title="Delivery analytics"
        subtitle={`${scope === 'portfolio' ? 'Portfolio view (all projects you can see)' : 'Projects where you are PM or a team member'} · as of ${fmtDate(a.asOf)}. Figures are counts from recorded data; definitions are listed below each metric.`}
      />
      {truncated && <p className="notice">Showing the first 300 projects.</p>}
      {a.totals.projects === 0 ? (
        <Card>
          <EmptyState title="No analytics data yet">
            Metrics appear once you are on a project with tasks.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-value">{a.totals.activeProjects}</span>
              <span className="stat-label">Active projects (of {a.totals.projects})</span>
            </div>
            <div className="stat">
              <span className="stat-value">{pct(a.onTimeDelivery.rate)}</span>
              <span className="stat-label">
                On-time completion ({a.onTimeDelivery.onTime}/{a.onTimeDelivery.completed})
              </span>
            </div>
            <div className={`stat ${a.overdueTasks ? 'stat-alert' : ''}`}>
              <span className="stat-value">{a.overdueTasks}</span>
              <span className="stat-label">Overdue tasks</span>
            </div>
            <div className="stat">
              <span className="stat-value">{pct(a.confirmation.responseRate)}</span>
              <span className="stat-label">Daily confirmation response rate</span>
            </div>
          </div>
          <div className="grid-2">
            <Card title="Project health">
              <p>
                <Badge value="red" label={`Red ${a.health.red}`} />{' '}
                <Badge value="amber" label={`Amber ${a.health.amber}`} />{' '}
                <Badge value="green" label={`Green ${a.health.green}`} />
              </p>
              <p className="hint">
                Rule-based: red if a high/critical escalation is open, ≥3 tasks overdue, or go-live
                is near with low completion. Not a predictive score.
              </p>
              <ul className="list">
                {a.projects.map((p) => (
                  <li key={p.id} className="list-row">
                    <Link to={`/projects/${p.id}`}>
                      {p.clientName} — {p.name}
                    </Link>
                    <span>
                      {nameOf(p.pmId)} <Badge value={p.health} label={p.health.toUpperCase()} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Weekly commitments vs completion">
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col">Committed</th>
                    <th scope="col">Completed</th>
                    <th scope="col">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {a.weeklyCommitment.map((w) => (
                    <tr key={w.weekOf}>
                      <td>{fmtDate(w.weekOf)}</td>
                      <td>{w.committed}</td>
                      <td>{w.completed}</td>
                      <td>{pct(w.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                Committed: tasks whose deadline (original or revised) fell in that week. Completed:
                of those, finished in that week.
              </p>
            </Card>
            <Card title="Upcoming go-live risks">
              {a.goLiveRisks.length === 0 ? (
                <EmptyState title="No go-live risks in the next 30 days" />
              ) : (
                <ul className="list">
                  {a.goLiveRisks.map((g) => (
                    <li key={g.projectId} className="list-row">
                      <div>
                        <Link to={`/projects/${g.projectId}`}>{g.name}</Link>
                        <div className="hint">{g.reasons.join('; ')}</div>
                      </div>
                      <span>
                        {fmtDate(g.targetGoLive)} <Badge value={g.health} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Workload (open tasks by owner)">
              {a.workload.length === 0 ? (
                <EmptyState title="No open tasks" />
              ) : (
                <ul className="bars">
                  {a.workload.map((w) => (
                    <li key={w.userId}>
                      <span className="bar-label">{w.name}</span>
                      <Bar value={w.openTasks} max={maxLoad} />
                      <span className="bar-value">
                        {w.openTasks}
                        {w.overdue ? ` (${w.overdue} overdue)` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Repeated delay reasons">
              {a.delayReasons.length === 0 ? (
                <EmptyState title="No delays recorded" />
              ) : (
                <ul className="bars">
                  {a.delayReasons.map((d) => (
                    <li key={d.id}>
                      <span className="bar-label">{d.label}</span>
                      <Bar value={d.count} max={maxReason} tone="warning" />
                      <span className="bar-value">{d.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">
                Client-side {a.blockerSides.client} · internal {a.blockerSides.internal} (from each
                reason’s configured side).
              </p>
            </Card>
            <Card title="Escalations, APIs, UAT and transfers">
              <ul className="compact">
                <li>
                  Open escalations: {a.escalationAgeing.open} (under 1 day{' '}
                  {a.escalationAgeing.buckets.lt1d}, 1–3 days {a.escalationAgeing.buckets['1to3d']},
                  3–7 days {a.escalationAgeing.buckets['3to7d']}, over 7 days{' '}
                  {a.escalationAgeing.buckets.gt7d})
                </li>
                <li>
                  Pending API dependencies: {a.pendingApis.total} ({a.pendingApis.pastTarget} past
                  target date)
                </li>
                <li>
                  Oldest open UAT tasks:{' '}
                  {a.uatAgeing
                    .slice(0, 3)
                    .map((u) => `${u.title} (${u.daysOpen} working days)`)
                    .join(', ') || 'none'}
                </li>
                <li>
                  Transfers: {a.transfers.requested} requested, {a.transfers.direct} direct
                  reassignments, {a.transfers.completed} completed, {a.transfers.rejected} rejected
                </li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

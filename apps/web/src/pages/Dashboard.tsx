import { Link } from 'react-router';
import type { ProjectListItem, TodayItem } from '../lib/types';
import { useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import { fmtDate } from '../lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '../components/ui';

export function DashboardPage() {
  const me = useMe();
  const { nameOf } = useSession();
  const today = useResource<{ due: TodayItem[]; upcoming: TodayItem[] }>('/api/today');
  const projects = useResource<{ projects: ProjectListItem[]; canCreate: boolean }>(
    '/api/projects',
  );
  const escalations = useResource<{
    escalations: {
      id: string;
      projectId: string;
      projectName: string;
      taskTitle: string;
      severity: string;
      level: number;
      managerId: string | null;
    }[];
  }>('/api/escalations');

  const dueCount = today.data?.due.length ?? 0;
  const overdue = today.data?.due.filter((d) => d.overdue).length ?? 0;
  const mineEsc = escalations.data?.escalations.filter((e) => e.managerId === me.user.id) ?? [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Today is ${fmtDate(me.today)} (${me.timezone})`}
        actions={
          me.permissions.createProject && (
            <ButtonLink to="/projects/new" variant="primary">
              New project
            </ButtonLink>
          )
        }
      />
      {!me.onboarding.complete && (
        <div className="notice">
          Finish your setup: {me.onboarding.missingRequired.length} required step(s) remaining.{' '}
          <Link to="/welcome">Continue setup</Link>
        </div>
      )}
      <div className="stats">
        <Link to="/today" className="stat">
          <span className="stat-value">{today.loading ? '…' : dueCount}</span>
          <span className="stat-label">Need your decision today</span>
        </Link>
        <Link to="/today" className={`stat ${overdue ? 'stat-alert' : ''}`}>
          <span className="stat-value">{today.loading ? '…' : overdue}</span>
          <span className="stat-label">Overdue</span>
        </Link>
        <Link to="/escalations" className="stat">
          <span className="stat-value">{escalations.loading ? '…' : mineEsc.length}</span>
          <span className="stat-label">Escalations assigned to you</span>
        </Link>
        <Link to="/projects" className="stat">
          <span className="stat-value">
            {projects.loading ? '…' : (projects.data?.projects.length ?? 0)}
          </span>
          <span className="stat-label">Projects you can see</span>
        </Link>
      </div>
      <div className="grid-2">
        <Card title="Due today" actions={<Link to="/today">Open My Tasks Today</Link>}>
          {today.loading ? (
            <Skeleton />
          ) : today.error ? (
            <ErrorState error={today.error} onRetry={today.reload} />
          ) : dueCount === 0 ? (
            <EmptyState title="Nothing needs your decision today">
              Tasks due today appear here so you can confirm them.
            </EmptyState>
          ) : (
            <ul className="list">
              {today.data!.due.slice(0, 6).map((d) => (
                <li key={`${d.projectId}-${d.task.id}`} className="list-row">
                  <div>
                    <strong>{d.task.title}</strong>
                    <div className="hint">
                      {d.clientName} — {d.projectName}
                    </div>
                  </div>
                  {d.overdue ? (
                    <Badge value="red" label={`Overdue · ${fmtDate(d.due)}`} />
                  ) : (
                    <Badge value="pending" label="Due today" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Your projects" actions={<Link to="/projects">All projects</Link>}>
          {projects.loading ? (
            <Skeleton />
          ) : projects.error ? (
            <ErrorState error={projects.error} onRetry={projects.reload} />
          ) : projects.data!.projects.length === 0 ? (
            <EmptyState
              title="No assigned projects"
              action={
                projects.data!.canCreate ? (
                  <ButtonLink to="/projects/new" variant="primary">
                    Create a project
                  </ButtonLink>
                ) : undefined
              }
            >
              {projects.data!.canCreate
                ? 'Create your first project to generate its Excel tracker.'
                : 'You will see projects here once you are added to a project team.'}
            </EmptyState>
          ) : (
            <ul className="list">
              {projects.data!.projects.slice(0, 6).map((p) => (
                <li key={p.id} className="list-row">
                  <div>
                    <Link to={`/projects/${p.id}`}>
                      <strong>
                        {p.clientName} — {p.name}
                      </strong>
                    </Link>
                    <div className="hint">
                      PM {nameOf(p.pmId)} · go-live {fmtDate(p.targetGoLive)}
                    </div>
                  </div>
                  <Badge value={p.summary.health} label={p.summary.health.toUpperCase()} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

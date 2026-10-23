import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { fmtDate } from '../lib/format';
import { useResource } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ProjectListItem } from '../lib/types';
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '../components/ui';

export function ProjectsPage() {
  const r = useResource<{ projects: ProjectListItem[]; canCreate: boolean }>('/api/projects');
  const { nameOf } = useSession();
  const [q, setQ] = useState('');
  const [health, setHealth] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (r.data?.projects ?? []).filter(
      (p) =>
        (!needle ||
          `${p.clientName} ${p.name} ${p.id} ${nameOf(p.pmId)}`.toLowerCase().includes(needle)) &&
        (!health || p.summary.health === health),
    );
  }, [r.data, q, health, nameOf]);

  return (
    <>
      <PageHeader
        title="Projects"
        actions={
          r.data?.canCreate && (
            <ButtonLink to="/projects/new" variant="primary">
              New project
            </ButtonLink>
          )
        }
      />
      <Card>
        <div className="filters">
          <label className="sr-only" htmlFor="project-search">
            Search projects
          </label>
          <Input
            id="project-search"
            type="search"
            placeholder="Search by client, project, ID or PM"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="sr-only" htmlFor="health-filter">
            Filter by health
          </label>
          <Select id="health-filter" value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="">All health</option>
            <option value="red">Red</option>
            <option value="amber">Amber</option>
            <option value="green">Green</option>
          </Select>
        </div>
        {r.loading ? (
          <Skeleton lines={6} />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : r.data!.projects.length === 0 ? (
          <EmptyState
            title="No assigned projects"
            action={
              r.data!.canCreate ? (
                <ButtonLink to="/projects/new" variant="primary">
                  Create a project
                </ButtonLink>
              ) : undefined
            }
          >
            {r.data!.canCreate
              ? 'Projects you manage or work on will appear here.'
              : 'You will see projects here once a PM adds you to a project team.'}
          </EmptyState>
        ) : list.length === 0 ? (
          <EmptyState title="No projects match your search">
            Try a different name, or clear the filters.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">PM</th>
                  <th scope="col">Go-live</th>
                  <th scope="col">Health</th>
                  <th scope="col">Open / overdue</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Project">
                      <Link to={`/projects/${p.id}`}>
                        <strong>{p.clientName}</strong> — {p.name}
                      </Link>
                      <div className="hint mono">{p.id}</div>
                    </td>
                    <td data-label="PM">{nameOf(p.pmId)}</td>
                    <td data-label="Go-live">{fmtDate(p.targetGoLive)}</td>
                    <td data-label="Health">
                      <Badge value={p.summary.health} label={p.summary.health.toUpperCase()} />
                    </td>
                    <td data-label="Open / overdue">
                      {p.summary.openTasks} /{' '}
                      <span className={p.summary.overdueTasks ? 'text-danger' : ''}>
                        {p.summary.overdueTasks}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

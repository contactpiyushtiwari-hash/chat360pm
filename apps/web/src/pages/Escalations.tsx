import { Link } from 'react-router';
import type { EscalationStatus, Severity } from '@chat360/core';
import { fmtInstant, titleCase } from '../lib/format';
import { useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';

interface Item {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  taskId: string;
  taskTitle: string;
  ownerId: string | null;
  managerId: string | null;
  level: number;
  severity: Severity;
  status: EscalationStatus;
  type: string;
  triggeredAt: string;
  reason: string;
}

export function EscalationsPage() {
  const me = useMe();
  const { nameOf } = useSession();
  const r = useResource<{ escalations: Item[] }>('/api/escalations');
  return (
    <>
      <PageHeader
        title="Escalations"
        subtitle={
          me.permissions.portfolio
            ? 'All open escalations across the portfolio.'
            : 'Open escalations you manage, own, or that are on your projects.'
        }
      />
      <Card>
        {r.loading ? (
          <Skeleton lines={5} />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : r.data!.escalations.length === 0 ? (
          <EmptyState title="No pending escalations">
            Nothing is waiting on you. Escalations appear when due tasks are not completed or not
            confirmed.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Escalation</th>
                  <th scope="col">Project</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Manager</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Raised</th>
                </tr>
              </thead>
              <tbody>
                {r.data!.escalations.map((e) => (
                  <tr key={`${e.projectId}-${e.id}`}>
                    <td data-label="Escalation">
                      <Link to={`/projects/${e.projectId}?tab=escalations`}>
                        <strong className="mono">{e.id}</strong>
                      </Link>{' '}
                      <Badge value={e.status} />
                      <div>{e.taskTitle}</div>
                      <div className="hint">
                        {titleCase(e.type)} · {e.reason}
                      </div>
                    </td>
                    <td data-label="Project">
                      {e.clientName} — {e.projectName}
                    </td>
                    <td data-label="Owner">{nameOf(e.ownerId)}</td>
                    <td data-label="Manager">
                      L{e.level} · {nameOf(e.managerId)}
                      {e.managerId === me.user.id && <Badge value="pending" label="You" />}
                    </td>
                    <td data-label="Severity">
                      <Badge value={e.severity} />
                    </td>
                    <td data-label="Raised">{fmtInstant(e.triggeredAt)}</td>
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

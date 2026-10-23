import { useState } from 'react';
import { Link } from 'react-router';
import type { DelayReason } from '@chat360/core';
import { post } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe } from '../lib/session';
import type { TodayItem } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TextArea,
  useToast,
} from '../components/ui';

interface TodayData {
  today: string;
  due: TodayItem[];
  upcoming: TodayItem[];
  delayReasons: DelayReason[];
}

export function TodayPage() {
  const me = useMe();
  const r = useResource<TodayData>('/api/today');
  const [active, setActive] = useState<{
    item: TodayItem;
    outcome: 'completed' | 'not_completed';
  } | null>(null);
  const [lastSynced, setLastSynced] = useState<{ projectId: string; key: number } | null>(null);

  return (
    <>
      <PageHeader
        title="My Tasks Today"
        subtitle="Every task due today needs an explicit decision: Completed or Not completed. Unanswered tasks are escalated at the end of the day."
      />
      {lastSynced && (
        <div className="notice" role="status">
          Saved.
        </div>
      )}
      {r.loading ? (
        <Skeleton lines={5} />
      ) : r.error ? (
        <ErrorState error={r.error} onRetry={r.reload} />
      ) : (
        <>
          <Card title={`Due today or overdue (${r.data!.due.length})`}>
            {r.data!.due.length === 0 ? (
              <EmptyState
                title="No tasks due today"
                action={<Link to="/projects">View your projects</Link>}
              >
                You have nothing awaiting a decision for {fmtDate(me.today)}.
              </EmptyState>
            ) : (
              <ul className="task-cards">
                {r.data!.due.map((d) => (
                  <li key={`${d.projectId}-${d.task.id}`} className="task-card">
                    <div className="task-card-main">
                      <div className="row">
                        <span className="mono">{d.task.id}</span>
                        {d.overdue ? (
                          <Badge value="red" label={`Overdue since ${fmtDate(d.due)}`} />
                        ) : (
                          <Badge value="pending" label="Due today" />
                        )}
                        <Badge
                          value={
                            d.task.priority === 'critical' || d.task.priority === 'high'
                              ? d.task.priority
                              : 'neutral'
                          }
                          label={d.task.priority}
                        />
                      </div>
                      <h3>{d.task.title}</h3>
                      <p className="hint">
                        <Link to={`/projects/${d.projectId}`}>
                          {d.clientName} — {d.projectName}
                        </Link>{' '}
                        · {d.task.phase}
                        {d.task.revisedEnd && (
                          <> · original deadline {fmtDate(d.task.plannedEnd)}</>
                        )}
                      </p>
                      {d.task.blocker && <p className="blocker">Blocker: {d.task.blocker}</p>}
                    </div>
                    <div className="task-card-actions">
                      <Button
                        variant="primary"
                        onClick={() => setActive({ item: d, outcome: 'completed' })}
                      >
                        Completed
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setActive({ item: d, outcome: 'not_completed' })}
                      >
                        Not completed
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Coming up (next 7 days)">
            {r.data!.upcoming.length === 0 ? (
              <EmptyState title="Nothing due in the next week" />
            ) : (
              <ul className="list">
                {r.data!.upcoming.map((d) => (
                  <li key={`${d.projectId}-${d.task.id}`} className="list-row">
                    <div>
                      <strong>{d.task.title}</strong>
                      <div className="hint">
                        {d.clientName} — {d.projectName}
                      </div>
                    </div>
                    <span>{fmtDate(d.due)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {active && r.data && (
        <ConfirmDialog
          item={active.item}
          outcome={active.outcome}
          reasons={r.data.delayReasons}
          today={r.data.today}
          onClose={() => setActive(null)}
          onDone={() => {
            setLastSynced({ projectId: active.item.projectId, key: Date.now() });
            setActive(null);
            void r.reload();
          }}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  item,
  outcome,
  reasons,
  today,
  onClose,
  onDone,
}: {
  item: TodayItem;
  outcome: 'completed' | 'not_completed';
  reasons: DelayReason[];
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [reasonCategory, setReasonCategory] = useState(reasons[0]?.id ?? 'other');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [revisedEta, setRevisedEta] = useState('');
  const action = useAction(async () => {
    const body =
      outcome === 'completed'
        ? { outcome, notes, ...(evidenceUrl ? { evidenceUrl } : {}) }
        : { outcome, reasonCategory, reason, impact, nextAction, revisedEta };
    const res = await post<{ escalation: { id: string } | null }>(
      `/api/projects/${item.projectId}/tasks/${item.task.id}/confirm`,
      body,
    );
    toast(
      'success',
      outcome === 'completed'
        ? 'Task marked completed.'
        : `Recorded. ${res.escalation ? `Escalation ${res.escalation.id} raised to your manager.` : ''}`,
    );
    onDone();
  });
  const f = action.error?.fields ?? {};
  return (
    <Dialog
      open
      title={
        outcome === 'completed' ? `Complete ${item.task.id}` : `Not completed: ${item.task.id}`
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={outcome === 'completed' ? 'primary' : 'danger'}
            loading={action.pending}
            onClick={() => void action.run()}
          >
            {outcome === 'completed' ? 'Confirm completed' : 'Submit and escalate'}
          </Button>
        </>
      }
    >
      <p className="lead">{item.task.title}</p>
      <InlineError error={action.error && !Object.keys(f).length ? action.error : null} />
      {outcome === 'completed' ? (
        <>
          <Field
            label="Closure notes"
            required
            error={f.notes}
            hint="What was delivered, and where to find it."
          >
            {(p) => <TextArea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <Field
            label="Evidence link"
            error={f.evidenceUrl}
            hint="Optional link to a document, build or screenshot."
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://"
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <p className="hint">
            The original deadline ({fmtDate(item.task.plannedEnd)}) is kept. An escalation goes to
            the configured manager.
          </p>
          <Field label="Reason category" required error={f.reasonCategory}>
            {(p) => (
              <Select
                {...p}
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
              >
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason" required error={f.reason}>
            {(p) => <TextArea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Field label="Impact" error={f.impact} hint="Optional: what this delays.">
            {(p) => <Input {...p} value={impact} onChange={(e) => setImpact(e.target.value)} />}
          </Field>
          <Field label="Next action" required error={f.nextAction}>
            {(p) => (
              <Input {...p} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
            )}
          </Field>
          <Field label="Revised ETA" required error={f.revisedEta}>
            {(p) => (
              <Input
                {...p}
                type="date"
                min={today}
                value={revisedEta}
                onChange={(e) => setRevisedEta(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </Dialog>
  );
}

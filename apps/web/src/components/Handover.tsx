import { useState } from 'react';
import type { HandoverSummary } from '@chat360/core';
import { post } from '../lib/api';
import { fmtDate, fmtMoney } from '../lib/format';
import { FINANCE_LABELS } from './FinanceTab';
import { useAction, useResource } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  InlineError,
  Input,
  Skeleton,
  TextArea,
  useToast,
} from './ui';
import { UserSelect } from './UserPicker';

export function HandoverView({ h }: { h: HandoverSummary }) {
  const { nameOf } = useSession();
  const section = (title: string, n: number, body: React.ReactNode) => (
    <details className="handover-section" open={n > 0 && n <= 8}>
      <summary>
        {title} <span className="tab-count">{n}</span>
      </summary>
      {n === 0 ? <p className="hint">None.</p> : body}
    </details>
  );
  return (
    <div className="handover">
      <p>
        Project health: <Badge value={h.health} label={h.health.toUpperCase()} />{' '}
        <span className="hint">{h.healthReasons.join('; ')}</span>
      </p>
      {section(
        'Outstanding tasks',
        h.openTasks.length,
        <ul className="compact">
          {h.openTasks.map((t) => (
            <li key={t.id}>
              <span className="mono">{t.id}</span> {t.title} — {nameOf(t.ownerId)}, due{' '}
              {fmtDate(t.due)} ({t.status.replace('_', ' ')})
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Deadlines in the next 14 days',
        h.upcomingDeadlines.length,
        <ul className="compact">
          {h.upcomingDeadlines.map((t) => (
            <li key={t.id}>
              {fmtDate(t.due)} — {t.title}
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Pending API dependencies',
        h.pendingApis.length,
        <ul className="compact">
          {h.pendingApis.map((a) => (
            <li key={a.id}>
              {a.name} — {a.readiness.replace('_', ' ')}
              {a.targetDate ? `, target ${fmtDate(a.targetDate)}` : ''}
            </li>
          ))}
        </ul>,
      )}
      {section(
        'UAT issues',
        h.uatIssues.length,
        <ul className="compact">
          {h.uatIssues.map((t) => (
            <li key={t.id}>
              {t.title} — {t.status.replace('_', ' ')}, due {fmtDate(t.due)}
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Client commitments',
        h.clientCommitments.length,
        <ul className="compact">
          {h.clientCommitments.map((t) => (
            <li key={t.id}>
              {t.title} — {fmtDate(t.due)} ({t.status.replace('_', ' ')})
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Open escalations',
        h.openEscalations.length,
        <ul className="compact">
          {h.openEscalations.map((e) => (
            <li key={e.id}>
              {e.id} ({e.severity}) on {e.taskId}: {e.reason}
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Blockers',
        h.blockers.length,
        <ul className="compact">
          {h.blockers.map((b) => (
            <li key={b.id}>
              {b.title}: {b.blocker}
            </li>
          ))}
        </ul>,
      )}
      {section(
        'Documents',
        h.documents.length,
        <ul className="compact">
          {h.documents.map((d) => (
            <li key={d.url}>
              <a href={d.url} target="_blank" rel="noopener noreferrer">
                {d.label}
              </a>
            </li>
          ))}
        </ul>,
      )}
      {h.finance && (
        <details className="handover-section">
          <summary>Finance</summary>
          <ul className="compact">
            <li>
              {FINANCE_LABELS.raisedOverdue}:{' '}
              {fmtMoney(h.finance.raisedOverdueForGoLive, h.finance.currency)}
            </li>
            <li>
              {FINANCE_LABELS.raisable}:{' '}
              {fmtMoney(h.finance.raisableImmediately, h.finance.currency)}
            </li>
            <li>
              {FINANCE_LABELS.total}: {fmtMoney(h.finance.total, h.finance.currency)}
            </li>
            <li>
              {FINANCE_LABELS.toBeRaised}: {fmtMoney(h.finance.toBeRaised, h.finance.currency)}
            </li>
            {h.finance.remarks && <li>{h.finance.remarks}</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Path A: the current PM requests a transfer, pre-filled with live project context. */
export function RequestTransferDialog({
  projectId,
  today,
  onClose,
  onDone,
}: {
  projectId: string;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { me } = useSession();
  const handover = useResource<{ handover: HandoverSummary }>(
    `/api/projects/${projectId}/handover`,
  );
  const [proposedPmId, setProposed] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const act = useAction(async (submit: boolean) => {
    await post(`/api/projects/${projectId}/transfers`, {
      proposedPmId,
      reason,
      requestedEffectiveDate: date,
      handoverNotes: notes,
      submit,
    });
    toast(
      'success',
      submit ? 'Transfer request submitted to the Delivery and Operations Head.' : 'Draft saved.',
    );
    onDone();
  });
  const f = act.error?.fields ?? {};
  return (
    <Dialog
      open
      wide
      title="Request project transfer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={() => void act.run(false)}>
            Save draft
          </Button>
          <Button variant="primary" loading={act.pending} onClick={() => void act.run(true)}>
            Submit request
          </Button>
        </>
      }
    >
      <p className="hint">
        Nothing changes until the Delivery and Operations Head approves. Task owners and history are
        preserved.
      </p>
      <InlineError error={act.error && !Object.keys(f).length ? act.error : null} />
      <Field label="Proposed new PM" hint="Optional — the Delivery Head can choose.">
        {(p) => (
          <UserSelect
            {...p}
            role="pm"
            exclude={me ? [me.user.id] : []}
            emptyLabel="No preference"
            value={proposedPmId}
            onChange={setProposed}
          />
        )}
      </Field>
      <Field label="Reason" required error={f.reason}>
        {(p) => <TextArea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Field label="Requested effective date" required error={f.requestedEffectiveDate}>
        {(p) => (
          <Input
            {...p}
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Handover notes"
        hint="Context the next PM needs: client preferences, risks, commitments made verbally."
      >
        {(p) => (
          <TextArea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <h3>Current delivery status (attached automatically)</h3>
      {handover.loading ? (
        <Skeleton />
      ) : handover.error ? (
        <ErrorState error={handover.error} onRetry={handover.reload} />
      ) : (
        <HandoverView h={handover.data!.handover} />
      )}
    </Dialog>
  );
}

/** Path B: the Delivery and Operations Head reassigns the PM directly, after reviewing the handover. */
export function ReassignPmDialog({
  projectId,
  currentPmId,
  today,
  onClose,
  onDone,
}: {
  projectId: string;
  currentPmId: string;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { nameOf } = useSession();
  const handover = useResource<{ handover: HandoverSummary }>(
    `/api/projects/${projectId}/handover`,
  );
  const [newPmId, setNew] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const act = useAction(async () => {
    const r = await post<{ transfer: { status: string; execution: { lastError?: string } } }>(
      `/api/projects/${projectId}/reassign-pm`,
      {
        newPmId,
        reason,
        effectiveDate: date,
        handoverNotes: notes,
        confirm: true,
      },
    );
    toast(
      r.transfer.status === 'completed' ? 'success' : 'info',
      r.transfer.status === 'completed'
        ? `${nameOf(newPmId)} is now the PM.`
        : r.transfer.execution.lastError
          ? `Reassignment recorded but not complete: ${r.transfer.execution.lastError}`
          : `Reassignment scheduled for ${fmtDate(date)}.`,
    );
    onDone();
  });
  const f = act.error?.fields ?? {};
  return (
    <Dialog
      open
      wide
      title="Change project PM"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!confirmed || !newPmId || !reason.trim()}
            loading={act.pending}
            onClick={() => void act.run()}
          >
            Confirm reassignment
          </Button>
        </>
      }
    >
      <p>
        Current PM: <strong>{nameOf(currentPmId)}</strong>. Task owners, deadlines and all history
        are kept. The previous PM keeps read access for the configured period.
      </p>
      <InlineError error={act.error && !Object.keys(f).length ? act.error : null} />
      <Field label="New PM" required error={f.newPmId}>
        {(p) => (
          <UserSelect
            {...p}
            role="pm"
            allowEmpty={false}
            exclude={[currentPmId]}
            value={newPmId}
            onChange={setNew}
          />
        )}
      </Field>
      <Field label="Reason" required error={f.reason}>
        {(p) => <TextArea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Field label="Effective date" required error={f.effectiveDate}>
        {(p) => (
          <Input
            {...p}
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>
      <Field label="Handover context">
        {(p) => (
          <TextArea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <h3>Handover summary</h3>
      {handover.loading ? (
        <Skeleton />
      ) : handover.error ? (
        <ErrorState error={handover.error} onRetry={handover.reload} />
      ) : (
        <HandoverView h={handover.data!.handover} />
      )}
      <Checkbox
        checked={confirmed}
        onChange={setConfirmed}
        label="I have reviewed the outstanding work, deadlines, dependencies, escalations and commitments above."
      />
    </Dialog>
  );
}

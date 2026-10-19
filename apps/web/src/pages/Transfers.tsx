import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { TransferRequest, TransferStatus } from '@chat360/core';
import { post } from '../lib/api';
import { fmtDate, fmtInstant, titleCase } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  KeyValue,
  PageHeader,
  Skeleton,
  TextArea,
  useToast,
} from '../components/ui';
import { HandoverView } from '../components/Handover';
import { UserSelect } from '../components/UserPicker';
import { NotFoundPage } from './NotFound';

interface Item {
  id: string;
  kind: string;
  status: TransferStatus;
  fromPmId: string;
  proposedPmId: string | null;
  newPmId: string | null;
  requestedBy: string;
  createdAt: string;
  reason: string;
  projectId: string;
  projectName: string;
  clientName: string;
}

export function TransfersPage() {
  const { nameOf } = useSession();
  const r = useResource<{ transfers: Item[]; canReview: boolean }>('/api/transfers');
  const pending =
    r.data?.transfers.filter((t) => t.status === 'submitted' || t.status === 'under_review') ?? [];
  const rest =
    r.data?.transfers.filter((t) => !(t.status === 'submitted' || t.status === 'under_review')) ??
    [];
  const row = (t: Item) => (
    <li key={t.id} className="list-row">
      <div>
        <Link to={`/transfers/${t.projectId}/${t.id}`}>
          <strong>
            {t.clientName} — {t.projectName}
          </strong>
        </Link>
        <div className="hint">
          <span className="mono">{t.id}</span> ·{' '}
          {t.kind === 'direct_reassignment' ? 'Direct reassignment' : 'PM request'} ·{' '}
          {nameOf(t.fromPmId)} → {nameOf(t.newPmId ?? t.proposedPmId)} · {fmtInstant(t.createdAt)}
        </div>
      </div>
      <Badge value={t.status} />
    </li>
  );
  return (
    <>
      <PageHeader
        title="Project transfers"
        subtitle={
          r.data?.canReview
            ? 'Review PM transfer requests and see every ownership change.'
            : 'Transfers you requested or that involve you.'
        }
      />
      {r.loading ? (
        <Skeleton lines={5} />
      ) : r.error ? (
        <ErrorState error={r.error} onRetry={r.reload} />
      ) : r.data!.transfers.length === 0 ? (
        <Card>
          <EmptyState title="No transfer requests">
            A PM can request a transfer from the project page.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title={`Awaiting review (${pending.length})`}>
            {pending.length ? (
              <ul className="list">{pending.map(row)}</ul>
            ) : (
              <EmptyState title="Nothing awaiting review" />
            )}
          </Card>
          <Card title="History">
            <ul className="list">{rest.map(row)}</ul>
          </Card>
        </>
      )}
    </>
  );
}

export function TransferDetailPage() {
  const { projectId = '', transferId = '' } = useParams();
  const me = useMe();
  const { nameOf } = useSession();
  const toast = useToast();
  const r = useResource<{
    transfer: TransferRequest;
    project: { id: string; name: string; clientName: string; currentPmId: string };
  }>(`/api/projects/${encodeURIComponent(projectId)}/transfers/${encodeURIComponent(transferId)}`);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [newPm, setNewPm] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const act = useAction(async (action: string, body: unknown = {}) => {
    const res = await post<{ transfer: TransferRequest }>(
      `/api/projects/${projectId}/transfers/${transferId}/${action}`,
      body,
    );
    toast(
      res.transfer.status === 'completed' || action !== 'approve' ? 'success' : 'info',
      `Transfer ${titleCase(res.transfer.status)}.${res.transfer.execution.lastError ? ` ${res.transfer.execution.lastError}` : ''}`,
    );
    setDialog(null);
    await r.reload();
  });

  if (r.loading && !r.data) return <Skeleton lines={8} />;
  if (r.error?.status === 404 || r.error?.status === 403) return <NotFoundPage what="transfer" />;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const { transfer: t, project } = r.data!;
  const isHead = me.permissions.portfolio;
  const isRequester = t.requestedBy === me.user.id;
  const reviewable = isHead && (t.status === 'submitted' || t.status === 'under_review');
  const incomplete = t.status === 'approved' && t.requestedEffectiveDate <= me.today;

  return (
    <div className="narrow">
      <PageHeader
        title={`Transfer ${t.id}`}
        subtitle={
          <>
            <Link to={`/projects/${project.id}?tab=transfers`}>
              {project.clientName} — {project.name}
            </Link>{' '}
            · {t.kind === 'direct_reassignment' ? 'Direct reassignment' : 'PM request'}
          </>
        }
        actions={<Badge value={t.status} />}
      />
      <InlineError error={act.error} />
      <Card title="Request">
        <KeyValue
          items={[
            ['From PM', nameOf(t.fromPmId)],
            ['Proposed PM', nameOf(t.proposedPmId)],
            ['New PM', t.newPmId ? nameOf(t.newPmId) : '—'],
            ['Reason', t.reason],
            ['Effective date', fmtDate(t.requestedEffectiveDate)],
            ['Handover notes', t.handoverNotes || '—'],
            ['Requested by', `${nameOf(t.requestedBy)} on ${fmtInstant(t.createdAt)}`],
            ...(t.rejectionReason
              ? [['Rejection reason', t.rejectionReason] as [string, string]]
              : []),
            ...(t.decisionNotes ? [['Decision notes', t.decisionNotes] as [string, string]] : []),
          ]}
        />
        <div className="row wrap">
          {isRequester && t.status === 'draft' && (
            <Button variant="primary" loading={act.pending} onClick={() => void act.run('submit')}>
              Submit request
            </Button>
          )}
          {reviewable && t.status === 'submitted' && (
            <Button loading={act.pending} onClick={() => void act.run('review')}>
              Start review
            </Button>
          )}
          {reviewable && (
            <Button
              variant="primary"
              onClick={() => {
                setNewPm(t.proposedPmId);
                setDialog('approve');
              }}
            >
              Approve…
            </Button>
          )}
          {reviewable && (
            <Button variant="danger" onClick={() => setDialog('reject')}>
              Reject…
            </Button>
          )}
          {(isRequester || isHead) && ['draft', 'submitted', 'under_review'].includes(t.status) && (
            <Button variant="ghost" loading={act.pending} onClick={() => void act.run('cancel')}>
              Cancel request
            </Button>
          )}
          {isHead && incomplete && (
            <Button variant="primary" loading={act.pending} onClick={() => void act.run('retry')}>
              Retry execution
            </Button>
          )}
        </div>
      </Card>
      {t.status === 'approved' || t.status === 'completed' ? (
        <Card title="Execution">
          {t.execution.lastError && (
            <p className="inline-error">Last error: {t.execution.lastError}</p>
          )}
          {t.status === 'approved' && !incomplete && (
            <p className="notice">
              Scheduled: executes automatically on {fmtDate(t.requestedEffectiveDate)}.
            </p>
          )}
          <ul className="compact">
            {t.execution.steps.map((s) => (
              <li key={s.name}>
                <Badge value={s.status} /> {titleCase(s.name)}{' '}
                {s.required ? '(required)' : '(tracked)'}{' '}
                {s.error && <span className="hint">— {s.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Handover snapshot">
        <p className="hint">Captured {fmtInstant(t.snapshot.generatedAt)}.</p>
        <HandoverView h={t.snapshot} />
      </Card>
      <Card title="Status history">
        <ol className="timeline">
          {t.history.map((h, i) => (
            <li key={i}>
              <span className="hint">{fmtInstant(h.at)}</span>
              <div>
                {h.from ? `${titleCase(h.from)} → ` : ''}
                {titleCase(h.to)} by {nameOf(h.by)}
              </div>
              {h.note && <div className="hint">{h.note}</div>}
            </li>
          ))}
        </ol>
      </Card>
      {dialog === 'approve' && (
        <Dialog
          open
          title="Approve transfer"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!newPm}
                loading={act.pending}
                onClick={() => void act.run('approve', { newPmId: newPm, notes })}
              >
                Approve and reassign
              </Button>
            </>
          }
        >
          <p>
            If the effective date ({fmtDate(t.requestedEffectiveDate)}) is today or earlier, the PM
            changes immediately. Task owners and history are preserved.
          </p>
          <Field label="New PM" required>
            {(a) => (
              <UserSelect
                {...a}
                role="pm"
                allowEmpty={false}
                exclude={[project.currentPmId]}
                value={newPm}
                onChange={setNewPm}
              />
            )}
          </Field>
          <Field label="Decision notes">
            {(a) => <TextArea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </Dialog>
      )}
      {dialog === 'reject' && (
        <Dialog
          open
          title="Reject transfer"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={!notes.trim()}
                loading={act.pending}
                onClick={() => void act.run('reject', { reason: notes })}
              >
                Reject
              </Button>
            </>
          }
        >
          <Field label="Reason for rejection" required hint="Shared with the requesting PM.">
            {(a) => <TextArea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </Dialog>
      )}
    </div>
  );
}

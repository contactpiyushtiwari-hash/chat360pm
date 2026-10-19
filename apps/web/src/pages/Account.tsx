import { useState } from 'react';
import { Link } from 'react-router';
import { GLOBAL_ROLE_LABELS, type AccountRequest } from '@chat360/core';
import { ApiError, loginUrl, post } from '../lib/api';
import { fmtInstant, titleCase } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  InlineError,
  Input,
  KeyValue,
  PageHeader,
  Skeleton,
  TextArea,
} from '../components/ui';

export function AccountPage() {
  const me = useMe();
  const { refresh } = useSession();
  const r = useResource<{
    requests: AccountRequest[];
    activePmProjects: { id: string; name: string; clientName: string }[];
  }>('/api/account/deactivation');
  const [open, setOpen] = useState(false);
  const cancel = useAction(async (id: string) => {
    await post(`/api/account/deactivation/${id}/cancel`);
    await Promise.all([r.reload(), refresh()]);
  });
  const current = r.data?.requests.find((x) =>
    ['pending_transfers', 'pending_review', 'approved'].includes(x.status),
  );
  return (
    <div className="narrow">
      <PageHeader title="Your account" />
      <Card title="Profile">
        <KeyValue
          items={[
            ['Name', me.user.displayName],
            ['Email', me.user.email],
            [
              'Roles',
              me.user.roles.map((x) => GLOBAL_ROLE_LABELS[x]).join(', ') || 'None assigned yet',
            ],
            ['Status', titleCase(me.user.status)],
            ['Outlook connected', me.outlookConsent ? 'Yes' : 'No'],
          ]}
        />
        <p className="hint">
          Your name and email come from Microsoft 365. Ask an administrator to change your roles.
        </p>
        <div className="row">
          <ButtonLink to="/welcome">Setup checklist</ButtonLink>
          {!me.outlookConsent && (
            <a className="btn btn-secondary" href="/api/auth/consent?returnTo=%2Faccount">
              Connect Outlook
            </a>
          )}
        </div>
      </Card>
      <Card title="Deactivate access">
        {r.loading ? (
          <Skeleton />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : current ? (
          <>
            <p>
              Request <span className="mono">{current.id}</span> is{' '}
              <Badge
                value={current.status === 'pending_transfers' ? 'pending' : 'submitted'}
                label={titleCase(current.status)}
              />{' '}
              since {fmtInstant(current.createdAt)}.
            </p>
            {current.status === 'pending_transfers' && (
              <p className="notice">
                Your active projects need a new PM first. The Delivery and Operations Head has been
                notified.
              </p>
            )}
            <InlineError error={cancel.error} />
            {current.status !== 'approved' && (
              <Button loading={cancel.pending} onClick={() => void cancel.run(current.id)}>
                Cancel request
              </Button>
            )}
          </>
        ) : (
          <>
            <p>
              Requesting deactivation removes your access to this application after an administrator
              approves it. It does <strong>not</strong> delete your Microsoft 365 account, project
              workbooks, client documents, or the history of your work, which are kept for audit.
            </p>
            {r.data!.activePmProjects.length > 0 && (
              <div className="notice">
                You are the PM of {r.data!.activePmProjects.length} active project(s). They must be
                transferred to another PM before your access can be removed:
                <ul className="compact">
                  {r.data!.activePmProjects.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}?tab=transfers`}>
                        {p.clientName} — {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="danger" onClick={() => setOpen(true)}>
              Request deactivation…
            </Button>
          </>
        )}
      </Card>
      {open && (
        <DeactivateDialog
          email={me.user.email}
          hasProjects={(r.data?.activePmProjects.length ?? 0) > 0}
          onClose={() => setOpen(false)}
          onDone={async () => {
            setOpen(false);
            await Promise.all([r.reload(), refresh()]);
          }}
        />
      )}
    </div>
  );
}

function DeactivateDialog({
  email,
  hasProjects,
  onClose,
  onDone,
}: {
  email: string;
  hasProjects: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [ack, setAck] = useState(false);
  const submit = useAction(async () => {
    await post('/api/account/deactivation', { reason, confirmEmail, acknowledgeConsequences: ack });
    onDone();
  });
  const reauth = submit.error instanceof ApiError && submit.error.code === 'reauth_required';
  return (
    <Dialog
      open
      title="Request deactivation"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!ack || confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
            loading={submit.pending}
            onClick={() => void submit.run()}
          >
            Submit request
          </Button>
        </>
      }
    >
      {reauth ? (
        <div className="notice">
          For your security, please sign in again, then return here to submit.
          <div>
            <a className="btn btn-primary" href={loginUrl('/account', 'login')}>
              Sign in again
            </a>
          </div>
        </div>
      ) : (
        <InlineError error={submit.error} />
      )}
      <ul className="compact">
        <li>An administrator reviews the request.</li>
        <li>When approved, your sessions end and you can no longer sign in to this app.</li>
        {hasProjects && (
          <li>
            Your active projects are flagged to the Delivery and Operations Head for transfer; they
            are never orphaned or deleted.
          </li>
        )}
        <li>Workbooks, documents and history are preserved.</li>
      </ul>
      <Field label="Reason (optional)">
        {(a) => <TextArea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Field label={`Type your email (${email}) to confirm`} required>
        {(a) => (
          <Input
            {...a}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>
      <Checkbox
        checked={ack}
        onChange={setAck}
        label="I understand the consequences described above."
      />
    </Dialog>
  );
}

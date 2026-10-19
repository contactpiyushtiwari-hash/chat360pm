import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUSES,
  type SupportRequest,
  type SupportStatus,
} from '@chat360/core';
import { patch, post } from '../lib/api';
import { fmtInstant, titleCase } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ProjectListItem } from '../lib/types';
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
  KeyValue,
  PageHeader,
  Select,
  Skeleton,
  TextArea,
  useToast,
} from '../components/ui';
import { UserSelect } from '../components/UserPicker';

export function SupportPage() {
  const [params] = useSearchParams();
  const r = useResource<{ requests: SupportRequest[]; isSupportOwner: boolean; contact: string }>(
    '/api/support',
  );
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [open, setOpen] = useState<SupportRequest | null>(null);
  const { nameOf } = useSession();
  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Report a problem or ask for help. Include the error ID if you saw one."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New request
          </Button>
        }
      />
      {r.data && (
        <p className="notice">
          {r.data.contact ||
            'Requests are triaged by the platform administrators. For urgent delivery issues, also contact your Delivery and Operations Head.'}
        </p>
      )}
      <Card title={r.data?.isSupportOwner ? 'All requests' : 'Your requests'}>
        {r.loading ? (
          <Skeleton lines={4} />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : r.data!.requests.length === 0 ? (
          <EmptyState
            title="No support requests"
            action={<Button onClick={() => setCreating(true)}>Raise a request</Button>}
          >
            Requests you raise appear here with their status.
          </EmptyState>
        ) : (
          <ul className="list">
            {r.data!.requests.map((q) => (
              <li key={q.id} className="list-row">
                <div>
                  <button type="button" className="link-btn" onClick={() => setOpen(q)}>
                    <strong>{q.subject}</strong>
                  </button>
                  <div className="hint">
                    <span className="mono">{q.id}</span> · {SUPPORT_CATEGORY_LABELS[q.category]} ·{' '}
                    {nameOf(q.reporterId)} · {fmtInstant(q.createdAt)}
                  </div>
                </div>
                <span className="row">
                  <Badge
                    value={
                      q.priority === 'critical' || q.priority === 'high' ? q.priority : 'neutral'
                    }
                    label={q.priority}
                  />
                  <Badge value={q.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && (
        <NewRequest
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void r.reload();
          }}
        />
      )}
      {open && (
        <RequestDialog
          req={open}
          isOwner={!!r.data?.isSupportOwner}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void r.reload();
          }}
        />
      )}
    </>
  );
}

function NewRequest({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const projects = useResource<{ projects: ProjectListItem[] }>('/api/projects');
  const [f, setF] = useState({
    category: 'general' as (typeof SUPPORT_CATEGORIES)[number],
    subject: '',
    description: '',
    projectId: '',
    priority: 'medium' as (typeof PRIORITIES)[number],
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(async () => {
    const r = await post<{ request: SupportRequest }>('/api/support', {
      ...f,
      projectId: f.projectId || null,
    });
    toast('success', `Request ${r.request.id} created.`);
    onDone();
  });
  const e = save.error?.fields ?? {};
  return (
    <Dialog
      open
      title="New support request"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
            Submit
          </Button>
        </>
      }
    >
      <InlineError error={save.error && !Object.keys(e).length ? save.error : null} />
      <Field label="Category" required>
        {(a) => (
          <Select
            {...a}
            value={f.category}
            onChange={(x) => set('category', x.target.value as typeof f.category)}
          >
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SUPPORT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Subject" required error={e.subject}>
        {(a) => <Input {...a} value={f.subject} onChange={(x) => set('subject', x.target.value)} />}
      </Field>
      <Field
        label="Description"
        required
        error={e.description}
        hint="What happened, what you expected, and any error ID. Do not paste passwords or client secrets."
      >
        {(a) => (
          <TextArea
            {...a}
            rows={5}
            value={f.description}
            onChange={(x) => set('description', x.target.value)}
          />
        )}
      </Field>
      <div className="grid-2">
        <Field label="Project (optional)" error={e.projectId}>
          {(a) => (
            <Select {...a} value={f.projectId} onChange={(x) => set('projectId', x.target.value)}>
              <option value="">None</option>
              {projects.data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} — {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(a) => (
            <Select
              {...a}
              value={f.priority}
              onChange={(x) => set('priority', x.target.value as typeof f.priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function RequestDialog({
  req,
  isOwner,
  onClose,
  onDone,
}: {
  req: SupportRequest;
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { nameOf } = useSession();
  const [status, setStatus] = useState<SupportStatus>(req.status);
  const [assignee, setAssignee] = useState(req.assigneeId);
  const [notes, setNotes] = useState(req.resolutionNotes);
  const [note, setNote] = useState('');
  const save = useAction(async () => {
    const body: Record<string, unknown> = {};
    if (status !== req.status) body.status = status;
    if (isOwner && assignee !== req.assigneeId) body.assigneeId = assignee;
    if (isOwner && notes !== req.resolutionNotes) body.resolutionNotes = notes;
    if (note.trim()) body.note = note;
    await patch(`/api/support/${req.id}`, body);
    onDone();
  });
  const reporterStatuses: SupportStatus[] =
    req.status === 'waiting_for_user'
      ? ['waiting_for_user', 'in_progress', 'closed']
      : [req.status, 'closed'];
  return (
    <Dialog
      open
      wide
      title={`${req.id}: ${req.subject}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {req.status !== 'closed' && (
            <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
              Update
            </Button>
          )}
        </>
      }
    >
      <KeyValue
        items={[
          ['Category', SUPPORT_CATEGORY_LABELS[req.category]],
          ['Reporter', nameOf(req.reporterId)],
          ['Project', req.projectId ?? '—'],
          ['Priority', req.priority],
          ['Assigned to', nameOf(req.assigneeId)],
          ['Created', fmtInstant(req.createdAt)],
        ]}
      />
      <p className="pre">{req.description}</p>
      {req.resolutionNotes && (
        <p>
          <strong>Resolution:</strong> {req.resolutionNotes}
        </p>
      )}
      <InlineError error={save.error} />
      {req.status !== 'closed' && (
        <>
          <Field label="Status">
            {(a) => (
              <Select
                {...a}
                value={status}
                onChange={(e) => setStatus(e.target.value as SupportStatus)}
              >
                {(isOwner ? SUPPORT_STATUSES : reporterStatuses).map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isOwner && (
            <Field label="Assignee">
              {(a) => <UserSelect {...a} value={assignee} onChange={setAssignee} />}
            </Field>
          )}
          {isOwner && (
            <Field label="Resolution notes" hint="Required to resolve.">
              {(a) => <TextArea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          )}
          <Field label="Add a note">
            {(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </>
      )}
      <ol className="timeline">
        {req.history.map((h, i) => (
          <li key={i}>
            <span className="hint">{fmtInstant(h.at)}</span>
            <div>
              {nameOf(h.by)}:{' '}
              {h.from && h.from !== h.to
                ? `${titleCase(h.from)} → ${titleCase(h.to)}`
                : titleCase(h.to)}
            </div>
            {h.note && <div className="hint">{h.note}</div>}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  API_READINESS,
  API_TESTING,
  PROJECT_ROLE_LABELS,
  isOpen,
  type ApiDependency,
  type Task,
} from '@chat360/core';
import { post, put, patch } from '../lib/api';
import { fmtDate, fmtInstant, titleCase } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import { track } from '../lib/telemetry';
import type { ProjectView } from '../lib/types';
import {
  Badge,
  Button,
  ButtonLink,
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
  Tabs,
  TextArea,
} from '../components/ui';
import { TaskDialog } from '../components/TaskDialog';
import { TaskGantt, TaskKanban, TaskList } from '../components/TaskViews';
import { ReassignPmDialog, RequestTransferDialog } from '../components/Handover';
import { UserMultiSelect, UserSelect } from '../components/UserPicker';
import { FinanceTab } from '../components/FinanceTab';
import { NotFoundPage } from './NotFound';

type TabId = 'overview' | 'tasks' | 'apis' | 'escalations' | 'transfers' | 'history' | 'finance';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const r = useResource<{ project: ProjectView }>(`/api/projects/${encodeURIComponent(id)}`);
  const requested = (params.get('tab') as TabId) || 'overview';
  const setTab = (t: TabId) =>
    setParams(
      (p) => {
        p.set('tab', t);
        p.delete('created');
        return p;
      },
      { replace: true },
    );

  if (r.loading && !r.data) return <Skeleton lines={10} />;
  if (r.error?.status === 404) return <NotFoundPage what="project" />;
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const p = r.data!.project;
  const openEsc = p.escalations.filter((e) => e.status !== 'resolved').length;
  const tab: TabId = requested === 'finance' && !p.permissions.viewFinance ? 'overview' : requested;

  return (
    <>
      <PageHeader
        title={`${p.clientName} — ${p.name}`}
        subtitle={
          <>
            <span className="mono">{p.id}</span> · {p.category} · {titleCase(p.status)} · go-live{' '}
            {fmtDate(p.targetGoLive)}
          </>
        }
        actions={
          <>
            {p.permissions.downloadTracker && (
              <a
                className="btn btn-secondary"
                href={`/api/projects/${p.id}/tracker.xlsx`}
                download
                onClick={() => track('tracker_downloaded')}
              >
                <span>Download Excel tracker</span>
              </a>
            )}
            <ButtonLink to={`/email?projectId=${p.id}`}>Draft email</ButtonLink>
          </>
        }
      />
      {params.get('created') && (
        <div className="notice" role="status">
          Project created. Download its Excel tracker any time from the button above.
        </div>
      )}
      <Tabs<TabId>
        label="Project sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'tasks', label: 'Tasks', count: p.tasks.filter(isOpen).length },
          {
            id: 'apis',
            label: 'API dependencies',
            count: p.apis.filter((a) => a.readiness !== 'ready').length,
          },
          { id: 'escalations', label: 'Escalations', count: openEsc },
          { id: 'transfers', label: 'Transfers' },
          { id: 'history', label: 'History' },
          ...(p.permissions.viewFinance ? [{ id: 'finance' as const, label: 'Finance' }] : []),
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === 'overview' && <Overview p={p} reload={r.reload} />}
        {tab === 'tasks' && <TasksTab p={p} reload={r.reload} today={me.today} />}
        {tab === 'apis' && <ApisTab p={p} reload={r.reload} />}
        {tab === 'escalations' && <EscalationsTab p={p} reload={r.reload} />}
        {tab === 'transfers' && <TransfersTab p={p} reload={r.reload} today={me.today} />}
        {tab === 'history' && <HistoryTab p={p} />}
        {tab === 'finance' && <FinanceTab p={p} reload={r.reload} />}
      </div>
    </>
  );
}

function Overview({ p, reload }: { p: ProjectView; reload: () => Promise<void> }) {
  const { nameOf } = useSession();
  const [editTeam, setEditTeam] = useState(false);
  const team = p.team;
  const roleRows: [string, string][] = [
    [PROJECT_ROLE_LABELS.pm, nameOf(team.pm)],
    [PROJECT_ROLE_LABELS.tech, team.tech.map(nameOf).join(', ') || 'Unassigned'],
    [PROJECT_ROLE_LABELS.fde, nameOf(team.fde)],
    [PROJECT_ROLE_LABELS.sales_poc, nameOf(team.salesPoc)],
    [PROJECT_ROLE_LABELS.csm, nameOf(team.csm)],
    [PROJECT_ROLE_LABELS.delivery_head, nameOf(team.deliveryHead)],
  ];
  return (
    <div className="grid-2">
      <Card title="Delivery status">
        <p>
          <Badge value={p.summary.health} label={p.summary.health.toUpperCase()} />{' '}
          <span className="hint">{p.summary.healthReasons.join('; ')}</span>
        </p>
        <KeyValue
          items={[
            ['Open tasks', p.summary.openTasks],
            [
              'Overdue',
              <span className={p.summary.overdueTasks ? 'text-danger' : ''}>
                {p.summary.overdueTasks}
              </span>,
            ],
            ['Due this week', p.summary.dueThisWeek],
            ['Completed', `${p.summary.completedTasks} of ${p.summary.totalTasks}`],
            ['Open escalations', p.summary.openEscalations],
            ['Pending APIs', p.summary.pendingApis],
            ['Start → go-live', `${fmtDate(p.startDate)} → ${fmtDate(p.targetGoLive)}`],
            ['Languages', p.languages.join(', ') || '—'],
            ['Integrations', p.integrations.join(', ') || '—'],
            ['QA / UAT', p.qaUatWorkflow || '—'],
          ]}
        />
      </Card>
      <Card
        title="Team"
        actions={
          p.permissions.editTeam && <Button onClick={() => setEditTeam(true)}>Edit team</Button>
        }
      >
        <KeyValue items={roleRows} />
        <p className="hint">
          The PM changes only through a transfer request or a Delivery Head reassignment.
        </p>
        {p.formerPms.length > 0 && (
          <p className="hint">
            Former PM read access:{' '}
            {p.formerPms.map((f) => `${nameOf(f.userId)} until ${fmtDate(f.until)}`).join(', ')}
          </p>
        )}
      </Card>
      <Card title="Documents">
        {p.documents.length === 0 ? (
          <EmptyState title="No documents linked">
            Link the SOW, BRD and bot flows (any shared link).
          </EmptyState>
        ) : (
          <ul className="list">
            {p.documents.map((d) => (
              <li key={d.url} className="list-row">
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.label}
                </a>
                <Badge value="neutral" label={d.kind.replace('_', ' ')} />
              </li>
            ))}
          </ul>
        )}
        {p.permissions.edit && <DocumentAdder p={p} reload={reload} />}
      </Card>
      {editTeam && (
        <TeamDialog
          p={p}
          onClose={() => setEditTeam(false)}
          onDone={async () => {
            setEditTeam(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function DocumentAdder({ p, reload }: { p: ProjectView; reload: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'sow' | 'brd' | 'bot_flow' | 'other'>('sow');
  const add = useAction(async () => {
    await patch(`/api/projects/${p.id}`, { documents: [...p.documents, { label, url, kind }] });
    setLabel('');
    setUrl('');
    await reload();
  });
  return (
    <details className="handover-section">
      <summary>Link a document</summary>
      <div className="grid-2">
        <Field label="Label">
          {(a) => <Input {...a} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="sow">SOW</option>
              <option value="brd">BRD</option>
              <option value="bot_flow">Bot flow</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Link" error={add.error?.fields['documents.' + p.documents.length + '.url']}>
        {(a) => (
          <Input
            {...a}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        )}
      </Field>
      <InlineError error={add.error} />
      <Button disabled={!label || !url} loading={add.pending} onClick={() => void add.run()}>
        Add link
      </Button>
    </details>
  );
}

function TeamDialog({
  p,
  onClose,
  onDone,
}: {
  p: ProjectView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tech, setTech] = useState(p.team.tech);
  const [fde, setFde] = useState(p.team.fde);
  const [sales, setSales] = useState(p.team.salesPoc);
  const [csm, setCsm] = useState(p.team.csm);
  const [head, setHead] = useState(p.team.deliveryHead);
  const [reason, setReason] = useState('');
  const save = useAction(async () => {
    await put(`/api/projects/${p.id}/team`, {
      techIds: tech,
      fdeId: fde,
      salesPocId: sales,
      csmId: csm,
      deliveryHeadId: head,
      reason,
    });
    onDone();
  });
  return (
    <Dialog
      open
      title="Edit project team"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            loading={save.pending}
            onClick={() => void save.run()}
          >
            Save team
          </Button>
        </>
      }
    >
      <p className="hint">
        Task owners are not changed automatically. Reassign tasks individually if needed.
      </p>
      <InlineError error={save.error} />
      <UserMultiSelect legend="Tech team" role="tech" value={tech} onChange={setTech} />
      <Field label="FDE">
        {(a) => <UserSelect {...a} role="fde" value={fde} onChange={setFde} />}
      </Field>
      <Field label="Sales POC">
        {(a) => <UserSelect {...a} role="sales_poc" value={sales} onChange={setSales} />}
      </Field>
      <Field label="Customer Success Manager">
        {(a) => <UserSelect {...a} role="csm" value={csm} onChange={setCsm} />}
      </Field>
      <Field label="Delivery and Operations Head">
        {(a) => <UserSelect {...a} role="delivery_head" value={head} onChange={setHead} />}
      </Field>
      <Field label="Reason for change" required>
        {(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

function TasksTab({
  p,
  reload,
  today,
}: {
  p: ProjectView;
  reload: () => Promise<void>;
  today: string;
}) {
  const { me } = useSession();
  const [view, setView] = useState<'list' | 'kanban' | 'gantt'>('list');
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState<Task | null | 'new'>(null);
  const tasks = useMemo(
    () =>
      [...p.tasks]
        .filter(
          (t) =>
            (!mine || t.ownerId === me?.user.id) &&
            (status === 'all' || (status === 'open' ? isOpen(t) : t.status === status)),
        )
        .sort((a, b) => a.wbsId.localeCompare(b.wbsId, undefined, { numeric: true })),
    [p.tasks, mine, status, me],
  );
  return (
    <Card
      title="Work breakdown"
      actions={
        p.permissions.createTask && (
          <Button variant="primary" onClick={() => setOpen('new')}>
            Add task
          </Button>
        )
      }
    >
      <div className="filters">
        <div className="segmented" role="group" aria-label="View">
          {(['list', 'kanban', 'gantt'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={view === v ? 'seg-active' : ''}
              onClick={() => {
                setView(v);
                track(`view_${v}`);
              }}
            >
              {titleCase(v)}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="status-filter">
          Status
        </label>
        <Select id="status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <label className="check-pill">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only
          mine
        </label>
      </div>
      {view === 'list' && <TaskList tasks={tasks} today={today} onOpen={setOpen} />}
      {view === 'kanban' && <TaskKanban tasks={tasks} today={today} onOpen={setOpen} />}
      {view === 'gantt' && (
        <TaskGantt
          tasks={tasks}
          today={today}
          onOpen={setOpen}
          start={p.startDate}
          goLive={p.targetGoLive}
        />
      )}
      {open && (
        <TaskDialog
          project={p}
          task={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            await reload();
            setOpen(null);
          }}
        />
      )}
    </Card>
  );
}

function ApisTab({ p, reload }: { p: ProjectView; reload: () => Promise<void> }) {
  const { nameOf } = useSession();
  const [edit, setEdit] = useState<ApiDependency | null | 'new'>(null);
  return (
    <Card
      title="API list"
      actions={
        p.permissions.manageApis && (
          <Button variant="primary" onClick={() => setEdit('new')}>
            Add API
          </Button>
        )
      }
    >
      {p.apis.length === 0 ? (
        <EmptyState
          title="No API dependencies recorded"
          action={
            p.permissions.manageApis ? (
              <Button onClick={() => setEdit('new')}>Add the first API</Button>
            ) : undefined
          }
        >
          Track each client API the bot depends on: readiness, testing and the next action.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">API</th>
                <th scope="col">Owner</th>
                <th scope="col">Readiness</th>
                <th scope="col">Testing</th>
                <th scope="col">Target</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {p.apis.map((a) => (
                <tr key={a.id}>
                  <td data-label="API">
                    {p.permissions.manageApis ? (
                      <button type="button" className="link-btn" onClick={() => setEdit(a)}>
                        {a.name}
                      </button>
                    ) : (
                      a.name
                    )}
                    <div className="hint">
                      {a.purpose}
                      {a.blocker && (
                        <>
                          {' '}
                          · <span className="text-warning">{a.blocker}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td data-label="Owner">{nameOf(a.ownerId)}</td>
                  <td data-label="Readiness">
                    <Badge value={a.readiness === 'ready' ? 'done' : a.readiness} />
                  </td>
                  <td data-label="Testing">
                    <Badge
                      value={
                        a.testing === 'passed'
                          ? 'done'
                          : a.testing === 'failed'
                            ? 'failed'
                            : 'neutral'
                      }
                      label={a.testing.replace('_', ' ')}
                    />
                  </td>
                  <td data-label="Target">{fmtDate(a.targetDate)}</td>
                  <td data-label="Next action">{a.nextAction || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <ApiDialog
          p={p}
          api={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onDone={async () => {
            setEdit(null);
            await reload();
          }}
        />
      )}
    </Card>
  );
}

function ApiDialog({
  p,
  api,
  onClose,
  onDone,
}: {
  p: ProjectView;
  api: ApiDependency | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: api?.name ?? '',
    purpose: api?.purpose ?? '',
    ownerId: api?.ownerId ?? null,
    readiness: api?.readiness ?? 'not_started',
    testing: api?.testing ?? 'not_tested',
    blocker: api?.blocker ?? '',
    dependency: api?.dependency ?? '',
    nextAction: api?.nextAction ?? '',
    targetDate: api?.targetDate ?? '',
    technicalReference: api?.technicalReference ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(async () => {
    const body = { ...f, targetDate: f.targetDate || null };
    if (api) await patch(`/api/projects/${p.id}/apis/${api.id}`, body);
    else await post(`/api/projects/${p.id}/apis`, body);
    onDone();
  });
  const e = save.error?.fields ?? {};
  return (
    <Dialog
      open
      wide
      title={api ? `Edit ${api.id}` : 'Add API dependency'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
            Save
          </Button>
        </>
      }
    >
      <p className="notice">
        Never enter API keys, passwords or tokens. Link to where the client documents them instead.
      </p>
      <InlineError error={save.error && !Object.keys(e).length ? save.error : null} />
      <div className="grid-2">
        <Field label="API name" required error={e.name}>
          {(a) => <Input {...a} value={f.name} onChange={(x) => set('name', x.target.value)} />}
        </Field>
        <Field label="Owner">
          {(a) => <UserSelect {...a} value={f.ownerId} onChange={(v) => set('ownerId', v)} />}
        </Field>
        <Field label="Readiness">
          {(a) => (
            <Select
              {...a}
              value={f.readiness}
              onChange={(x) => set('readiness', x.target.value as typeof f.readiness)}
            >
              {API_READINESS.map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Testing status">
          {(a) => (
            <Select
              {...a}
              value={f.testing}
              onChange={(x) => set('testing', x.target.value as typeof f.testing)}
            >
              {API_TESTING.map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Target date">
          {(a) => (
            <Input
              {...a}
              type="date"
              value={f.targetDate}
              onChange={(x) => set('targetDate', x.target.value)}
            />
          )}
        </Field>
        <Field label="Dependency">
          {(a) => (
            <Input
              {...a}
              value={f.dependency}
              onChange={(x) => set('dependency', x.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Purpose">
        {(a) => <Input {...a} value={f.purpose} onChange={(x) => set('purpose', x.target.value)} />}
      </Field>
      <Field label="Blocker" error={e.blocker}>
        {(a) => <Input {...a} value={f.blocker} onChange={(x) => set('blocker', x.target.value)} />}
      </Field>
      <Field label="Next action">
        {(a) => (
          <Input {...a} value={f.nextAction} onChange={(x) => set('nextAction', x.target.value)} />
        )}
      </Field>
      <Field
        label="Technical reference"
        hint="A link or document reference — never a secret."
        error={e.technicalReference}
      >
        {(a) => (
          <Input
            {...a}
            value={f.technicalReference}
            onChange={(x) => set('technicalReference', x.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function EscalationsTab({ p, reload }: { p: ProjectView; reload: () => Promise<void> }) {
  const { me, nameOf } = useSession();
  const [resolving, setResolving] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const ack = useAction(async (id: string) => {
    await post(`/api/projects/${p.id}/escalations/${id}/acknowledge`, {});
    await reload();
  });
  const res = useAction(async () => {
    await post(`/api/projects/${p.id}/escalations/${resolving}/resolve`, { notes });
    setResolving(null);
    setNotes('');
    await reload();
  });
  const list = [...p.escalations].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  return (
    <Card title="Escalations">
      <InlineError error={ack.error} />
      {list.length === 0 ? (
        <EmptyState title="No escalations">
          Escalations appear when a due task is not completed or not confirmed.
        </EmptyState>
      ) : (
        <ul className="esc-list">
          {list.map((e) => {
            const task = p.tasks.find((t) => t.id === e.taskId);
            const canAct =
              e.status !== 'resolved' &&
              (p.permissions.manageEscalations || e.managerId === me?.user.id);
            const n = e.notifications.at(-1);
            return (
              <li key={e.id} className="esc-item">
                <div className="row wrap">
                  <strong className="mono">{e.id}</strong>
                  <Badge value={e.status} />
                  <Badge value={e.severity} />
                  <span className="hint">
                    Level {e.level} · {PROJECT_ROLE_LABELS[e.managerRole]}: {nameOf(e.managerId)}
                  </span>
                </div>
                <p>
                  <strong>{task?.title ?? e.taskId}</strong> — {titleCase(e.type)} · owner{' '}
                  {nameOf(e.ownerId)}
                </p>
                <KeyValue
                  items={[
                    ['Reason', e.reason],
                    ['Impact', e.impact || '—'],
                    ['Next action', e.nextAction],
                    ['Original deadline', fmtDate(e.originalDue)],
                    ['Revised ETA', fmtDate(e.revisedEta)],
                    ['Raised', fmtInstant(e.triggeredAt)],
                    [
                      'Notification',
                      n ? (
                        <>
                          <Badge value={n.status} />
                          {n.lastError && <span className="hint"> {n.lastError}</span>}
                        </>
                      ) : (
                        '—'
                      ),
                    ],
                    [
                      'Acknowledged',
                      e.acknowledgedAt
                        ? `${nameOf(e.acknowledgedBy)} ${fmtInstant(e.acknowledgedAt)}`
                        : 'Pending',
                    ],
                    ...(e.resolvedAt
                      ? [
                          [
                            'Resolution',
                            `${e.resolutionNotes} (${nameOf(e.resolvedBy)}, ${fmtInstant(e.resolvedAt)})`,
                          ] as [string, string],
                        ]
                      : []),
                  ]}
                />
                {canAct && (
                  <div className="row">
                    {e.status === 'open' && (
                      <Button loading={ack.pending} onClick={() => void ack.run(e.id)}>
                        Acknowledge
                      </Button>
                    )}
                    <Button variant="primary" onClick={() => setResolving(e.id)}>
                      Resolve
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {resolving && (
        <Dialog
          open
          title={`Resolve ${resolving}`}
          onClose={() => setResolving(null)}
          footer={
            <>
              <Button onClick={() => setResolving(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!notes.trim()}
                loading={res.pending}
                onClick={() => void res.run()}
              >
                Resolve
              </Button>
            </>
          }
        >
          <InlineError error={res.error} />
          <Field label="Resolution notes" required>
            {(a) => <TextArea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </Dialog>
      )}
    </Card>
  );
}

function TransfersTab({
  p,
  reload,
  today,
}: {
  p: ProjectView;
  reload: () => Promise<void>;
  today: string;
}) {
  const { nameOf } = useSession();
  const [dialog, setDialog] = useState<'request' | 'reassign' | null>(null);
  const active = p.transfers.find((t) =>
    ['draft', 'submitted', 'under_review', 'approved'].includes(t.status),
  );
  return (
    <Card
      title="Project transfers"
      actions={
        <>
          {p.permissions.requestTransfer && !active && (
            <Button variant="primary" onClick={() => setDialog('request')}>
              Request project transfer
            </Button>
          )}
          {p.permissions.reassignPm && (
            <Button variant="danger" onClick={() => setDialog('reassign')}>
              Change project PM
            </Button>
          )}
        </>
      }
    >
      {p.transfers.length === 0 ? (
        <EmptyState title="No transfer requests">
          The PM can request a transfer; the Delivery and Operations Head can reassign the PM
          directly.
        </EmptyState>
      ) : (
        <ul className="list">
          {[...p.transfers].reverse().map((t) => (
            <li key={t.id} className="list-row">
              <div>
                <Link to={`/transfers/${p.id}/${t.id}`}>
                  <strong className="mono">{t.id}</strong>
                </Link>{' '}
                · {t.kind === 'direct_reassignment' ? 'Direct reassignment' : 'PM request'}
                <div className="hint">
                  {nameOf(t.fromPmId)} → {nameOf(t.newPmId ?? t.proposedPmId)} ·{' '}
                  {fmtInstant(t.createdAt)} · {t.reason}
                </div>
              </div>
              <Badge value={t.status} />
            </li>
          ))}
        </ul>
      )}
      {dialog === 'request' && (
        <RequestTransferDialog
          projectId={p.id}
          today={today}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
      {dialog === 'reassign' && (
        <ReassignPmDialog
          projectId={p.id}
          currentPmId={p.team.pm}
          today={today}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
    </Card>
  );
}

function HistoryTab({ p }: { p: ProjectView }) {
  const { nameOf } = useSession();
  return (
    <div className="grid-2">
      <Card title="Ownership and team history">
        {p.teamHistory.length === 0 ? (
          <EmptyState title="No team changes yet" />
        ) : (
          <ol className="timeline">
            {[...p.teamHistory].reverse().map((h) => (
              <li key={h.id}>
                <span className="hint">{fmtInstant(h.at)}</span>
                <div>
                  <strong>{PROJECT_ROLE_LABELS[h.role]}</strong>:{' '}
                  {h.from.map(nameOf).join(', ') || '—'} → {h.to.map(nameOf).join(', ') || '—'}
                </div>
                <div className="hint">
                  by {nameOf(h.by)} · {h.reason}
                  {h.transferId && (
                    <>
                      {' '}
                      · <Link to={`/transfers/${p.id}/${h.transferId}`}>{h.transferId}</Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title="Audit trail">
        <ol className="timeline">
          {[...p.audit]
            .reverse()
            .slice(0, 200)
            .map((a) => (
              <li key={a.id}>
                <span className="hint">{fmtInstant(a.at)}</span>
                <div>
                  {a.action.replace(/[._]/g, ' ')} <span className="mono small">{a.target}</span>
                </div>
                <div className="hint">by {nameOf(a.actor)}</div>
              </li>
            ))}
        </ol>
      </Card>
    </div>
  );
}

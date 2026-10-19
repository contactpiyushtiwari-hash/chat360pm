import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { post } from '../lib/api';
import { fmtWallTime } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe } from '../lib/session';
import type { CalendarEvent, ProjectListItem } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TextArea,
  useToast,
} from '../components/ui';
import { ConnectOutlook } from '../components/ConnectOutlook';

export function CalendarPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const [range, setRange] = useState<'today' | 'week'>('today');
  const [creating, setCreating] = useState(!!params.get('projectId'));
  const r = useResource<{ events: CalendarEvent[]; timezone: string }>(
    me.outlookConsent ? `/api/calendar/events?range=${range}` : null,
  );
  const cancel = useAction(async (id: string) => {
    await post(`/api/calendar/events/${encodeURIComponent(id)}/cancel`, {
      comment: 'Cancelled from Chat360 Project Operations',
    });
    await r.reload();
  });
  if (!me.outlookConsent)
    return (
      <>
        <PageHeader title="Calendar" />
        <ConnectOutlook returnTo="/calendar" />
      </>
    );
  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`Times shown in ${me.timezone}.`}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Schedule meeting
          </Button>
        }
      />
      <Tabs
        label="Range"
        value={range}
        onChange={setRange}
        tabs={[
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'Next 7 days' },
        ]}
      />
      <Card>
        <InlineError error={cancel.error} />
        {r.loading ? (
          <Skeleton lines={4} />
        ) : r.error ? (
          <ErrorState error={r.error} onRetry={r.reload} />
        ) : r.data!.events.length === 0 ? (
          <EmptyState
            title={range === 'today' ? 'No meetings today' : 'No meetings in the next 7 days'}
            action={<Button onClick={() => setCreating(true)}>Schedule a meeting</Button>}
          />
        ) : (
          <ul className="list">
            {r.data!.events.map((e) => (
              <li key={e.id} className="list-row">
                <div>
                  <strong>{e.subject}</strong>{' '}
                  {e.isCancelled && <Badge value="failed" label="Cancelled" />}
                  <div className="hint">
                    {fmtWallTime(e.start).date} {fmtWallTime(e.start).time}–
                    {fmtWallTime(e.end).time} · {e.organizer}
                    {e.location && ` · ${e.location}`} · {e.attendees.length} attendee(s)
                  </div>
                </div>
                <div className="row">
                  {e.joinUrl && (
                    <a
                      className="btn btn-secondary"
                      href={e.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Join
                    </a>
                  )}
                  {e.webLink && (
                    <a
                      className="btn btn-ghost"
                      href={e.webLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Outlook
                    </a>
                  )}
                  {!e.isCancelled && (
                    <Button
                      variant="ghost"
                      loading={cancel.pending}
                      onClick={() => {
                        if (confirm(`Cancel "${e.subject}" and notify attendees?`))
                          void cancel.run(e.id);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && (
        <MeetingDialog
          initialProject={params.get('projectId')}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void r.reload();
          }}
        />
      )}
    </>
  );
}

function MeetingDialog({
  initialProject,
  onClose,
  onDone,
}: {
  initialProject: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const projects = useResource<{ projects: ProjectListItem[] }>('/api/projects');
  const [f, setF] = useState({
    projectId: initialProject ?? '',
    subject: '',
    date: me.today,
    start: '10:00',
    end: '10:30',
    attendees: '',
    agenda: '',
    location: '',
    online: true,
    confirmExternal: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const attendees = f.attendees
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Hint only; the server enforces the configured internal domains.
  const internalDomain = me.user.email.split('@')[1]?.toLowerCase() ?? '';
  const external = attendees.filter((a) => a.split('@')[1]?.toLowerCase() !== internalDomain);
  const save = useAction(async () => {
    await post('/api/calendar/events', {
      projectId: f.projectId || null,
      subject: f.subject,
      start: `${f.date}T${f.start}`,
      end: `${f.date}T${f.end}`,
      timeZone: me.timezone,
      attendees,
      agenda: f.agenda,
      location: f.location,
      online: f.online,
      confirmExternal: f.confirmExternal,
    });
    toast('success', 'Meeting created in your Outlook calendar. Invitations were sent by Outlook.');
    onDone();
  });
  const e = save.error?.fields ?? {};
  return (
    <Dialog
      open
      wide
      title="Schedule meeting"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!f.subject || (external.length > 0 && !f.confirmExternal)}
            loading={save.pending}
            onClick={() => void save.run()}
          >
            Create and send invitations
          </Button>
        </>
      }
    >
      <InlineError error={save.error && !Object.keys(e).length ? save.error : null} />
      <Field label="Project">
        {(a) => (
          <Select {...a} value={f.projectId} onChange={(x) => set('projectId', x.target.value)}>
            <option value="">Not linked to a project</option>
            {projects.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} — {p.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Subject" required error={e.subject}>
        {(a) => <Input {...a} value={f.subject} onChange={(x) => set('subject', x.target.value)} />}
      </Field>
      <div className="grid-3">
        <Field label="Date" required>
          {(a) => (
            <Input
              {...a}
              type="date"
              value={f.date}
              onChange={(x) => set('date', x.target.value)}
            />
          )}
        </Field>
        <Field label="Start" required>
          {(a) => (
            <Input
              {...a}
              type="time"
              value={f.start}
              onChange={(x) => set('start', x.target.value)}
            />
          )}
        </Field>
        <Field label="End" required error={e.end}>
          {(a) => (
            <Input {...a} type="time" value={f.end} onChange={(x) => set('end', x.target.value)} />
          )}
        </Field>
      </div>
      <p className="hint">Time zone: {me.timezone}</p>
      <Field label="Attendees" hint="Email addresses separated by commas." error={e.attendees}>
        {(a) => (
          <Input {...a} value={f.attendees} onChange={(x) => set('attendees', x.target.value)} />
        )}
      </Field>
      <Field label="Agenda">
        {(a) => (
          <TextArea {...a} value={f.agenda} onChange={(x) => set('agenda', x.target.value)} />
        )}
      </Field>
      <Field label="Location">
        {(a) => (
          <Input {...a} value={f.location} onChange={(x) => set('location', x.target.value)} />
        )}
      </Field>
      <Checkbox
        label="Teams online meeting"
        checked={f.online}
        onChange={(v) => set('online', v)}
        hint="Requires Teams for your account; Outlook decides whether a join link is created."
      />
      {external.length > 0 && (
        <Checkbox
          label={`Send invitations to ${external.length} external attendee(s): ${external.join(', ')}`}
          checked={f.confirmExternal}
          onChange={(v) => set('confirmExternal', v)}
        />
      )}
    </Dialog>
  );
}

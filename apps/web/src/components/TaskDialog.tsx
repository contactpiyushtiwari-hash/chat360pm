import { useState } from 'react';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  currentDue,
  type Priority,
  type Task,
  type TaskStatus,
} from '@chat360/core';
import { patch, post } from '../lib/api';
import { fmtDate, fmtInstant } from '../lib/format';
import { useAction } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ProjectView } from '../lib/types';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  InlineError,
  Input,
  Select,
  TextArea,
  useToast,
} from './ui';

function teamOptions(project: ProjectView) {
  const t = project.team;
  return [
    ...new Set(
      [t.pm, ...t.tech, t.fde, t.salesPoc, t.csm, t.deliveryHead].filter((x): x is string => !!x),
    ),
  ];
}

export function TaskDialog({
  project,
  task,
  onClose,
  onSaved,
}: {
  project: ProjectView;
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me, nameOf } = useSession();
  const toast = useToast();
  const isNew = task === null;
  const canAny = project.permissions.createTask;
  const own = !!task && task.ownerId === me?.user.id;
  const editable = canAny || own;
  const [f, setF] = useState({
    title: task?.title ?? '',
    phase: task?.phase ?? 'Build',
    description: task?.description ?? '',
    ownerId: task?.ownerId ?? null,
    ownerChangeReason: '',
    priority: (task?.priority ?? 'medium') as Priority,
    plannedStart: task?.plannedStart ?? project.startDate,
    plannedEnd: task?.plannedEnd ?? '',
    revisedEnd: task ? currentDue(task) : '',
    revisionReason: '',
    status: (task?.status ?? 'not_started') as TaskStatus,
    statusReason: '',
    closureNotes: '',
    blocker: task?.blocker ?? '',
    progress: task?.progress ?? 0,
    remarks: task?.remarks ?? '',
    nextAction: task?.nextAction ?? '',
    dependencies: (task?.dependencies ?? []).join(', '),
    isMilestone: task?.isMilestone ?? false,
    clientCommitment: task?.clientCommitment ?? false,
  });
  const [comment, setComment] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const deps = f.dependencies
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const save = useAction(async () => {
    if (isNew) {
      await post(`/api/projects/${project.id}/tasks`, {
        title: f.title,
        phase: f.phase,
        description: f.description,
        ownerId: f.ownerId,
        priority: f.priority,
        plannedStart: f.plannedStart,
        plannedEnd: f.plannedEnd,
        isMilestone: f.isMilestone,
        clientCommitment: f.clientCommitment,
        dependencies: deps,
        parentId: null,
      });
      toast('success', 'Task created.');
    } else {
      const t = task!;
      const body: Record<string, unknown> = { expectedUpdatedAt: t.updatedAt };
      const changed = <K extends keyof typeof f>(k: K, orig: unknown) =>
        JSON.stringify(f[k]) !== JSON.stringify(orig);
      if (changed('status', t.status)) {
        body.status = f.status;
        if (f.statusReason) body.statusReason = f.statusReason;
        if (f.status === 'completed') body.closureNotes = f.closureNotes;
      }
      if (changed('revisedEnd', currentDue(t)))
        Object.assign(body, { revisedEnd: f.revisedEnd, revisionReason: f.revisionReason });
      if (changed('blocker', t.blocker)) body.blocker = f.blocker;
      if (changed('progress', t.progress)) body.progress = Number(f.progress);
      if (changed('remarks', t.remarks)) body.remarks = f.remarks;
      if (changed('nextAction', t.nextAction)) body.nextAction = f.nextAction;
      if (canAny) {
        if (changed('title', t.title)) body.title = f.title;
        if (changed('phase', t.phase)) body.phase = f.phase;
        if (changed('description', t.description)) body.description = f.description;
        if (changed('priority', t.priority)) body.priority = f.priority;
        if (changed('ownerId', t.ownerId))
          Object.assign(body, { ownerId: f.ownerId, ownerChangeReason: f.ownerChangeReason });
        if (changed('plannedStart', t.plannedStart)) body.plannedStart = f.plannedStart;
        if (JSON.stringify(deps) !== JSON.stringify(t.dependencies)) body.dependencies = deps;
        if (changed('isMilestone', t.isMilestone)) body.isMilestone = f.isMilestone;
        if (changed('clientCommitment', t.clientCommitment))
          body.clientCommitment = f.clientCommitment;
      }
      if (Object.keys(body).length === 1) return onClose();
      await patch(`/api/projects/${project.id}/tasks/${t.id}`, body);
      toast('success', 'Task updated.');
    }
    onSaved();
  });
  const addComment = useAction(async () => {
    await post(`/api/projects/${project.id}/tasks/${task!.id}/comments`, { body: comment });
    setComment('');
    onSaved();
  });
  const errs = save.error?.fields ?? {};
  const statusChanged = task && f.status !== task.status;
  const dueChanged = task && f.revisedEnd !== currentDue(task);

  return (
    <Dialog
      open
      wide
      title={isNew ? 'New task' : `${task!.id} · ${task!.title}`}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
              {isNew ? 'Create task' : 'Save changes'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {!editable && (
        <p className="notice">You can view this task. Only its owner and the PM can change it.</p>
      )}
      <InlineError error={save.error && !Object.keys(errs).length ? save.error : null} />
      {task && (
        <div className="row wrap">
          <Badge value={task.status} />
          <span className="hint">Original deadline {fmtDate(task.plannedEnd)}</span>
          {task.revisedEnd && (
            <span className="hint">
              · current due {fmtDate(task.revisedEnd)} ({task.revisions.length} revision(s))
            </span>
          )}
          <span className="hint">· WBS {task.wbsId}</span>
        </div>
      )}
      <fieldset disabled={!editable} className="fieldset-plain">
        <div className="grid-2">
          <Field label="Title" required error={errs.title}>
            {(p) => (
              <Input
                {...p}
                disabled={!canAny}
                value={f.title}
                onChange={(e) => set('title', e.target.value)}
              />
            )}
          </Field>
          <Field label="Phase" required error={errs.phase}>
            {(p) => (
              <Input
                {...p}
                disabled={!canAny}
                value={f.phase}
                onChange={(e) => set('phase', e.target.value)}
              />
            )}
          </Field>
          <Field label="Owner" error={errs.ownerId}>
            {(p) => (
              <Select
                {...p}
                disabled={!canAny}
                value={f.ownerId ?? ''}
                onChange={(e) => set('ownerId', e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {teamOptions(project).map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select
                {...p}
                disabled={!canAny}
                value={f.priority}
                onChange={(e) => set('priority', e.target.value as Priority)}
              >
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {PRIORITY_LABELS[x]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {!isNew && canAny && f.ownerId !== task!.ownerId && (
          <Field label="Reason for changing owner" required error={errs.ownerChangeReason}>
            {(p) => (
              <Input
                {...p}
                value={f.ownerChangeReason}
                onChange={(e) => set('ownerChangeReason', e.target.value)}
              />
            )}
          </Field>
        )}
        <div className="grid-2">
          <Field label="Planned start" required error={errs.plannedStart}>
            {(p) => (
              <Input
                {...p}
                type="date"
                disabled={!canAny}
                value={f.plannedStart}
                onChange={(e) => set('plannedStart', e.target.value)}
              />
            )}
          </Field>
          {isNew ? (
            <Field
              label="Deadline (original)"
              required
              error={errs.plannedEnd}
              hint="Kept permanently; later changes are recorded as revisions."
            >
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  min={f.plannedStart}
                  value={f.plannedEnd}
                  onChange={(e) => set('plannedEnd', e.target.value)}
                />
              )}
            </Field>
          ) : (
            <Field
              label="Current due date"
              error={errs.revisedEnd}
              hint="Changing this records a revision; the original deadline is kept."
            >
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  min={f.plannedStart}
                  value={f.revisedEnd}
                  onChange={(e) => set('revisedEnd', e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
        {dueChanged && (
          <Field label="Reason for new date" required error={errs.revisionReason}>
            {(p) => (
              <Input
                {...p}
                value={f.revisionReason}
                onChange={(e) => set('revisionReason', e.target.value)}
              />
            )}
          </Field>
        )}
        {!isNew && (
          <div className="grid-2">
            <Field label="Status">
              {(p) => (
                <Select
                  {...p}
                  value={f.status}
                  onChange={(e) => set('status', e.target.value as TaskStatus)}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Progress (%)" error={errs.progress}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  value={f.progress}
                  onChange={(e) => set('progress', Number(e.target.value))}
                />
              )}
            </Field>
          </div>
        )}
        {statusChanged && f.status === 'completed' && (
          <Field label="Closure notes" required>
            {(p) => (
              <TextArea
                {...p}
                value={f.closureNotes}
                onChange={(e) => set('closureNotes', e.target.value)}
              />
            )}
          </Field>
        )}
        {statusChanged && (f.status === 'cancelled' || task!.status === 'completed') && (
          <Field label="Reason" required>
            {(p) => (
              <Input
                {...p}
                value={f.statusReason}
                onChange={(e) => set('statusReason', e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Blocker" hint="Required when the status is Blocked.">
          {(p) => (
            <Input {...p} value={f.blocker} onChange={(e) => set('blocker', e.target.value)} />
          )}
        </Field>
        <div className="grid-2">
          <Field label="Next action">
            {(p) => (
              <Input
                {...p}
                value={f.nextAction}
                onChange={(e) => set('nextAction', e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Dependencies"
            hint="Task IDs, comma separated (e.g. T-0003)."
            error={errs.dependencies}
          >
            {(p) => (
              <Input
                {...p}
                disabled={!canAny}
                value={f.dependencies}
                onChange={(e) => set('dependencies', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Description">
          {(p) => (
            <TextArea
              {...p}
              disabled={!canAny}
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <Field label="Remarks">
          {(p) => (
            <TextArea {...p} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
          )}
        </Field>
        {canAny && (
          <div className="row wrap">
            <Checkbox
              label="Milestone"
              checked={f.isMilestone}
              onChange={(v) => set('isMilestone', v)}
            />
            <Checkbox
              label="Client commitment"
              checked={f.clientCommitment}
              onChange={(v) => set('clientCommitment', v)}
            />
          </div>
        )}
      </fieldset>
      {task && (
        <>
          {task.revisions.length > 0 && (
            <details className="handover-section">
              <summary>
                Deadline revisions <span className="tab-count">{task.revisions.length}</span>
              </summary>
              <ul className="compact">
                {task.revisions.map((r, i) => (
                  <li key={i}>
                    {fmtDate(r.from)} → {fmtDate(r.to)} by {nameOf(r.by)} on {fmtInstant(r.at)}:{' '}
                    {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="handover-section" open={task.comments.length > 0}>
            <summary>
              Comments and evidence <span className="tab-count">{task.comments.length}</span>
            </summary>
            <ul className="compact">
              {task.comments.map((c) => (
                <li key={c.id}>
                  <strong>{nameOf(c.by)}</strong> <span className="hint">{fmtInstant(c.at)}</span>:{' '}
                  {c.body}{' '}
                  {c.evidenceUrl && (
                    <a href={c.evidenceUrl} target="_blank" rel="noopener noreferrer">
                      evidence
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {editable && (
              <div className="row">
                <label className="sr-only" htmlFor="new-comment">
                  Add a comment
                </label>
                <Input
                  id="new-comment"
                  placeholder="Add a comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button
                  disabled={!comment.trim()}
                  loading={addComment.pending}
                  onClick={() => void addComment.run()}
                >
                  Add
                </Button>
              </div>
            )}
            <InlineError error={addComment.error} />
          </details>
          <details className="handover-section">
            <summary>
              History <span className="tab-count">{task.history.length}</span>
            </summary>
            <ul className="compact">
              {task.history.map((h, i) => (
                <li key={i}>
                  {fmtInstant(h.at)} — {nameOf(h.by)}: {h.action.replace(/_/g, ' ')}{' '}
                  {Object.keys(h.changes).length > 0 && (
                    <span className="hint">({Object.keys(h.changes).join(', ')})</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Dialog>
  );
}

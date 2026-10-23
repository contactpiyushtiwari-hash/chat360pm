import { addDays, todayIn, type Project } from '@chat360/core';
import { describe, expect, it } from 'vitest';
import { PATHS } from '../src/store/repos';
import { readJson, setup, trackerText, type Ctx } from './helpers';

const today = () => todayIn('Asia/Kolkata');

async function doc(t: Ctx, id: string): Promise<Project> {
  return (await t.deps.repos.project(id))!;
}

function newProjectBody(over: Record<string, unknown> = {}) {
  return {
    clientName: 'Fabrikam',
    name: 'Support Bot',
    category: 'Chatbot',
    pmId: 'demo-pm1',
    techIds: ['demo-tech1'],
    fdeId: 'demo-fde',
    salesPocId: null,
    csmId: 'demo-csm',
    deliveryHeadId: 'demo-head',
    startDate: today(),
    targetGoLive: addDays(today(), 40),
    languages: ['English'],
    integrations: [],
    qaUatWorkflow: '',
    templateId: 'standard_bot',
    destinationId: 'default',
    ...over,
  };
}

describe('project creation and tracker download', () => {
  it('creates the project and an index entry; the tracker is generated on download', async () => {
    const t = await setup();
    const pm = await t.as('demo-pm1');
    const res = await pm.post('/api/projects', newProjectBody());
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.project.permissions).toMatchObject({
      requestTransfer: true,
      downloadTracker: true,
    });
    expect(body.project).not.toHaveProperty('appliedOperations');
    expect(body.project.tasks).toHaveLength(13);
    const files = [...t.deps.store.files.keys()].filter((k) => k.includes(body.project.id));
    expect(files.some((f) => f.endsWith('/project.json'))).toBe(true);
    const xlsx = await trackerText(pm, body.project.id);
    expect(xlsx).toContain('tblWBS');
    expect(xlsx).toContain(body.project.tasks[12].title);
  });

  it('is idempotent for a retried submission with the same key', async () => {
    const t = await setup();
    const pm = await t.as('demo-pm1');
    const a = await pm.json(
      pm.post('/api/projects', newProjectBody(), { 'Idempotency-Key': 'same-key-123' }),
    );
    const b = await pm.post('/api/projects', newProjectBody(), {
      'Idempotency-Key': 'same-key-123',
    });
    expect(b.status).toBe(200);
    expect((await readJson(b)).project.id).toBe(a.project.id);
    const idx = await t.deps.repos.index(true);
    expect(idx.projects.filter((p) => p.name === 'Support Bot')).toHaveLength(1);
  });

  it('serves the tracker only to people who can see the project', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const res = await (await t.as('demo-pm1')).get(`/api/projects/${id}/tracker.xlsx`);
    expect(res.headers.get('content-type')).toMatch(/spreadsheetml/);
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename=".*Tracker\.xlsx"/,
    );
    const outsider = await t.as('demo-new');
    expect((await outsider.get(`/api/projects/${id}/tracker.xlsx`)).status).toBe(404);
  });

  it('validates input and enforces who can create', async () => {
    const t = await setup();
    const tech = await t.as('demo-tech1');
    expect((await tech.post('/api/projects', newProjectBody())).status).toBe(403);
    const pm = await t.as('demo-pm1');
    const bad = await pm.post(
      '/api/projects',
      newProjectBody({ targetGoLive: '2000-01-01', clientName: '' }),
    );
    expect(bad.status).toBe(422);
    const err = await readJson(bad);
    expect(Object.keys(err.error.details.fields)).toEqual(
      expect.arrayContaining(['clientName', 'targetGoLive']),
    );
  });

  it('hides projects from people without access (404, not 403)', async () => {
    const t = await setup();
    const outsider = await t.as('demo-new');
    expect((await outsider.get(`/api/projects/${t.projects[0]}`)).status).toBe(404);
    const admin = await t.as('demo-admin');
    expect((await admin.get(`/api/projects/${t.projects[0]}`)).status).toBe(404);
  });
});

describe('daily confirmation → escalation and notifications', () => {
  it('not completed: preserves deadline, escalates to the PM and notifies', async () => {
    const t = await setup();
    const tech = await t.as('demo-tech1');
    const todayList = await tech.json(tech.get('/api/today'));
    const item = todayList.due[0];
    expect(item).toBeTruthy();
    const res = await tech.post(`/api/projects/${item.projectId}/tasks/${item.task.id}/confirm`, {
      outcome: 'not_completed',
      reasonCategory: 'client_dependency',
      reason: 'Waiting for sandbox credentials',
      impact: 'UAT may slip',
      nextAction: 'Chase client IT',
      revisedEta: addDays(today(), 3),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.escalation.managerId).toBe('demo-pm1');
    expect(body.task.plannedEnd).toBe(item.task.plannedEnd);
    await t.deps.settle();

    const p = await doc(t, item.projectId);
    const mail = t.deps.recordingMailer.sent.find((m) => m.subject.includes('Escalation'));
    expect(mail?.to).toEqual(['demo-pm1@chat.io']);
    expect(p.escalations[0]!.notifications[0]!.status).toBe('sent');

    // The downloaded tracker carries the escalation in its log.
    const tech2 = await t.as('demo-tech1');
    expect(await trackerText(tech2, item.projectId)).toContain(p.escalations[0]!.id);

    // Escalation is visible to the PM in their list.
    const pm = await t.as('demo-pm1');
    const escs = await pm.json(pm.get('/api/escalations'));
    expect(escs.escalations.map((e: { id: string }) => e.id)).toContain(p.escalations[0]!.id);
  });

  it('records a failed notification without pretending it was sent', async () => {
    const t = await setup();
    t.deps.recordingMailer.fail = true;
    const tech = await t.as('demo-tech1');
    const item = (await tech.json(tech.get('/api/today'))).due[0];
    await tech.post(`/api/projects/${item.projectId}/tasks/${item.task.id}/confirm`, {
      outcome: 'not_completed',
      reasonCategory: 'other',
      reason: 'r',
      impact: '',
      nextAction: 'n',
      revisedEta: addDays(today(), 2),
    });
    await t.deps.settle();
    const n = (await doc(t, item.projectId)).escalations[0]!.notifications[0]!;
    expect(n.status).toBe('failed');
    expect(n.lastError).toMatch(/503/);
  });

  it('completed: closes the task and removes it from today', async () => {
    const t = await setup();
    const tech = await t.as('demo-tech1');
    const item = (await tech.json(tech.get('/api/today'))).due[0];
    const res = await tech.post(`/api/projects/${item.projectId}/tasks/${item.task.id}/confirm`, {
      outcome: 'completed',
      notes: 'Shipped to staging',
    });
    expect((await readJson(res)).task.status).toBe('completed');
    expect((await tech.json(tech.get('/api/today'))).due).toEqual([]);
  });
});

describe('concurrent updates', () => {
  it('retries on an eTag conflict instead of overwriting', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const p0 = await doc(t, id);
    t.deps.store.conflictsToInject.set(PATHS.project(p0.folderPath), 2);
    const pm = await t.as('demo-pm1');
    const res = await pm.patch(`/api/projects/${id}/tasks/T-0006`, { progress: 30 });
    expect(res.status).toBe(200);
    expect((await doc(t, id)).tasks.find((x) => x.id === 'T-0006')!.progress).toBe(30);
  });

  it('rejects stale task edits with a clear conflict', async () => {
    const t = await setup();
    const pm = await t.as('demo-pm1');
    const res = await pm.patch(`/api/projects/${t.projects[0]}/tasks/T-0006`, {
      progress: 10,
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(409);
  });
});

describe('project transfer — PM request path', () => {
  it('submit → review → approve executes the handover and preserves history', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const before = await doc(t, id);
    const pm = await t.as('demo-pm1');
    const created = await pm.post(`/api/projects/${id}/transfers`, {
      proposedPmId: 'demo-pm2',
      reason: 'Moving to a new key account',
      requestedEffectiveDate: today(),
      handoverNotes: 'Client prefers weekly calls',
      submit: true,
    });
    expect(created.status).toBe(201);
    const tr = (await readJson(created)).transfer;
    expect(tr.status).toBe('submitted');
    expect(tr.snapshot.openTasks.length).toBeGreaterThan(0);
    await t.deps.settle();
    expect(
      t.deps.recordingMailer.sent.some(
        (m) => m.subject.includes('PM transfer submitted') && m.to.includes('demo-head@chat.io'),
      ),
    ).toBe(true);

    expect((await pm.post(`/api/projects/${id}/transfers/${tr.id}/approve`, {})).status).toBe(403);
    const head = await t.as('demo-head');
    const list = await head.json(head.get('/api/transfers'));
    expect(list.transfers[0].id).toBe(tr.id);
    await head.post(`/api/projects/${id}/transfers/${tr.id}/review`);
    const approved = await head.json(
      head.post(`/api/projects/${id}/transfers/${tr.id}/approve`, { notes: 'Approved' }),
    );
    expect(approved.transfer.status).toBe('completed');
    expect(
      approved.transfer.execution.steps.map(
        (s: { name: string; status: string }) => `${s.name}:${s.status}`,
      ),
    ).toEqual(['assign_pm:done', 'update_index:done', 'notify:done']);

    const after = await doc(t, id);
    expect(after.team.pm).toBe('demo-pm2');
    expect(after.tasks.map((x) => [x.id, x.ownerId, x.plannedEnd])).toEqual(
      before.tasks.map((x) => [x.id, x.ownerId, x.plannedEnd]),
    );
    expect(after.teamHistory.at(-1)).toMatchObject({
      role: 'pm',
      from: ['demo-pm1'],
      to: ['demo-pm2'],
      transferId: tr.id,
    });

    // New PM manages; the previous PM keeps contributor access because they still own tasks.
    const pm2 = await t.as('demo-pm2');
    expect((await pm2.json(pm2.get(`/api/projects/${id}`))).project.access).toBe('manager');
    expect((await pm.json(pm.get(`/api/projects/${id}`))).project.access).toBe('contributor');
    const idx = await t.deps.repos.index(true);
    expect(idx.projects.find((p) => p.id === id)!.pmId).toBe('demo-pm2');
  });

  it('rejection requires a reason and leaves the PM unchanged', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const pm = await t.as('demo-pm1');
    const tr = (
      await pm.json(
        pm.post(`/api/projects/${id}/transfers`, {
          proposedPmId: null,
          reason: 'Overloaded',
          requestedEffectiveDate: today(),
          submit: true,
        }),
      )
    ).transfer;
    const head = await t.as('demo-head');
    expect(
      (await head.post(`/api/projects/${id}/transfers/${tr.id}/reject`, { reason: '' })).status,
    ).toBe(422);
    const r = await head.json(
      head.post(`/api/projects/${id}/transfers/${tr.id}/reject`, {
        reason: 'Go-live in 2 weeks; revisit after',
      }),
    );
    expect(r.transfer.status).toBe('rejected');
    expect((await doc(t, id)).team.pm).toBe('demo-pm1');
  });

  it('an approved transfer with a future effective date waits for the scheduled job', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const pm = await t.as('demo-pm1');
    const tr = (
      await pm.json(
        pm.post(`/api/projects/${id}/transfers`, {
          proposedPmId: 'demo-pm2',
          reason: 'Leave',
          requestedEffectiveDate: addDays(today(), 5),
          submit: true,
        }),
      )
    ).transfer;
    const head = await t.as('demo-head');
    const r = await head.json(head.post(`/api/projects/${id}/transfers/${tr.id}/approve`, {}));
    expect(r.transfer.status).toBe('approved');
    expect((await doc(t, id)).team.pm).toBe('demo-pm1');
  });
});

describe('project transfer — direct reassignment by the Delivery Head', () => {
  it('requires confirmation and the head role, then reassigns', async () => {
    const t = await setup();
    const id = t.projects[1]!;
    const pm = await t.as('demo-pm2');
    const payload = {
      newPmId: 'demo-pm1',
      reason: 'Rebalancing workload',
      effectiveDate: today(),
      handoverNotes: '',
    };
    expect(
      (await pm.post(`/api/projects/${id}/reassign-pm`, { ...payload, confirm: true })).status,
    ).toBe(403);
    const head = await t.as('demo-head');
    expect((await head.post(`/api/projects/${id}/reassign-pm`, payload)).status).toBe(422);
    const handover = await head.json(head.get(`/api/projects/${id}/handover`));
    expect(handover.handover).toHaveProperty('openTasks');
    const res = await head.post(`/api/projects/${id}/reassign-pm`, { ...payload, confirm: true });
    expect(res.status).toBe(201);
    expect((await readJson(res)).transfer.status).toBe('completed');
    expect((await doc(t, id)).team.pm).toBe('demo-pm1');
  });

  it('an interrupted reassignment stays approved with a visible error, and the scheduled job resumes it', async () => {
    const t = await setup();
    const id = t.projects[1]!;
    const head = await t.as('demo-head');
    t.deps.store.failPaths = /projects-index\.json$/;
    const res = await head.post(`/api/projects/${id}/reassign-pm`, {
      newPmId: 'demo-pm1',
      reason: 'r',
      effectiveDate: today(),
      handoverNotes: '',
      confirm: true,
    });
    expect(res.status).toBe(500);
    expect((await readJson(res)).error.errorId).toMatch(/^ERR-/);
    t.deps.store.failPaths = null;
    let p = await doc(t, id);
    const tr = p.transfers.at(-1)!;
    // The decision was recorded before any multi-step work; nothing claims completion.
    expect(tr.status).toBe('approved');
    expect(p.team.pm).toBe('demo-pm2');
    const { runJob } = await import('../src/jobs/scheduled');
    const run = await runJob(t.deps, 'maintenance', 'test');
    expect(run.stats.transfersCompleted).toBe(1);
    p = await doc(t, id);
    expect(p.transfers.at(-1)!.status).toBe('completed');
    expect(p.team.pm).toBe('demo-pm1');
    expect(p.teamHistory.filter((h) => h.transferId === tr.id)).toHaveLength(1);
    // Re-running is a no-op.
    await runJob(t.deps, 'maintenance', 'test-again');
    expect((await doc(t, id)).teamHistory.filter((h) => h.transferId === tr.id)).toHaveLength(1);
  });
});

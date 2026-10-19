import { describe, expect, it } from 'vitest';
import {
  applyPmAssignment,
  approveTransfer,
  cancelTransfer,
  completeIfReady,
  directReassignment,
  recordMissedConfirmations,
  recordStepOutcome,
  rejectTransfer,
  requestTransfer,
  startReview,
  transfersNeedingExecution,
} from '../src';
import { config, ctx, directory, newProject, people } from './fixtures';

const draft = {
  proposedPmId: people.pm2.id,
  reason: 'Moving to a new account',
  requestedEffectiveDate: '2026-10-19',
  handoverNotes: 'Client prefers WhatsApp updates',
  submit: true,
};

function execute(p: ReturnType<typeof newProject>, id: string) {
  applyPmAssignment(p, id, ctx(people.head));
  recordStepOutcome(p, id, 'update_index', { ok: true }, '2026-10-19T10:00:00.000Z');
  return completeIfReady(p, id, people.head.id, '2026-10-19T10:00:00.000Z');
}

describe('transfer requested by the PM', () => {
  it('submits with a prepopulated handover snapshot and notifies the head', () => {
    const p = newProject();
    const t = requestTransfer(p, draft, ctx(people.pm), directory);
    expect(t.status).toBe('submitted');
    expect(t.fromPmId).toBe(people.pm.id);
    expect(t.snapshot.openTasks.length).toBe(p.tasks.length);
    expect(t.snapshot.clientCommitments.length).toBeGreaterThan(0);
    expect(t.notifications[0]).toMatchObject({
      kind: 'transfer.submitted',
      recipientIds: [people.head.id],
    });
  });

  it('only the current PM can request, and only one active request at a time', () => {
    const p = newProject();
    expect(() => requestTransfer(p, draft, ctx(people.tech), directory)).toThrow(
      /Only the current PM/,
    );
    requestTransfer(p, draft, ctx(people.pm), directory);
    expect(() => requestTransfer(p, draft, ctx(people.pm), directory)).toThrow(
      /already has an active/,
    );
  });

  it('approval → execution changes only the PM and preserves everything else', () => {
    const p = newProject();
    recordMissedConfirmations(p, {
      today: '2026-10-19',
      now: '2026-10-19T13:30:00.000Z',
      config: config(),
    });
    const tasksBefore = JSON.stringify(p.tasks);
    const escBefore = JSON.stringify(p.escalations);
    const historyBefore = p.teamHistory.length;
    const t = requestTransfer(p, draft, ctx(people.pm), directory);
    startReview(p, t.id, ctx(people.head));
    approveTransfer(p, t.id, undefined, 'OK', ctx(people.head), directory);
    expect(execute(p, t.id)).toBe(true);
    expect(p.team.pm).toBe(people.pm2.id);
    expect(t.status).toBe('completed');
    expect(JSON.stringify(p.tasks)).toBe(tasksBefore); // task owners and deadlines untouched
    expect(JSON.stringify(p.escalations)).toBe(escBefore);
    expect(p.teamHistory).toHaveLength(historyBefore + 1);
    expect(p.teamHistory.at(-1)).toMatchObject({
      role: 'pm',
      from: [people.pm.id],
      to: [people.pm2.id],
      transferId: t.id,
    });
    expect(p.formerPms).toEqual([{ userId: people.pm.id, until: '2026-11-18' }]);
    expect(p.transfers).toHaveLength(1);
  });

  it('rejection requires a reason and is final', () => {
    const p = newProject();
    const t = requestTransfer(p, draft, ctx(people.pm), directory);
    expect(() => rejectTransfer(p, t.id, '', ctx(people.head))).toThrow(/rejection reason/);
    expect(() => rejectTransfer(p, t.id, 'No', ctx(people.pm))).toThrow(/Only the Delivery/);
    rejectTransfer(p, t.id, 'Client escalation in progress', ctx(people.head));
    expect(t.status).toBe('rejected');
    expect(p.team.pm).toBe(people.pm.id);
    expect(() => approveTransfer(p, t.id, people.pm2.id, '', ctx(people.head), directory)).toThrow(
      /cannot move/,
    );
  });

  it('requester can cancel a pending request', () => {
    const p = newProject();
    const t = requestTransfer(p, draft, ctx(people.pm), directory);
    cancelTransfer(p, t.id, ctx(people.pm));
    expect(t.status).toBe('cancelled');
  });

  it('new PM must hold the PM role', () => {
    const p = newProject();
    const t = requestTransfer(p, { ...draft, proposedPmId: null }, ctx(people.pm), directory);
    expect(() => approveTransfer(p, t.id, people.tech.id, '', ctx(people.head), directory)).toThrow(
      /Project Manager role/,
    );
    expect(() => approveTransfer(p, t.id, undefined, '', ctx(people.head), directory)).toThrow(
      /Select the new PM/,
    );
  });
});

describe('direct reassignment by the Delivery Head', () => {
  it('reassigns without a PM request and supersedes a pending one', () => {
    const p = newProject();
    const pending = requestTransfer(p, { ...draft, proposedPmId: null }, ctx(people.pm), directory);
    const t = directReassignment(
      p,
      {
        newPmId: people.pm2.id,
        reason: 'Rebalancing',
        effectiveDate: '2026-10-19',
        handoverNotes: '',
      },
      ctx(people.head),
      directory,
    );
    expect(pending.status).toBe('cancelled');
    expect(t).toMatchObject({
      kind: 'direct_reassignment',
      status: 'approved',
      requestedBy: people.head.id,
    });
    expect(execute(p, t.id)).toBe(true);
    expect(p.team.pm).toBe(people.pm2.id);
  });

  it('is forbidden to PMs', () => {
    const p = newProject();
    expect(() =>
      directReassignment(
        p,
        { newPmId: people.pm2.id, reason: 'x', effectiveDate: '2026-10-19', handoverNotes: '' },
        ctx(people.pm),
        directory,
      ),
    ).toThrow(/Only the Delivery/);
  });
});

describe('safe execution', () => {
  it('is idempotent and does not complete until required steps succeed', () => {
    const p = newProject();
    const t = directReassignment(
      p,
      { newPmId: people.pm2.id, reason: 'x', effectiveDate: '2026-10-19', handoverNotes: '' },
      ctx(people.head),
      directory,
    );
    applyPmAssignment(p, t.id, ctx(people.head));
    applyPmAssignment(p, t.id, ctx(people.head)); // retry after a crash
    expect(p.teamHistory.filter((h) => h.transferId === t.id)).toHaveLength(1);
    recordStepOutcome(
      p,
      t.id,
      'update_index',
      { ok: false, error: 'HTTP 503' },
      '2026-10-19T10:00:00.000Z',
    );
    expect(completeIfReady(p, t.id, 'system', '2026-10-19T10:00:00.000Z')).toBe(false);
    expect(t.status).toBe('approved');
    expect(t.execution.lastError).toMatch(/503/);
    expect(transfersNeedingExecution(p, '2026-10-19')).toEqual([t]);
    recordStepOutcome(p, t.id, 'update_index', { ok: true }, '2026-10-19T11:00:00.000Z');
    expect(completeIfReady(p, t.id, 'system', '2026-10-19T11:00:00.000Z')).toBe(true);
    expect(transfersNeedingExecution(p, '2026-10-19')).toEqual([]);
  });

  it('waits for the effective date', () => {
    const p = newProject();
    const t = directReassignment(
      p,
      { newPmId: people.pm2.id, reason: 'x', effectiveDate: '2026-10-26', handoverNotes: '' },
      ctx(people.head),
      directory,
    );
    expect(transfersNeedingExecution(p, '2026-10-19')).toEqual([]);
    expect(transfersNeedingExecution(p, '2026-10-26')).toEqual([t]);
  });
});

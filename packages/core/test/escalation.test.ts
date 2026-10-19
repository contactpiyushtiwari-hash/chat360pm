import { describe, expect, it } from 'vitest';
import {
  acknowledgeEscalation,
  applyEscalationSla,
  confirmTask,
  createTask,
  currentDue,
  pendingEscalationNotifications,
  recordMissedConfirmations,
  resolveEscalation,
  tasksNeedingDecision,
} from '../src';
import { config, ctx, newProject, people } from './fixtures';

const today = '2026-10-19';
function setup(ownerId = people.tech.id) {
  const p = newProject('blank');
  const t = createTask(
    p,
    {
      title: 'Webhook',
      phase: 'Build',
      description: '',
      ownerId,
      priority: 'medium',
      plannedStart: '2026-10-12',
      plannedEnd: today,
      isMilestone: false,
      clientCommitment: false,
      dependencies: [],
      parentId: null,
    },
    ctx(people.pm),
  );
  return { p, t };
}
const sys = (d = today, cfg = config()) => ({ today: d, now: `${d}T13:30:00.000Z`, config: cfg });

describe('daily confirmation', () => {
  it('lists tasks due today or overdue for the owner', () => {
    const { p, t } = setup();
    expect(tasksNeedingDecision(p, people.tech.id, today).map((x) => x.id)).toEqual([t.id]);
    expect(tasksNeedingDecision(p, people.tech.id, '2026-10-16')).toEqual([]);
  });

  it('completed records actor, time and notes and closes the task', () => {
    const { p, t } = setup();
    const r = confirmTask(
      p,
      t.id,
      { outcome: 'completed', notes: 'Done and verified' },
      ctx(people.tech),
    );
    expect(r.confirmation).toMatchObject({ outcome: 'completed', by: people.tech.id, date: today });
    expect(t.status).toBe('completed');
    expect(t.actualEnd).toBe(today);
    expect(r.escalation).toBeNull();
    expect(tasksNeedingDecision(p, people.tech.id, today)).toEqual([]);
  });

  it('not completed preserves the original deadline, revises ETA and escalates once', () => {
    const { p, t } = setup();
    const input = {
      outcome: 'not_completed' as const,
      reasonCategory: 'client_dependency',
      reason: 'Waiting for API keys',
      impact: 'UAT slips',
      nextAction: 'Chase client',
      revisedEta: '2026-10-22',
    };
    const r = confirmTask(p, t.id, input, ctx(people.tech));
    expect(t.plannedEnd).toBe(today);
    expect(currentDue(t)).toBe('2026-10-22');
    expect(r.escalation).toMatchObject({
      type: 'not_completed',
      managerId: people.pm.id,
      level: 1,
      originalDue: today,
      revisedEta: '2026-10-22',
    });
    expect(r.escalation!.notifications[0]!.status).toBe('pending');
    // Same decision again is an idempotent replay; a contradictory one is a conflict.
    expect(confirmTask(p, t.id, input, ctx(people.tech)).replayed).toBe(true);
    expect(() =>
      confirmTask(p, t.id, { outcome: 'completed', notes: 'x' }, ctx(people.tech)),
    ).toThrow(/already confirmed/);
    expect(p.escalations).toHaveLength(1);
  });

  it('validates reason category and ETA', () => {
    const { p, t } = setup();
    const bad = {
      outcome: 'not_completed' as const,
      reasonCategory: 'nope',
      reason: 'r',
      impact: '',
      nextAction: 'n',
      revisedEta: '2026-10-22',
    };
    expect(() => confirmTask(p, t.id, bad, ctx(people.tech))).toThrow(/Unknown delay reason/);
    expect(() =>
      confirmTask(
        p,
        t.id,
        { ...bad, reasonCategory: 'other', revisedEta: today },
        ctx(people.tech),
      ),
    ).toThrow(/after today/);
  });

  it('rejects confirmation by non-owners and of tasks not yet due', () => {
    const { p, t } = setup();
    expect(() =>
      confirmTask(p, t.id, { outcome: 'completed', notes: 'x' }, ctx(people.fde)),
    ).toThrow(/Only the task owner/);
    expect(() =>
      confirmTask(p, t.id, { outcome: 'completed', notes: 'x' }, ctx(people.tech, '2026-10-16')),
    ).toThrow(/not due yet/);
  });

  it('routes the escalation past the PM when the PM owns the task', () => {
    const { p, t } = setup(people.pm.id);
    const r = confirmTask(
      p,
      t.id,
      {
        outcome: 'not_completed',
        reasonCategory: 'other',
        reason: 'r',
        impact: '',
        nextAction: 'n',
        revisedEta: '2026-10-21',
      },
      ctx(people.pm),
    );
    expect(r.escalation).toMatchObject({
      level: 2,
      managerId: people.head.id,
      managerRole: 'delivery_head',
    });
  });
});

describe('scheduled no-response handling', () => {
  it('marks unconfirmed (never completed) and escalates exactly once on re-runs', () => {
    const { p, t } = setup();
    const first = recordMissedConfirmations(p, sys());
    const second = recordMissedConfirmations(p, sys());
    expect(first.unconfirmed).toEqual([t.id]);
    expect(second).toEqual({ unconfirmed: [], escalated: [] });
    expect(t.status).toBe('not_started');
    expect(t.confirmations.filter((c) => c.outcome === 'no_response')).toHaveLength(1);
    expect(p.escalations).toHaveLength(1);
    expect(p.escalations[0]!.type).toBe('no_response');
  });

  it('does not open a second escalation while one is open for the task', () => {
    const { p } = setup();
    recordMissedConfirmations(p, sys());
    recordMissedConfirmations(p, sys('2026-10-20'));
    expect(p.escalations).toHaveLength(1);
  });

  it('skips non-working days', () => {
    const { p } = setup();
    expect(recordMissedConfirmations(p, sys('2026-10-24')).unconfirmed).toEqual([]);
  });

  it('allows a late human answer after the system mark', () => {
    const { p, t } = setup();
    recordMissedConfirmations(p, sys());
    confirmTask(
      p,
      t.id,
      { outcome: 'completed', notes: 'Finished late evening' },
      ctx(people.tech),
    );
    expect(t.status).toBe('completed');
  });
});

describe('escalation lifecycle', () => {
  it('raises the level after SLA, once', () => {
    const { p } = setup();
    recordMissedConfirmations(p, sys());
    const later = { today: '2026-10-20', now: '2026-10-20T14:00:00.000Z', config: config() };
    expect(applyEscalationSla(p, later)).toHaveLength(1);
    expect(applyEscalationSla(p, later)).toHaveLength(0);
    const e = p.escalations[0]!;
    expect(e.level).toBe(2);
    expect(e.managerId).toBe(people.head.id);
    expect(e.levelHistory).toHaveLength(2);
    expect(pendingEscalationNotifications(p)).toHaveLength(2);
  });

  it('acknowledge and resolve with permission checks', () => {
    const { p } = setup();
    recordMissedConfirmations(p, sys());
    const id = p.escalations[0]!.id;
    expect(() => acknowledgeEscalation(p, id, ctx(people.tech))).toThrow(
      /Only the escalation manager/,
    );
    acknowledgeEscalation(p, id, ctx(people.pm));
    expect(() => resolveEscalation(p, id, '', ctx(people.pm))).toThrow(/Resolution notes/);
    resolveEscalation(p, id, 'Client sent keys', ctx(people.pm));
    expect(p.escalations[0]).toMatchObject({ status: 'resolved', resolvedBy: people.pm.id });
  });
});

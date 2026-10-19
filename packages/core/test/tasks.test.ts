import { describe, expect, it } from 'vitest';
import { createTask, currentDue, updateTask } from '../src';
import { ctx, newProject, people } from './fixtures';

const base = {
  title: 'Configure webhook',
  phase: 'Build',
  description: '',
  ownerId: people.tech.id,
  priority: 'high' as const,
  plannedStart: '2026-10-19',
  plannedEnd: '2026-10-21',
  isMilestone: false,
  clientCommitment: false,
  dependencies: [],
  parentId: null,
};

describe('tasks', () => {
  it('creates tasks with stable sequential ids and WBS numbering', () => {
    const p = newProject('blank');
    const a = createTask(p, base, ctx(people.pm));
    const b = createTask(p, { ...base, parentId: a.id }, ctx(people.pm));
    expect(a.id).toBe('T-0001');
    expect(b.id).toBe('T-0002');
    expect(b.wbsId).toBe('1.1');
  });

  it('only managers create tasks and owners must be on the team', () => {
    const p = newProject('blank');
    expect(() => createTask(p, base, ctx(people.tech))).toThrow(/Only the project PM/);
    expect(() => createTask(p, { ...base, ownerId: people.outsider.id }, ctx(people.pm))).toThrow(
      /member of the project team/,
    );
  });

  it('preserves the original deadline when revised', () => {
    const p = newProject('blank');
    const t = createTask(p, base, ctx(people.pm));
    updateTask(
      p,
      t.id,
      { revisedEnd: '2026-10-28', revisionReason: 'Client delay' },
      ctx(people.tech),
    );
    updateTask(p, t.id, { revisedEnd: '2026-11-02', revisionReason: 'API late' }, ctx(people.tech));
    expect(t.plannedEnd).toBe('2026-10-21');
    expect(currentDue(t)).toBe('2026-11-02');
    expect(t.revisions.map((r) => [r.from, r.to])).toEqual([
      ['2026-10-21', '2026-10-28'],
      ['2026-10-28', '2026-11-02'],
    ]);
    expect(() => updateTask(p, t.id, { revisedEnd: '2026-11-09' }, ctx(people.tech))).toThrow(
      /reason is required/,
    );
  });

  it('rejects changing the original deadline (not an accepted field)', () => {
    const p = newProject('blank');
    const t = createTask(p, base, ctx(people.pm));
    expect(() =>
      updateTask(p, t.id, { plannedEnd: '2026-12-01' } as never, ctx(people.pm)),
    ).not.toThrow();
    expect(t.plannedEnd).toBe('2026-10-21');
  });

  it('owners may update execution fields but not reassign or retitle', () => {
    const p = newProject('blank');
    const t = createTask(p, base, ctx(people.pm));
    updateTask(p, t.id, { status: 'in_progress', progress: 40 }, ctx(people.tech));
    expect(t.status).toBe('in_progress');
    expect(t.actualStart).toBe('2026-10-19');
    expect(() => updateTask(p, t.id, { title: 'x' }, ctx(people.tech))).toThrow(
      /Only the PM can change: title/,
    );
    expect(() => updateTask(p, t.id, { status: 'in_progress' }, ctx(people.fde))).toThrow(
      /cannot update/,
    );
  });

  it('enforces status transition rules and closure notes', () => {
    const p = newProject('blank');
    const t = createTask(p, base, ctx(people.pm));
    expect(() => updateTask(p, t.id, { status: 'blocked' }, ctx(people.tech))).toThrow(
      /Describe the blocker/,
    );
    expect(() => updateTask(p, t.id, { status: 'completed' }, ctx(people.tech))).toThrow(
      /Closure notes/,
    );
    updateTask(p, t.id, { status: 'completed', closureNotes: 'Deployed' }, ctx(people.tech));
    expect(t.actualEnd).toBe('2026-10-19');
    expect(() =>
      updateTask(p, t.id, { status: 'in_progress', statusReason: 'bug' }, ctx(people.tech)),
    ).toThrow(/Only the PM can reopen/);
    updateTask(p, t.id, { status: 'in_progress', statusReason: 'Regression' }, ctx(people.pm));
    expect(t.actualEnd).toBeNull();
  });

  it('detects stale edits via expectedUpdatedAt', () => {
    const p = newProject('blank');
    const t = createTask(p, base, ctx(people.pm));
    expect(() =>
      updateTask(p, t.id, { progress: 10, expectedUpdatedAt: '1999-01-01' }, ctx(people.tech)),
    ).toThrow(/changed by someone else/);
  });

  it('rejects dependency cycles', () => {
    const p = newProject('blank');
    const a = createTask(p, base, ctx(people.pm));
    const b = createTask(p, { ...base, dependencies: [a.id] }, ctx(people.pm));
    expect(() => updateTask(p, a.id, { dependencies: [b.id] }, ctx(people.pm))).toThrow(/cycle/);
  });

  it('keeps an audit and history trail and bumps revision', () => {
    const p = newProject('blank');
    const before = p.revision;
    const t = createTask(p, base, ctx(people.pm));
    updateTask(p, t.id, { progress: 50 }, ctx(people.tech));
    expect(p.revision).toBe(before + 2);
    expect(t.history.at(-1)!.changes.progress).toEqual({ from: 0, to: 50 });
    expect(p.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['task.created', 'task.updated']),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  addApiDependency,
  applyOnboardingUpdate,
  computeAnalytics,
  confirmTask,
  createSupportRequest,
  createTask,
  indexEntryOf,
  lastWeekRows,
  looksLikeSecret,
  onboardingStatus,
  refreshPendingTransfers,
  renderTemplate,
  requestDeactivation,
  reviewDeactivation,
  thisWeekRows,
  updateSupportRequest,
  type AccountRequestLog,
  type SupportLog,
} from '../src';
import { config, ctx, directory, newProject, people, user } from './fixtures';

const task = (owner = people.tech.id, end = '2026-10-14') => ({
  title: 'T',
  phase: 'Build',
  description: '',
  ownerId: owner,
  priority: 'medium' as const,
  plannedStart: '2026-10-12',
  plannedEnd: end,
  isMilestone: false,
  clientCommitment: false,
  dependencies: [],
  parentId: null,
});

describe('weekly planning', () => {
  it('puts last-week work and carry-forwards in the right sheets', () => {
    const p = newProject('blank');
    const late = createTask(p, task(), ctx(people.pm)); // due last Wed, still open
    const thisWeek = createTask(p, task(people.tech.id, '2026-10-21'), ctx(people.pm));
    expect(lastWeekRows(p, '2026-10-19').map((r) => [r.task.id, r.carriedForward])).toEqual([
      [late.id, true],
    ]);
    const tw = thisWeekRows(p, '2026-10-19');
    expect(tw.map((r) => r.task.id).sort()).toEqual([late.id, thisWeek.id].sort());
    expect(tw.find((r) => r.task.id === late.id)!.carriedForward).toBe(true);
  });
});

describe('analytics', () => {
  it('computes documented metrics with null for empty denominators', () => {
    const empty = computeAnalytics([], '2026-10-19', config(), directory);
    expect(empty.onTimeDelivery.rate).toBeNull();
    const p = newProject('blank');
    const a = createTask(p, task(people.tech.id, '2026-10-19'), ctx(people.pm));
    const b = createTask(p, task(people.tech.id, '2026-10-19'), ctx(people.pm));
    confirmTask(p, a.id, { outcome: 'completed', notes: 'ok' }, ctx(people.tech));
    confirmTask(
      p,
      b.id,
      {
        outcome: 'not_completed',
        reasonCategory: 'client_dependency',
        reason: 'r',
        impact: '',
        nextAction: 'n',
        revisedEta: '2026-10-22',
      },
      ctx(people.tech),
    );
    const m = computeAnalytics([p], '2026-10-19', config(), directory);
    expect(m.onTimeDelivery).toEqual({ completed: 1, onTime: 1, rate: 1 });
    expect(m.delayReasons).toEqual([
      { id: 'client_dependency', label: 'Client dependency', count: 1 },
    ]);
    expect(m.blockerSides).toEqual({ client: 1, internal: 0 });
    expect(m.workload).toEqual([
      { userId: people.tech.id, name: 'TECH1', openTasks: 1, overdue: 0 },
    ]);
    expect(m.escalationAgeing.open).toBe(1);
    expect(m.confirmation.responseRate).toBe(1);
  });
});

describe('API dependencies', () => {
  it('rejects anything that looks like a credential', () => {
    expect(looksLikeSecret('api_key=abc123')).toBe(true);
    expect(looksLikeSecret('Bearer: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc')).toBe(
      true,
    );
    expect(looksLikeSecret('See Confluence page for auth flow')).toBe(false);
    const p = newProject('blank');
    const base = {
      name: 'CRM',
      purpose: '',
      ownerId: null,
      readiness: 'not_started' as const,
      testing: 'not_tested' as const,
      blocker: '',
      dependency: '',
      nextAction: '',
      targetDate: null,
      technicalReference: '',
    };
    expect(() =>
      addApiDependency(p, { ...base, technicalReference: 'password: hunter2' }, ctx(people.tech)),
    ).toThrow(/credential/);
    expect(addApiDependency(p, base, ctx(people.tech)).id).toBe('API-001');
    expect(() => addApiDependency(p, base, ctx(people.sales))).toThrow(/Only the PM, Tech/);
  });
});

describe('onboarding', () => {
  it('is incomplete until required and system-verified steps are done', () => {
    const u = user('n1', []);
    expect(onboardingStatus(u).missingRequired).toEqual(['welcome', 'role_assigned']);
    applyOnboardingUpdate(u, ['welcome', 'role_assigned'], ['welcome'], 'now');
    // role_assigned is system-verified and cannot be self-ticked; required steps cannot be skipped.
    expect(onboardingStatus(u).complete).toBe(false);
    expect(u.onboarding.skippedSteps).toEqual([]);
    const pm = user('p', ['pm']);
    const s = applyOnboardingUpdate(pm, ['welcome', 'pm_daily'], ['pm_create_project'], 'now');
    expect(s.complete).toBe(true);
    expect(pm.onboarding.completedAt).toBe('now');
  });
});

describe('support', () => {
  it('restricts updates to support owners and requires resolution notes', () => {
    const log: SupportLog = { schemaVersion: 1, requests: [] };
    const r = createSupportRequest(
      log,
      { category: 'bug', subject: 's', description: 'd', projectId: null, priority: 'low' },
      people.tech,
      'now',
    );
    expect(r.id).toMatch(/^SUP-/);
    expect(() =>
      updateSupportRequest(log, r.id, { status: 'in_progress' }, people.tech, 'n'),
    ).toThrow(/Only support owners/);
    expect(() =>
      updateSupportRequest(log, r.id, { status: 'in_progress' }, people.pm, 'n'),
    ).toThrow(/not found/);
    expect(() =>
      updateSupportRequest(log, r.id, { status: 'resolved' }, people.admin, 'n'),
    ).toThrow(/Resolution notes/);
    updateSupportRequest(
      log,
      r.id,
      { status: 'resolved', resolutionNotes: 'Fixed' },
      people.admin,
      'n',
    );
    updateSupportRequest(log, r.id, { status: 'closed' }, people.tech, 'n');
    expect(r.history.map((h) => h.to)).toEqual(['open', 'resolved', 'closed']);
  });
});

describe('account deactivation', () => {
  it('blocks approval while the user is PM of active projects', () => {
    const p = newProject();
    const index = [indexEntryOf(p, '2026-10-19')];
    const log: AccountRequestLog = { schemaVersion: 1, requests: [] };
    expect(() =>
      requestDeactivation(
        log,
        people.pm,
        { reason: '', confirmEmail: 'wrong@chat.io' },
        index,
        'n',
      ),
    ).toThrow(/does not match/);
    const req = requestDeactivation(
      log,
      people.pm,
      { reason: 'Leaving', confirmEmail: 'PM1@chat.io' },
      index,
      'n',
    );
    expect(req).toMatchObject({ status: 'pending_transfers', activePmProjects: [p.id] });
    expect(() => reviewDeactivation(log, req.id, 'approve', '', people.admin, index, 'n')).toThrow(
      /Transfer the user/,
    );
    expect(() => reviewDeactivation(log, req.id, 'approve', '', people.pm, index, 'n')).toThrow(
      /Only administrators/,
    );
    // After the project is transferred:
    const moved = [{ ...index[0]!, pmId: people.pm2.id }];
    refreshPendingTransfers(log, moved, 'n2');
    expect(req.status).toBe('pending_review');
    reviewDeactivation(log, req.id, 'approve', 'ok', people.admin, moved, 'n3');
    expect(req.status).toBe('approved');
  });
});

describe('communications', () => {
  it('renders templates, leaving unknown placeholders empty', () => {
    expect(renderTemplate('Hi {{client}} {{missing}}', { client: 'Acme' })).toBe('Hi Acme ');
  });
});

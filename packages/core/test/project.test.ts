import { describe, expect, it } from 'vitest';
import { assessHealth, createProject, safeFolderName, summarizeProject, updateTeam } from '../src';
import { ctx, findUser, newProject, people } from './fixtures';

describe('project creation', () => {
  it('creates a project with a template plan inside the date range', () => {
    const p = newProject();
    expect(p.id).toMatch(/^PRJ-[0-9A-Z]{8}$/);
    expect(p.tasks).toHaveLength(13);
    expect(p.tasks[0]!.id).toBe('T-0001');
    for (const t of p.tasks) {
      expect(t.plannedStart >= '2026-10-05').toBe(true);
      expect(t.plannedEnd <= '2026-12-18').toBe(true);
      expect(t.plannedEnd >= t.plannedStart).toBe(true);
    }
    // Owners come from team roles, never hardcoded people.
    expect(p.tasks.find((t) => t.phase === 'Build')!.ownerId).toBe(people.fde.id);
    expect(p.teamHistory.map((h) => h.role)).toContain('pm');
    expect(p.folderPath.startsWith('Projects/')).toBe(true);
  });

  it('requires the PM to hold the PM role', () => {
    expect(() =>
      createProject(
        {
          clientName: 'A',
          name: 'B',
          category: 'Chatbot',
          pmId: people.tech.id,
          techIds: [],
          fdeId: null,
          salesPocId: null,
          csmId: null,
          deliveryHeadId: null,
          startDate: '2026-10-05',
          targetGoLive: '2026-11-05',
          languages: [],
          integrations: [],
          qaUatWorkflow: '',
          templateId: 'blank',
          destinationId: 'default',
        },
        ctx(people.pm),
        { findUser },
      ),
    ).toThrow(/Project Manager role/);
  });

  it('rejects non-creators and unapproved destinations', () => {
    expect(() => newProject('standard_bot', ctx(people.tech))).toThrow(/Only Project Managers/);
    expect(() =>
      createProject(
        {
          clientName: 'A',
          name: 'B',
          category: 'Chatbot',
          pmId: people.pm.id,
          techIds: [],
          fdeId: null,
          salesPocId: null,
          csmId: null,
          deliveryHeadId: null,
          startDate: '2026-10-05',
          targetGoLive: '2026-11-05',
          languages: [],
          integrations: [],
          qaUatWorkflow: '',
          templateId: 'blank',
          destinationId: 'somewhere-else',
        },
        ctx(people.pm),
        { findUser },
      ),
    ).toThrow(/Unknown project destination/);
  });

  it('sanitises folder names', () => {
    expect(safeFolderName('A/B:C*D?')).toBe('A B C D');
  });

  it('team updates record history and never touch the PM or task owners', () => {
    const p = newProject();
    const owners = p.tasks.map((t) => t.ownerId);
    updateTeam(
      p,
      { techIds: [people.tech.id, people.tech2.id], reason: 'More capacity' },
      ctx(people.pm),
      findUser,
    );
    expect(p.team.tech).toEqual([people.tech.id, people.tech2.id]);
    expect(p.team.pm).toBe(people.pm.id);
    expect(p.tasks.map((t) => t.ownerId)).toEqual(owners);
    expect(p.teamHistory.at(-1)).toMatchObject({ role: 'tech', reason: 'More capacity' });
    expect(() => updateTeam(p, { fdeId: null, reason: 'x' }, ctx(people.tech), findUser)).toThrow(
      /Only the PM/,
    );
  });
});

describe('health', () => {
  it('is green for an on-track project and red when work is overdue near go-live', () => {
    const p = newProject();
    expect(assessHealth(p, '2026-10-05').health).toBe('green');
    const late = assessHealth(p, '2026-12-10');
    expect(late.health).toBe('red');
    expect(late.reasons.join(' ')).toMatch(/overdue/);
    expect(summarizeProject(p, '2026-12-10').overdueTasks).toBeGreaterThan(3);
  });
});

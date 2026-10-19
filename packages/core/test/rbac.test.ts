import { describe, expect, it } from 'vitest';
import {
  accessSubjectOf,
  can,
  canAdminister,
  canCreateProject,
  indexEntryOf,
  projectAccess,
} from '../src';
import { newProject, people } from './fixtures';

const today = '2026-10-19';

describe('rbac', () => {
  const project = newProject();
  const subject = accessSubjectOf(project);

  it('grants the ladder of access levels', () => {
    expect(projectAccess(people.head, subject, today)).toBe('portfolio');
    expect(projectAccess(people.pm, subject, today)).toBe('manager');
    expect(projectAccess(people.tech, subject, today)).toBe('contributor');
    expect(projectAccess(people.outsider, subject, today)).toBe('none');
  });

  it('gives administrators no implicit project access', () => {
    expect(canAdminister(people.admin)).toBe(true);
    expect(projectAccess(people.admin, subject, today)).toBe('none');
  });

  it('never grants privileges because of an email domain', () => {
    const anyone = { ...people.outsider, email: 'ceo@chat.io', roles: [] };
    expect(canCreateProject(anyone)).toBe(false);
    expect(projectAccess(anyone, subject, today)).toBe('none');
  });

  it('only the current PM can request a transfer; only the head can reassign', () => {
    expect(can(people.pm, 'transfer.request', subject, today)).toBe(true);
    expect(can(people.head, 'transfer.request', subject, today)).toBe(false);
    expect(can(people.head, 'pm.reassign', subject, today)).toBe(true);
    expect(can(people.pm, 'pm.reassign', subject, today)).toBe(false);
  });

  it('limits API management to PM, tech and FDE', () => {
    expect(can(people.tech, 'api.manage', subject, today)).toBe(true);
    expect(can(people.fde, 'api.manage', subject, today)).toBe(true);
    expect(can(people.sales, 'api.manage', subject, today)).toBe(false);
  });

  it('denies deactivated users everything', () => {
    expect(projectAccess({ ...people.pm, status: 'deactivated' }, subject, today)).toBe('none');
  });

  it('gives former PMs read access only within the window', () => {
    const s = {
      ...subject,
      pmId: people.pm2.id,
      memberIds: [],
      taskOwnerIds: [],
      formerPms: [{ userId: people.pm.id, until: '2026-10-30' }],
    };
    expect(projectAccess(people.pm, s, today)).toBe('read');
    expect(projectAccess(people.pm, s, '2026-11-01')).toBe('none');
  });

  it('index entries authorise the same way as full documents', () => {
    const entry = accessSubjectOf(indexEntryOf(project, today));
    expect(projectAccess(people.tech, entry, today)).toBe('contributor');
    expect(projectAccess(people.outsider, entry, today)).toBe('none');
  });
});

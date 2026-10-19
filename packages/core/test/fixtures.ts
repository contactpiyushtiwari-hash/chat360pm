import {
  createProject,
  defaultOrgConfig,
  type DirectoryUser,
  type DomainContext,
  type GlobalRole,
  type OrgConfig,
} from '../src';

export function user(
  id: string,
  roles: GlobalRole[],
  extra: Partial<DirectoryUser> = {},
): DirectoryUser {
  return {
    id,
    tenantId: 'tenant-1',
    email: `${id}@chat.io`,
    displayName: id.toUpperCase(),
    roles,
    status: 'active',
    onboarding: { completedSteps: [], skippedSteps: [] },
    identityHistory: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

export const people = {
  pm: user('pm1', ['pm']),
  pm2: user('pm2', ['pm']),
  tech: user('tech1', ['tech']),
  tech2: user('tech2', ['tech']),
  fde: user('fde1', ['fde']),
  sales: user('sales1', ['sales_poc']),
  csm: user('csm1', ['csm']),
  head: user('head1', ['delivery_head']),
  admin: user('admin1', ['admin']),
  outsider: user('out1', ['tech']),
};
export const directory = Object.values(people);
export const findUser = (id: string) => directory.find((u) => u.id === id);

export function config(overrides: Partial<OrgConfig> = {}): OrgConfig {
  return { ...defaultOrgConfig(), ...overrides };
}

// 2026-10-19 is a Monday.
export function ctx(actor: DirectoryUser, today = '2026-10-19', cfg = config()): DomainContext {
  return { actor, today, now: `${today}T10:00:00.000Z`, config: cfg };
}

export function newProject(templateId = 'standard_bot', c = ctx(people.pm)) {
  return createProject(
    {
      clientName: 'Acme Bank',
      name: 'Support Bot',
      category: 'Chatbot',
      pmId: people.pm.id,
      techIds: [people.tech.id],
      fdeId: people.fde.id,
      salesPocId: people.sales.id,
      csmId: people.csm.id,
      deliveryHeadId: people.head.id,
      startDate: '2026-10-05',
      targetGoLive: '2026-12-18',
      languages: ['English', 'Hindi'],
      integrations: ['CRM'],
      qaUatWorkflow: 'Internal QA then client UAT',
      templateId,
      destinationId: 'default',
    },
    c,
    { findUser },
  );
}

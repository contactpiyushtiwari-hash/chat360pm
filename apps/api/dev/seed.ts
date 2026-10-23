import {
  addDays,
  confirmTask,
  createProject,
  defaultOrgConfig,
  indexEntryOf,
  onboardingStepsFor,
  todayIn,
  type DirectoryUser,
  type GlobalRole,
} from '@chat360/core';
import type { Deps } from '../src/deps';
import { PATHS } from '../src/store/repos';
import { hashPassword } from '../src/auth/crypto';

export const DEMO_PASSWORD = 'demo-password';

/** Fictional demo people. No real employee names or addresses are used anywhere in the code. */
export const DEMO_USERS: [string, string, GlobalRole[]][] = [
  ['demo-admin', 'Avery Admin (demo)', ['admin']],
  ['demo-head', 'Devi Head (demo)', ['delivery_head']],
  ['demo-pm1', 'Priya PM (demo)', ['pm']],
  ['demo-pm2', 'Pavan PM (demo)', ['pm']],
  ['demo-tech1', 'Tara Tech (demo)', ['tech']],
  ['demo-tech2', 'Tomas Tech (demo)', ['tech']],
  ['demo-fde', 'Farah FDE (demo)', ['fde']],
  ['demo-sales', 'Sam Sales (demo)', ['sales_poc']],
  ['demo-csm', 'Chen CSM (demo)', ['csm']],
  ['demo-new', 'Nia Newhire (demo)', []],
];

export async function seedDemo(deps: Deps) {
  const now = deps.clock().toISOString();
  const config = defaultOrgConfig();
  const today = todayIn(config.timezone, deps.clock());
  const users: DirectoryUser[] = DEMO_USERS.map(([id, name, roles]) => {
    const user: DirectoryUser = {
      id,
      tenantId: 'demo-tenant',
      email: `${id}@chat.io`,
      displayName: name,
      roles,
      status: 'active',
      onboarding: { completedSteps: [], skippedSteps: [] },
      identityHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    // Demo users (except the new hire) have already finished onboarding.
    if (id !== 'demo-new') {
      const steps = onboardingStepsFor(user);
      user.onboarding.completedSteps = steps.filter((s) => !s.verifiedBySystem).map((s) => s.id);
      user.onboarding.completedAt = now;
    }
    return user;
  });
  await deps.repos.store.putJson(
    PATHS.directory,
    { schemaVersion: 1, users },
    { ifNoneMatch: '*' },
  );
  await deps.repos.store.putJson(
    PATHS.config,
    {
      ...config,
      supportContact: 'Raise a request here; the platform administrators triage it daily.',
    },
    { ifNoneMatch: '*' },
  );
  const find = (id: string) => users.find((u) => u.id === id);
  const pm = find('demo-pm1')!;
  const ctx = { actor: pm, now, today, config };

  const p1 = createProject(
    {
      clientName: 'Northwind Retail',
      name: 'WhatsApp Order Bot',
      category: 'WhatsApp Commerce',
      pmId: 'demo-pm1',
      techIds: ['demo-tech1', 'demo-tech2'],
      fdeId: 'demo-fde',
      salesPocId: 'demo-sales',
      csmId: 'demo-csm',
      deliveryHeadId: 'demo-head',
      startDate: addDays(today, -21),
      targetGoLive: addDays(today, 35),
      languages: ['English', 'Hindi'],
      integrations: ['Order API', 'Payments'],
      qaUatWorkflow: 'Internal QA, then client UAT with sign-off',
      templateId: 'standard_bot',
      destinationId: 'default',
    },
    ctx,
    { findUser: find },
  );
  // Make the demo realistic: some work done, one task due today for the tech owner.
  for (const t of p1.tasks.filter((t) => t.plannedEnd < today).slice(0, 3)) {
    try {
      confirmTask(
        p1,
        t.id,
        { outcome: 'completed', notes: 'Completed (demo data)' },
        { ...ctx, actor: find(t.ownerId ?? 'demo-pm1') ?? pm },
      );
    } catch {
      /* not due or not owned: leave as is */
    }
  }
  const dueToday = p1.tasks.find((t) => t.ownerId === 'demo-tech1' && t.status !== 'completed');
  if (dueToday) {
    dueToday.plannedStart = addDays(today, -5);
    dueToday.plannedEnd = today;
  }
  p1.apis.push({
    id: 'API-001',
    name: 'Order status API',
    purpose: 'Look up order status',
    ownerId: 'demo-tech1',
    readiness: 'in_progress',
    testing: 'not_tested',
    blocker: 'Awaiting sandbox credentials from client',
    dependency: 'Client IT',
    nextAction: 'Follow up with client IT',
    targetDate: addDays(today, 3),
    technicalReference: 'See SOW appendix B',
    updatedAt: now,
    updatedBy: 'demo-tech1',
  });
  p1.counters.api = 1;
  // Fictional figures for the demo Finance tab.
  p1.finance = {
    currency: 'INR',
    raisedOverdueForGoLive: 350000,
    raisableImmediately: 150000,
    toBeRaised: 600000,
    remarks: 'Demo: milestone 2 invoice awaiting client PO',
    updatedAt: now,
    updatedBy: 'demo-sales',
  };

  const p2 = createProject(
    {
      clientName: 'Contoso Insurance',
      name: 'Claims Voicebot',
      category: 'Voicebot',
      pmId: 'demo-pm2',
      techIds: ['demo-tech2'],
      fdeId: 'demo-fde',
      salesPocId: 'demo-sales',
      csmId: 'demo-csm',
      deliveryHeadId: 'demo-head',
      startDate: addDays(today, -60),
      targetGoLive: addDays(today, 10),
      languages: ['English'],
      integrations: ['Claims CRM'],
      qaUatWorkflow: 'Client UAT',
      templateId: 'integration_only',
      destinationId: 'default',
    },
    { ...ctx, actor: find('demo-pm2')! },
    { findUser: find },
  );

  for (const p of [p1, p2]) {
    await deps.repos.createProject(p);
    await deps.repos.upsertIndexEntry(indexEntryOf(p, today));
  }
  // Every demo user can also sign in with a password. Low iteration count: dev/test data only.
  const hash = await hashPassword(DEMO_PASSWORD, 1000);
  await deps.repos.updateCredentials((cr) => {
    for (const u of users) cr.passwords[u.id] = { ...hash, updatedAt: now };
  });
  return { users, projects: [p1.id, p2.id] };
}

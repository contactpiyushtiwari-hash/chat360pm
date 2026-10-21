/**
 * Writes a sample tracker for manual inspection / external validation:
 *   pnpm validate:workbook
 * Uses fictional fixture data only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  confirmTask,
  createProject,
  defaultOrgConfig,
  updateFinance,
  type DirectoryUser,
} from '../src';
import { generateTracker } from '../src/workbook';

const mk = (id: string, roles: DirectoryUser['roles']): DirectoryUser => ({
  id,
  tenantId: 't',
  email: `${id}@example.test`,
  displayName: `Sample ${id}`,
  roles,
  status: 'active',
  onboarding: { completedSteps: [], skippedSteps: [] },
  identityHistory: [],
  createdAt: '',
  updatedAt: '',
});
const users = [
  mk('pm', ['pm']),
  mk('tech', ['tech']),
  mk('fde', ['fde']),
  mk('csm', ['csm']),
  mk('head', ['delivery_head']),
];
const config = defaultOrgConfig();
const ctx = { actor: users[0]!, today: '2026-10-19', now: '2026-10-19T10:00:00.000Z', config };
const project = createProject(
  {
    clientName: 'Sample Client',
    name: 'Sample Bot <&> "quotes"',
    category: 'Chatbot',
    pmId: 'pm',
    techIds: ['tech'],
    fdeId: 'fde',
    salesPocId: null,
    csmId: 'csm',
    deliveryHeadId: 'head',
    startDate: '2026-10-05',
    targetGoLive: '2026-12-18',
    languages: ['English'],
    integrations: ['CRM'],
    qaUatWorkflow: '',
    templateId: 'standard_bot',
    destinationId: 'default',
  },
  ctx,
  { findUser: (id) => users.find((u) => u.id === id) },
);
const due = project.tasks.find((t) => t.plannedEnd <= ctx.today && t.ownerId === 'pm');
if (due) {
  confirmTask(
    project,
    due.id,
    {
      outcome: 'not_completed',
      reasonCategory: 'client_dependency',
      reason: 'Awaiting client',
      impact: 'Delay',
      nextAction: 'Follow up',
      revisedEta: '2026-10-22',
    },
    ctx,
  );
}
updateFinance(
  project,
  {
    currency: 'INR',
    raisedOverdueForGoLive: 350000,
    raisableImmediately: 150000.5,
    toBeRaised: 600000,
    remarks: 'Sample figures',
  },
  ctx,
);
const out = resolve(process.argv[2] ?? 'sample-tracker.xlsx');
mkdirSync(dirname(out), { recursive: true });
const nameOf = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? '';
writeFileSync(
  out,
  generateTracker(project, { config, today: ctx.today, nameOf, generatedAt: ctx.now }),
);
console.info(`Wrote ${out}`);

import type { DirectoryUser, GlobalRole } from './types';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Required steps must be completed (not skipped) before onboarding is complete. */
  required: boolean;
  /** Steps the system verifies itself; the user cannot tick them manually. */
  verifiedBySystem: boolean;
  /** In-app route that demonstrates the feature. */
  route?: string;
}

const COMMON: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'What this platform does',
    description:
      'Projects, tasks, daily confirmations, escalations and transfers live here. Each project tracker can be downloaded as an Excel file at any time.',
    required: true,
    verifiedBySystem: false,
  },
  {
    id: 'role_assigned',
    title: 'Role assigned by an administrator',
    description:
      'Your access depends on the roles an administrator assigns. Until then you can only see tasks assigned to you.',
    required: true,
    verifiedBySystem: true,
  },
];

const BY_ROLE: Partial<Record<GlobalRole, OnboardingStep[]>> = {
  pm: [
    {
      id: 'pm_create_project',
      title: 'Create a project',
      description:
        'The wizard sets up the project plan from a template; its Excel tracker can be downloaded any time.',
      required: false,
      verifiedBySystem: false,
      route: '/projects/new',
    },
    {
      id: 'pm_daily',
      title: 'Daily confirmations',
      description:
        'Every task due today needs Completed or Not completed. Missing answers are escalated at the end of the day.',
      required: true,
      verifiedBySystem: false,
      route: '/today',
    },
    {
      id: 'pm_transfer',
      title: 'Requesting a transfer',
      description:
        'Use Request Project Transfer on a project. The Delivery Head reviews it; history is preserved.',
      required: false,
      verifiedBySystem: false,
    },
  ],
  tech: [
    {
      id: 'tech_today',
      title: 'Your tasks today',
      description: 'Confirm each due task and report blockers with a revised ETA.',
      required: true,
      verifiedBySystem: false,
      route: '/today',
    },
    {
      id: 'tech_apis',
      title: 'API dependencies',
      description: 'Track API readiness and testing. Never paste credentials into the platform.',
      required: false,
      verifiedBySystem: false,
    },
  ],
  fde: [
    {
      id: 'fde_today',
      title: 'Your tasks today',
      description: 'Bot-building tasks, flows and milestones you own appear here.',
      required: true,
      verifiedBySystem: false,
      route: '/today',
    },
  ],
  sales_poc: [
    {
      id: 'sales_scope',
      title: 'Scope and commitments',
      description:
        'Projects you are assigned to show scope, client commitments and delivery status.',
      required: false,
      verifiedBySystem: false,
      route: '/projects',
    },
  ],
  csm: [
    {
      id: 'csm_uat',
      title: 'UAT and client follow-ups',
      description:
        'Track UAT tasks, client dependencies and follow-up emails from the project page.',
      required: false,
      verifiedBySystem: false,
      route: '/projects',
    },
  ],
  delivery_head: [
    {
      id: 'head_portfolio',
      title: 'Portfolio analytics',
      description: 'See health, overdue work, risks and workload across all projects.',
      required: true,
      verifiedBySystem: false,
      route: '/analytics',
    },
    {
      id: 'head_transfers',
      title: 'Reviewing transfers',
      description: 'Approve or reject PM transfer requests, or reassign a PM directly.',
      required: true,
      verifiedBySystem: false,
      route: '/transfers',
    },
  ],
  admin: [
    {
      id: 'admin_users',
      title: 'Assign roles',
      description: 'Assign roles to employees. Admin does not grant project data access.',
      required: true,
      verifiedBySystem: false,
      route: '/admin',
    },
    {
      id: 'admin_config',
      title: 'Configure working days, holidays and escalation SLAs',
      description: 'These drive deadlines, ageing and escalations.',
      required: true,
      verifiedBySystem: false,
      route: '/admin',
    },
  ],
};

export function onboardingStepsFor(user: DirectoryUser): OnboardingStep[] {
  const steps = [...COMMON];
  for (const role of user.roles) steps.push(...(BY_ROLE[role] ?? []));
  return steps;
}

export interface OnboardingStatus {
  steps: (OnboardingStep & { state: 'done' | 'skipped' | 'pending' })[];
  complete: boolean;
  missingRequired: string[];
}

export function onboardingStatus(user: DirectoryUser): OnboardingStatus {
  const systemDone: Record<string, boolean> = { role_assigned: user.roles.length > 0 };
  const steps = onboardingStepsFor(user).map((s) => {
    const done = s.verifiedBySystem
      ? !!systemDone[s.id]
      : user.onboarding.completedSteps.includes(s.id);
    const skipped = !done && !s.required && user.onboarding.skippedSteps.includes(s.id);
    return {
      ...s,
      state: done ? ('done' as const) : skipped ? ('skipped' as const) : ('pending' as const),
    };
  });
  const missingRequired = steps.filter((s) => s.required && s.state !== 'done').map((s) => s.id);
  return { steps, complete: missingRequired.length === 0, missingRequired };
}

/** Applies user-reported progress; system-verified and required steps cannot be skipped. */
export function applyOnboardingUpdate(
  user: DirectoryUser,
  complete: string[],
  skip: string[],
  now: string,
) {
  const steps = onboardingStepsFor(user);
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const id of complete) {
    const s = byId.get(id);
    if (s && !s.verifiedBySystem && !user.onboarding.completedSteps.includes(id)) {
      user.onboarding.completedSteps.push(id);
    }
  }
  for (const id of skip) {
    const s = byId.get(id);
    if (s && !s.required && !user.onboarding.skippedSteps.includes(id))
      user.onboarding.skippedSteps.push(id);
  }
  const status = onboardingStatus(user);
  if (status.complete) user.onboarding.completedAt ??= now;
  else delete user.onboarding.completedAt;
  return status;
}

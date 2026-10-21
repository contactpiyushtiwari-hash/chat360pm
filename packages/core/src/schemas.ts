import { z } from 'zod';
import { isIsoDate } from './dates';
import {
  GLOBAL_ROLES,
  PRIORITIES,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  TASK_STATUSES,
} from './types';
import { API_READINESS, API_TESTING } from './types';

/** Input validation schemas shared by the API (enforcement) and the web app (form hints). */

export const isoDate = z.string().refine(isIsoDate, 'Must be a valid date (YYYY-MM-DD)');
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, label = 'This field') =>
  z.string().trim().min(1, `${label} is required`).max(max);
const userId = z.string().trim().min(1).max(64);
/** Only http(s) links are accepted, to prevent `javascript:` style injection. */
export const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Must be an http(s) link');

export const createProjectSchema = z
  .object({
    clientName: requiredText(120, 'Client name'),
    name: requiredText(120, 'Project name'),
    category: requiredText(60, 'Category'),
    pmId: userId,
    techIds: z.array(userId).max(20).default([]),
    fdeId: userId.nullable().default(null),
    salesPocId: userId.nullable().default(null),
    csmId: userId.nullable().default(null),
    deliveryHeadId: userId.nullable().default(null),
    startDate: isoDate,
    targetGoLive: isoDate,
    languages: z.array(requiredText(40)).max(20).default([]),
    integrations: z.array(requiredText(80)).max(40).default([]),
    qaUatWorkflow: text(500).default(''),
    templateId: requiredText(40, 'Template'),
    destinationId: requiredText(40, 'Destination'),
  })
  .refine((v) => v.targetGoLive >= v.startDate, {
    message: 'Target go-live must be on or after the start date',
    path: ['targetGoLive'],
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    clientName: requiredText(120),
    name: requiredText(120),
    category: requiredText(60),
    status: z.enum(['active', 'on_hold', 'completed', 'cancelled']),
    targetGoLive: isoDate,
    languages: z.array(requiredText(40)).max(20),
    integrations: z.array(requiredText(80)).max(40),
    qaUatWorkflow: text(500),
    documents: z
      .array(
        z.object({
          label: requiredText(120),
          url: safeUrl,
          kind: z.enum(['sow', 'brd', 'bot_flow', 'tracker', 'other']),
        }),
      )
      .max(50),
    reason: text(500),
  })
  .partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** PM changes are deliberately excluded: they go through the transfer workflow. */
export const updateTeamSchema = z.object({
  techIds: z.array(userId).max(20).optional(),
  fdeId: userId.nullable().optional(),
  salesPocId: userId.nullable().optional(),
  csmId: userId.nullable().optional(),
  deliveryHeadId: userId.nullable().optional(),
  reason: requiredText(500, 'Reason'),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const createTaskSchema = z
  .object({
    title: requiredText(200, 'Title'),
    phase: requiredText(80, 'Phase'),
    description: text(4000).default(''),
    ownerId: userId.nullable().default(null),
    priority: z.enum(PRIORITIES).default('medium'),
    plannedStart: isoDate,
    plannedEnd: isoDate,
    isMilestone: z.boolean().default(false),
    clientCommitment: z.boolean().default(false),
    dependencies: z.array(z.string().max(20)).max(50).default([]),
    parentId: z.string().max(20).nullable().default(null),
    wbsId: text(20).optional(),
  })
  .refine((v) => v.plannedEnd >= v.plannedStart, {
    message: 'Planned end must be on or after planned start',
    path: ['plannedEnd'],
  });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: requiredText(200),
    phase: requiredText(80),
    description: text(4000),
    ownerId: userId.nullable(),
    ownerChangeReason: text(500),
    priority: z.enum(PRIORITIES),
    plannedStart: isoDate,
    revisedEnd: isoDate,
    revisionReason: text(500),
    status: z.enum(TASK_STATUSES),
    statusReason: text(500),
    closureNotes: text(2000),
    evidenceUrl: safeUrl,
    actualStart: isoDate,
    dependencies: z.array(z.string().max(20)).max(50),
    blocker: text(1000),
    progress: z.number().int().min(0).max(100),
    remarks: text(2000),
    nextAction: text(500),
    isMilestone: z.boolean(),
    clientCommitment: z.boolean(),
    /** Optimistic concurrency: the task's `updatedAt` the client last saw. */
    expectedUpdatedAt: z.string().max(40),
  })
  .partial()
  .strict();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const confirmTaskSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('completed'),
    notes: requiredText(2000, 'Closure notes'),
    evidenceUrl: safeUrl.optional(),
  }),
  z.object({
    outcome: z.literal('not_completed'),
    reasonCategory: requiredText(40, 'Reason category'),
    reason: requiredText(1000, 'Reason'),
    impact: text(1000).default(''),
    nextAction: requiredText(500, 'Next action'),
    revisedEta: isoDate,
  }),
]);
export type ConfirmTaskInput = z.infer<typeof confirmTaskSchema>;

export const commentSchema = z.object({
  body: requiredText(4000, 'Comment'),
  evidenceUrl: safeUrl.optional(),
});

export const apiDependencySchema = z.object({
  name: requiredText(120, 'API name'),
  purpose: text(500).default(''),
  ownerId: userId.nullable().default(null),
  readiness: z.enum(API_READINESS).default('not_started'),
  testing: z.enum(API_TESTING).default('not_tested'),
  blocker: text(1000).default(''),
  dependency: text(500).default(''),
  nextAction: text(500).default(''),
  targetDate: isoDate.nullable().default(null),
  technicalReference: text(1000).default(''),
});
export const updateApiDependencySchema = apiDependencySchema.partial();

export const escalationActionSchema = z.object({ notes: text(2000).default('') });
export const resolveEscalationSchema = z.object({ notes: requiredText(2000, 'Resolution notes') });

export const transferDraftSchema = z.object({
  proposedPmId: userId.nullable().default(null),
  reason: requiredText(2000, 'Reason'),
  requestedEffectiveDate: isoDate,
  handoverNotes: text(8000).default(''),
  submit: z.boolean().default(true),
});
export type TransferDraftInput = z.infer<typeof transferDraftSchema>;

export const transferDecisionSchema = z.object({
  newPmId: userId.optional(),
  notes: text(2000).default(''),
});
export const transferRejectSchema = z.object({ reason: requiredText(2000, 'Rejection reason') });

export const reassignPmSchema = z.object({
  newPmId: userId,
  reason: requiredText(2000, 'Reason'),
  effectiveDate: isoDate,
  handoverNotes: text(8000).default(''),
  /** Must be true: the UI shows the full handover summary before this is sent. */
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirmation is required' }) }),
});

export const supportCreateSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: requiredText(200, 'Subject'),
  description: requiredText(8000, 'Description'),
  projectId: z.string().max(20).nullable().default(null),
  priority: z.enum(PRIORITIES).default('medium'),
});
export const supportUpdateSchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  assigneeId: userId.nullable().optional(),
  resolutionNotes: text(4000).optional(),
  note: text(2000).optional(),
});

export const deactivationRequestSchema = z.object({
  reason: text(2000).default(''),
  /** User must type their own email address to confirm. */
  confirmEmail: requiredText(320, 'Email confirmation'),
  acknowledgeConsequences: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge the consequences' }),
  }),
});

export const adminUserUpdateSchema = z.object({
  roles: z.array(z.enum(GLOBAL_ROLES)).max(GLOBAL_ROLES.length).optional(),
  status: z.enum(['active', 'deactivated']).optional(),
});

export const onboardingUpdateSchema = z.object({
  completeSteps: z.array(z.string().max(60)).max(30).default([]),
  skipSteps: z.array(z.string().max(60)).max(30).default([]),
});

export const orgConfigSchema = z.object({
  timezone: z.string().min(1).max(64),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  holidays: z.array(isoDate).max(366),
  delayReasons: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{1,40}$/),
        label: requiredText(80),
        side: z.enum(['client', 'internal']),
      }),
    )
    .min(1)
    .max(30),
  projectCategories: z.array(requiredText(60)).min(1).max(30),
  escalation: z.object({
    onNotCompleted: z.boolean(),
    onNoResponse: z.boolean(),
    levels: z
      .array(
        z.object({
          level: z.number().int().min(1).max(6),
          role: z.enum(['pm', 'tech', 'fde', 'sales_poc', 'csm', 'delivery_head']),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          condition: requiredText(300),
          slaHours: z
            .number()
            .int()
            .min(1)
            .max(24 * 30),
        }),
      )
      .min(1)
      .max(6),
  }),
  formerPmAccessDays: z.number().int().min(0).max(365),
  destinations: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
        label: requiredText(80),
        path: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((p) => !p.split('/').some((seg) => seg === '..' || seg === '.'), 'Invalid path'),
      }),
    )
    .min(1)
    .max(20),
  supportContact: text(300),
  disabledJobs: z
    .array(z.enum(['daily_confirmation', 'morning_reminders', 'maintenance', 'reconcile']))
    .max(10)
    .default([]),
});

export const emailPreviewSchema = z.object({
  projectId: z.string().max(20).nullable().default(null),
  templateId: z.string().max(40).nullable().default(null),
  to: z.array(z.string().trim().email().max(320)).min(1).max(50),
  cc: z.array(z.string().trim().email().max(320)).max(50).default([]),
  subject: requiredText(255, 'Subject'),
  body: requiredText(20000, 'Body'),
  includeWorkbookLink: z.boolean().default(false),
});
export type EmailPreviewInput = z.infer<typeof emailPreviewSchema>;

export const emailSendSchema = emailPreviewSchema.and(
  z.object({
    previewToken: z.string().min(10).max(200),
    confirmExternal: z.boolean().default(false),
  }),
);

export const meetingSchema = z
  .object({
    projectId: z.string().max(20).nullable().default(null),
    subject: requiredText(255, 'Subject'),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Start must be YYYY-MM-DDTHH:mm'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'End must be YYYY-MM-DDTHH:mm'),
    timeZone: z.string().min(1).max(64),
    attendees: z.array(z.string().trim().email().max(320)).max(100).default([]),
    agenda: text(8000).default(''),
    location: text(255).default(''),
    online: z.boolean().default(false),
    confirmExternal: z.boolean().default(false),
  })
  .refine((v) => v.end > v.start, { message: 'End must be after start', path: ['end'] });
export type MeetingInput = z.infer<typeof meetingSchema>;

export const clientErrorSchema = z.object({
  message: z.string().max(1000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(300).optional(),
  kind: z.enum(['error', 'unhandledrejection', 'boundary']),
  release: z.string().max(60).optional(),
});

export const PRODUCT_EVENTS = [
  'onboarding_step_viewed',
  'tour_skipped',
  'view_kanban',
  'view_gantt',
  'view_list',
  'workbook_opened',
  'email_preview_opened',
  'support_page_viewed',
] as const;
export const productEventSchema = z.object({
  name: z.enum(PRODUCT_EVENTS),
  props: z.record(z.union([z.string().max(100), z.number(), z.boolean()])).default({}),
});

const money = z
  .number()
  .finite()
  .min(0, 'Amount cannot be negative')
  .max(1e12, 'Amount is too large')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places');

export const updateFinanceSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. INR'),
    raisedOverdueForGoLive: money,
    raisableImmediately: money,
    toBeRaised: money,
    remarks: text(1000).default(''),
    /** Optimistic concurrency: the finance `updatedAt` the client last saw. */
    expectedUpdatedAt: z.string().max(40).nullable().optional(),
  })
  .strict();
export type UpdateFinanceInput = z.infer<typeof updateFinanceSchema>;

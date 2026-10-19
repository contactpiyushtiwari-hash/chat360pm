/**
 * Domain model for the Chat360 Project Operations Platform.
 *
 * All dates are ISO calendar dates (`YYYY-MM-DD`) interpreted in the organisation timezone.
 * All timestamps are ISO-8601 UTC instants. Identifiers are stable and never reused.
 */

export type IsoDate = string;
export type IsoInstant = string;

/** Entra ID object id (`oid` claim). Stable across email / display-name changes. */
export type UserId = string;

/**
 * Global roles describe what a person does at Chat360 and what they are eligible for.
 * Privileges that cross project boundaries come only from `admin` and `delivery_head`.
 */
export const GLOBAL_ROLES = [
  'admin',
  'delivery_head',
  'pm',
  'tech',
  'fde',
  'sales_poc',
  'csm',
] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  admin: 'Administrator',
  delivery_head: 'Delivery and Operations Head',
  pm: 'Project Manager',
  tech: 'Tech Team',
  fde: 'FDE (Bot Builder)',
  sales_poc: 'Sales POC',
  csm: 'Customer Success Manager',
};

/** Roles a person can hold on a specific project. */
export const PROJECT_ROLES = ['pm', 'tech', 'fde', 'sales_poc', 'csm', 'delivery_head'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  pm: 'Project Manager',
  tech: 'Tech Team',
  fde: 'FDE',
  sales_poc: 'Sales POC',
  csm: 'Customer Success Manager',
  delivery_head: 'Delivery and Operations Head',
};

export type UserStatus = 'active' | 'deactivation_requested' | 'deactivated';

export interface OnboardingState {
  completedSteps: string[];
  skippedSteps: string[];
  completedAt?: IsoInstant;
}

export interface DirectoryUser {
  id: UserId;
  tenantId: string;
  email: string;
  displayName: string;
  roles: GlobalRole[];
  status: UserStatus;
  onboarding: OnboardingState;
  /** Previous email addresses / names, so audit history stays readable after changes. */
  identityHistory: { at: IsoInstant; email: string; displayName: string }[];
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface Directory {
  schemaVersion: 1;
  users: DirectoryUser[];
}

export interface ProjectTeam {
  pm: UserId;
  tech: UserId[];
  fde: UserId | null;
  salesPoc: UserId | null;
  csm: UserId | null;
  deliveryHead: UserId | null;
}

export interface FormerPmAccess {
  userId: UserId;
  /** Read-only access granted until this date (inclusive). */
  until: IsoDate;
}

export interface TeamChange {
  id: string;
  at: IsoInstant;
  by: UserId;
  role: ProjectRole;
  from: UserId[];
  to: UserId[];
  reason: string;
  transferId?: string;
}

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export interface DateRevision {
  from: IsoDate;
  to: IsoDate;
  reason: string;
  by: UserId;
  at: IsoInstant;
}

export type ConfirmationOutcome = 'completed' | 'not_completed' | 'no_response';

export interface TaskConfirmation {
  /** The working date the confirmation is for. One confirmation per task per date. */
  date: IsoDate;
  outcome: ConfirmationOutcome;
  by: UserId | 'system';
  at: IsoInstant;
  notes?: string;
  evidenceUrl?: string;
  reasonCategory?: string;
  reason?: string;
  impact?: string;
  nextAction?: string;
  revisedEta?: IsoDate;
}

export interface TaskComment {
  id: string;
  at: IsoInstant;
  by: UserId;
  body: string;
  evidenceUrl?: string;
}

export interface TaskHistoryEntry {
  at: IsoInstant;
  by: UserId | 'system';
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface Task {
  /** Stable per-project identifier, e.g. `T-0007`. Never reused. */
  id: string;
  wbsId: string;
  parentId: string | null;
  phase: string;
  title: string;
  description: string;
  ownerId: UserId | null;
  priority: Priority;
  status: TaskStatus;
  isMilestone: boolean;
  /** Commitment visible to the client (used in handover summaries). */
  clientCommitment: boolean;
  plannedStart: IsoDate;
  /** Original deadline. Immutable once the task exists. */
  plannedEnd: IsoDate;
  revisedEnd: IsoDate | null;
  revisions: DateRevision[];
  actualStart: IsoDate | null;
  actualEnd: IsoDate | null;
  dependencies: string[];
  blocker: string;
  progress: number;
  remarks: string;
  nextAction: string;
  confirmations: TaskConfirmation[];
  comments: TaskComment[];
  history: TaskHistoryEntry[];
  createdAt: IsoInstant;
  createdBy: UserId | 'system';
  updatedAt: IsoInstant;
}

export const API_READINESS = ['not_started', 'in_progress', 'ready', 'blocked'] as const;
export type ApiReadiness = (typeof API_READINESS)[number];
export const API_TESTING = ['not_tested', 'in_testing', 'passed', 'failed'] as const;
export type ApiTesting = (typeof API_TESTING)[number];

export interface ApiDependency {
  id: string;
  name: string;
  purpose: string;
  ownerId: UserId | null;
  readiness: ApiReadiness;
  testing: ApiTesting;
  blocker: string;
  dependency: string;
  nextAction: string;
  targetDate: IsoDate | null;
  /** Documentation link or reference. Never a secret. */
  technicalReference: string;
  updatedAt: IsoInstant;
  updatedBy: UserId;
}

export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'not_configured'
  | 'skipped';

export interface NotificationRecord {
  id: string;
  kind: string;
  recipientIds: UserId[];
  status: NotificationStatus;
  attempts: number;
  lastAttemptAt?: IsoInstant;
  lastError?: string;
  sentAt?: IsoInstant;
}

export type EscalationType = 'not_completed' | 'no_response' | 'manual' | 'sla_breach';
export type EscalationStatus = 'open' | 'acknowledged' | 'resolved';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Escalation {
  id: string;
  /** Deterministic key preventing duplicate escalations for the same trigger. */
  dedupeKey: string;
  type: EscalationType;
  taskId: string;
  ownerId: UserId | null;
  level: number;
  severity: Severity;
  originalDue: IsoDate;
  reasonCategory: string;
  reason: string;
  impact: string;
  nextAction: string;
  revisedEta: IsoDate | null;
  managerRole: ProjectRole;
  managerId: UserId | null;
  triggeredAt: IsoInstant;
  triggeredBy: UserId | 'system';
  status: EscalationStatus;
  acknowledgedAt?: IsoInstant;
  acknowledgedBy?: UserId;
  resolvedAt?: IsoInstant;
  resolvedBy?: UserId;
  resolutionNotes?: string;
  /** When the current level started; SLA for the level is measured from here. */
  levelSince: IsoInstant;
  levelHistory: {
    level: number;
    at: IsoInstant;
    managerId: UserId | null;
    by: UserId | 'system';
  }[];
  /** One notification per level reached; never removed. */
  notifications: NotificationRecord[];
}

export const TRANSFER_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export type TransferStepName = 'assign_pm' | 'update_index' | 'sync_workbook' | 'notify';
export type TransferStepStatus = 'pending' | 'done' | 'failed' | 'skipped';

export interface TransferStep {
  name: TransferStepName;
  required: boolean;
  status: TransferStepStatus;
  attempts: number;
  at?: IsoInstant;
  error?: string;
}

export interface HandoverSummary {
  generatedAt: IsoInstant;
  health: ProjectHealth;
  healthReasons: string[];
  openTasks: {
    id: string;
    title: string;
    ownerId: UserId | null;
    due: IsoDate;
    status: TaskStatus;
  }[];
  upcomingDeadlines: { id: string; title: string; due: IsoDate }[];
  pendingApis: { id: string; name: string; readiness: ApiReadiness; targetDate: IsoDate | null }[];
  uatIssues: { id: string; title: string; status: TaskStatus; due: IsoDate }[];
  clientCommitments: { id: string; title: string; due: IsoDate; status: TaskStatus }[];
  openEscalations: { id: string; taskId: string; severity: Severity; reason: string }[];
  documents: { label: string; url: string }[];
  blockers: { id: string; title: string; blocker: string }[];
}

export interface TransferRequest {
  /** Globally unique, stable transfer id, e.g. `TR-8H2K4M9Q`. */
  id: string;
  kind: 'pm_request' | 'direct_reassignment';
  status: TransferStatus;
  fromPmId: UserId;
  proposedPmId: UserId | null;
  /** Set when approved; may differ from the proposal. */
  newPmId: UserId | null;
  reason: string;
  requestedEffectiveDate: IsoDate;
  handoverNotes: string;
  snapshot: HandoverSummary;
  requestedBy: UserId;
  createdAt: IsoInstant;
  submittedAt?: IsoInstant;
  reviewStartedAt?: IsoInstant;
  reviewedBy?: UserId;
  decidedAt?: IsoInstant;
  decisionNotes?: string;
  rejectionReason?: string;
  executedBy?: UserId;
  completedAt?: IsoInstant;
  cancelledAt?: IsoInstant;
  execution: { steps: TransferStep[]; lastError?: string };
  notifications: NotificationRecord[];
  history: {
    at: IsoInstant;
    by: UserId | 'system';
    from: TransferStatus | null;
    to: TransferStatus;
    note?: string;
  }[];
}

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'cancelled';
export type ProjectHealth = 'green' | 'amber' | 'red';

export type SyncState = 'not_created' | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface SyncConflict {
  key: string;
  table: string;
  rowKey: string;
  detectedAt: IsoInstant;
  excelValues: Record<string, unknown>;
  appValues: Record<string, unknown>;
}

export interface WorkbookState {
  driveItemId: string | null;
  webUrl: string | null;
  fileName: string;
  state: SyncState;
  /** Project revision last written to Excel. */
  syncedRevision: number;
  lastSyncedAt: IsoInstant | null;
  lastAttemptAt: IsoInstant | null;
  lastError: string | null;
  attempts: number;
  /** Hash of the managed values the app last wrote for each row (`table:rowKey`). */
  rowHashes: Record<string, string>;
  conflicts: SyncConflict[];
}

export interface CommunicationRef {
  id: string;
  kind: 'email' | 'meeting';
  at: IsoInstant;
  by: UserId;
  subject: string;
  /** Recipient addresses (no body is retained). */
  recipients: string[];
  status: 'sent' | 'failed' | 'created' | 'updated' | 'cancelled';
  externalId?: string;
  error?: string;
}

export interface AuditEntry {
  id: string;
  at: IsoInstant;
  actor: UserId | 'system';
  action: string;
  target: string;
  details?: Record<string, unknown>;
}

export interface ProjectDocument {
  label: string;
  url: string;
  kind: 'sow' | 'brd' | 'bot_flow' | 'tracker' | 'other';
}

export interface Project {
  schemaVersion: 1;
  id: string;
  revision: number;
  clientName: string;
  name: string;
  category: string;
  status: ProjectStatus;
  startDate: IsoDate;
  targetGoLive: IsoDate;
  languages: string[];
  integrations: string[];
  qaUatWorkflow: string;
  templateId: string;
  destinationId: string;
  folderPath: string;
  team: ProjectTeam;
  formerPms: FormerPmAccess[];
  teamHistory: TeamChange[];
  counters: { task: number; api: number; escalation: number; comment: number; comm: number };
  tasks: Task[];
  apis: ApiDependency[];
  escalations: Escalation[];
  transfers: TransferRequest[];
  documents: ProjectDocument[];
  communications: CommunicationRef[];
  workbook: WorkbookState;
  audit: AuditEntry[];
  /** Idempotency keys already applied to this document, bounded FIFO. */
  appliedOperations: string[];
  createdAt: IsoInstant;
  createdBy: UserId;
  updatedAt: IsoInstant;
}

export interface ProjectSummary {
  openTasks: number;
  overdueTasks: number;
  dueThisWeek: number;
  completedTasks: number;
  totalTasks: number;
  openEscalations: number;
  pendingApis: number;
  health: ProjectHealth;
  healthReasons: string[];
  computedFor: IsoDate;
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
  clientName: string;
  category: string;
  status: ProjectStatus;
  pmId: UserId;
  memberIds: UserId[];
  taskOwnerIds: UserId[];
  formerPms: FormerPmAccess[];
  deliveryHeadId: UserId | null;
  folderPath: string;
  workbookUrl: string | null;
  workbookState: SyncState;
  startDate: IsoDate;
  targetGoLive: IsoDate;
  summary: ProjectSummary;
  /** Small summaries so portfolio lists do not need to read every project document. */
  transfers: {
    id: string;
    kind: TransferRequest['kind'];
    status: TransferStatus;
    fromPmId: UserId;
    proposedPmId: UserId | null;
    newPmId: UserId | null;
    requestedBy: UserId;
    createdAt: IsoInstant;
    reason: string;
  }[];
  openEscalations: {
    id: string;
    taskId: string;
    taskTitle: string;
    ownerId: UserId | null;
    managerId: UserId | null;
    level: number;
    severity: Severity;
    status: EscalationStatus;
    type: EscalationType;
    triggeredAt: IsoInstant;
    reason: string;
  }[];
  revision: number;
  updatedAt: IsoInstant;
}

export interface ProjectIndex {
  schemaVersion: 1;
  projects: ProjectIndexEntry[];
}

export interface DelayReason {
  id: string;
  label: string;
  side: 'client' | 'internal';
}

export interface EscalationLevelPolicy {
  level: number;
  role: ProjectRole;
  severity: Severity;
  condition: string;
  slaHours: number;
}

export interface Destination {
  id: string;
  label: string;
  /** Folder path inside the configured drive, relative to the drive root. */
  path: string;
}

export interface OrgConfig {
  schemaVersion: 1;
  timezone: string;
  /** ISO weekday numbers: 1 = Monday ... 7 = Sunday. */
  workingDays: number[];
  holidays: IsoDate[];
  delayReasons: DelayReason[];
  projectCategories: string[];
  escalation: {
    onNotCompleted: boolean;
    onNoResponse: boolean;
    levels: EscalationLevelPolicy[];
  };
  formerPmAccessDays: number;
  destinations: Destination[];
  /** Contact route shown on the support page when no ticketing integration exists. */
  supportContact: string;
  /** Emergency kill-switch: scheduled jobs listed here do not run. */
  disabledJobs: string[];
  updatedAt: IsoInstant | null;
  updatedBy: UserId | null;
}

export const SUPPORT_CATEGORIES = [
  'bug',
  'integration_failure',
  'workbook_sync',
  'missing_permission',
  'incorrect_assignment',
  'transfer_issue',
  'reminder_failure',
  'escalation_failure',
  'general',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: 'Bug',
  integration_failure: 'Failed integration',
  workbook_sync: 'Workbook synchronisation issue',
  missing_permission: 'Missing permission',
  incorrect_assignment: 'Incorrect project assignment',
  transfer_issue: 'Transfer issue',
  reminder_failure: 'Reminder failure',
  escalation_failure: 'Escalation failure',
  general: 'General assistance',
};

export const SUPPORT_STATUSES = [
  'open',
  'in_progress',
  'waiting_for_user',
  'resolved',
  'closed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export interface SupportRequest {
  id: string;
  category: SupportCategory;
  subject: string;
  description: string;
  reporterId: UserId;
  projectId: string | null;
  priority: Priority;
  status: SupportStatus;
  assigneeId: UserId | null;
  resolutionNotes: string;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
  history: {
    at: IsoInstant;
    by: UserId;
    from: SupportStatus | null;
    to: SupportStatus;
    note?: string;
  }[];
}

export interface SupportLog {
  schemaVersion: 1;
  requests: SupportRequest[];
}

export type AccountRequestStatus =
  | 'pending_transfers'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export interface AccountRequest {
  id: string;
  userId: UserId;
  reason: string;
  status: AccountRequestStatus;
  activePmProjects: string[];
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
  reviewedBy?: UserId;
  reviewNotes?: string;
  completedAt?: IsoInstant;
  steps: { name: string; status: 'pending' | 'done' | 'failed'; error?: string; at?: IsoInstant }[];
}

export interface AccountRequestLog {
  schemaVersion: 1;
  requests: AccountRequest[];
}

export interface AuditLog {
  schemaVersion: 1;
  entries: AuditEntry[];
}

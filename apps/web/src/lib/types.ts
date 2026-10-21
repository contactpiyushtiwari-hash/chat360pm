import type {
  GlobalRole,
  OnboardingStatus,
  Project,
  ProjectAccessLevel,
  ProjectIndexEntry,
  ProjectSummary,
  Task,
  WorkbookState,
} from '@chat360/core';

export interface Me {
  user: { id: string; email: string; displayName: string; roles: GlobalRole[]; status: string };
  permissions: { createProject: boolean; portfolio: boolean; admin: boolean };
  onboarding: OnboardingStatus;
  outlookConsent: boolean;
  environment: 'development' | 'staging' | 'production';
  devAuth: boolean;
  notificationsConfigured: boolean;
  supportContact: string;
  timezone: string;
  today: string;
  release: string;
}

export interface DirectoryEntry {
  id: string;
  displayName: string;
  email: string;
  roles: GlobalRole[];
}

export type ProjectListItem = Omit<ProjectIndexEntry, 'transfers' | 'openEscalations'> & {
  access: ProjectAccessLevel;
};

export type ProjectView = Omit<Project, 'appliedOperations' | 'workbook'> & {
  workbook: Omit<WorkbookState, 'rowHashes'>;
  summary: ProjectSummary;
  access: ProjectAccessLevel;
  permissions: Record<
    | 'edit'
    | 'viewFinance'
    | 'editFinance'
    | 'editTeam'
    | 'createTask'
    | 'manageApis'
    | 'manageEscalations'
    | 'syncWorkbook'
    | 'resolveConflicts'
    | 'requestTransfer'
    | 'reviewTransfers'
    | 'reassignPm'
    | 'logCommunication',
    boolean
  >;
};

export interface TodayItem {
  projectId: string;
  projectName: string;
  clientName: string;
  workbookState: string;
  task: Task;
  due: string;
  overdue?: boolean;
}

/** Calendar event as returned by /api/calendar/events (times are wall-clock in the org timezone). */
export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  timeZone: string;
  location: string;
  attendees: { email: string; name: string; response: string }[];
  isOnline: boolean;
  joinUrl: string | null;
  webLink: string | null;
  isCancelled: boolean;
  organizer: string;
}

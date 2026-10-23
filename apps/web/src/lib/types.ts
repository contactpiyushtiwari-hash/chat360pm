import type {
  GlobalRole,
  OnboardingStatus,
  Project,
  ProjectAccessLevel,
  ProjectIndexEntry,
  ProjectSummary,
  Task,
} from '@chat360/core';

export interface Me {
  user: { id: string; email: string; displayName: string; roles: GlobalRole[]; status: string };
  permissions: { createProject: boolean; portfolio: boolean; admin: boolean };
  onboarding: OnboardingStatus;
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

export type ProjectView = Omit<Project, 'appliedOperations'> & {
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
    | 'downloadTracker'
    | 'requestTransfer'
    | 'reviewTransfers'
    | 'reassignPm',
    boolean
  >;
};

export interface TodayItem {
  projectId: string;
  projectName: string;
  clientName: string;
  task: Task;
  due: string;
  overdue?: boolean;
}

import type { Project } from './types';

/** Built-in email templates. Placeholders use {{name}} and are filled from project data only. */
export interface EmailTemplate {
  id: string;
  label: string;
  audience: 'client' | 'internal';
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'api_followup',
    label: 'API / dependency follow-up',
    audience: 'client',
    subject: '{{client}} – {{project}}: pending API details',
    body: 'Hello,\n\nTo keep {{project}} on track for go-live on {{goLive}}, we still need the following from your team:\n\n{{pendingApis}}\n\nCould you share an update or a target date?\n\nThank you,\n{{sender}}',
  },
  {
    id: 'uat_feedback',
    label: 'UAT feedback request',
    audience: 'client',
    subject: '{{client}} – {{project}}: UAT feedback',
    body: 'Hello,\n\nUAT for {{project}} is in progress. Please share your feedback or sign-off so we can plan the go-live.\n\nThank you,\n{{sender}}',
  },
  {
    id: 'meeting_minutes',
    label: 'Meeting minutes and action items',
    audience: 'client',
    subject: '{{client}} – {{project}}: minutes and action items',
    body: 'Hello,\n\nThank you for your time today. Summary:\n\n- Discussion:\n- Decisions:\n- Action items (owner, due date):\n\nRegards,\n{{sender}}',
  },
  {
    id: 'internal_status',
    label: 'Internal status update',
    audience: 'internal',
    subject: '{{project}} status – {{health}}',
    body: 'Team,\n\n{{project}} ({{client}}) is {{health}}.\nOpen tasks: {{openTasks}}. Overdue: {{overdueTasks}}. Target go-live: {{goLive}}.\n\n{{sender}}',
  },
];

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function templateVars(
  project: Project | null,
  senderName: string,
  summary?: { health: string; openTasks: number; overdueTasks: number },
) {
  const vars: Record<string, string> = { sender: senderName };
  if (project) {
    vars.client = project.clientName;
    vars.project = project.name;
    vars.goLive = project.targetGoLive;
    vars.pendingApis =
      project.apis
        .filter((a) => a.readiness !== 'ready')
        .map((a) => `- ${a.name}${a.nextAction ? `: ${a.nextAction}` : ''}`)
        .join('\n') || '- (none recorded)';
  }
  if (summary) {
    vars.health = summary.health.toUpperCase();
    vars.openTasks = String(summary.openTasks);
    vars.overdueTasks = String(summary.overdueTasks);
  }
  return vars;
}

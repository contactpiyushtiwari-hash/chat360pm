import type { OrgConfig } from './types';

/**
 * Defaults applied until an administrator saves an organisation config.
 * Nothing here names real people: managers are resolved from project team assignments.
 */
export function defaultOrgConfig(): OrgConfig {
  return {
    schemaVersion: 1,
    timezone: 'Asia/Kolkata',
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    delayReasons: [
      { id: 'client_dependency', label: 'Client dependency', side: 'client' },
      { id: 'api_blocker', label: 'API or technical blocker', side: 'internal' },
      { id: 'resource_constraint', label: 'Internal resource constraint', side: 'internal' },
      { id: 'scope_change', label: 'Scope change', side: 'client' },
      { id: 'other', label: 'Other', side: 'internal' },
    ],
    projectCategories: ['Chatbot', 'Voicebot', 'WhatsApp Commerce', 'Integration', 'Other'],
    escalation: {
      onNotCompleted: true,
      onNoResponse: true,
      levels: [
        {
          level: 1,
          role: 'pm',
          severity: 'medium',
          condition: 'Task not completed or not confirmed by its due date',
          slaHours: 24,
        },
        {
          level: 2,
          role: 'delivery_head',
          severity: 'high',
          condition: 'Level 1 escalation not resolved within SLA, or task owner is the PM',
          slaHours: 48,
        },
      ],
    },
    formerPmAccessDays: 30,
    destinations: [{ id: 'default', label: 'Chat360 Project Operations', path: 'Projects' }],
    supportContact: '',
    disabledJobs: [],
    updatedAt: null,
    updatedBy: null,
  };
}

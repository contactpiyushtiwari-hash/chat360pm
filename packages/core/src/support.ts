import { forbidden, invalid, invalidTransition, notFound } from './errors';
import { newSupportId } from './ids';
import { canAdminister } from './rbac';
import type {
  DirectoryUser,
  Priority,
  SupportCategory,
  SupportLog,
  SupportRequest,
  SupportStatus,
} from './types';

const TRANSITIONS: Record<SupportStatus, SupportStatus[]> = {
  open: ['in_progress', 'waiting_for_user', 'resolved', 'closed'],
  in_progress: ['waiting_for_user', 'resolved', 'closed'],
  waiting_for_user: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export function createSupportRequest(
  log: SupportLog,
  input: {
    category: SupportCategory;
    subject: string;
    description: string;
    projectId: string | null;
    priority: Priority;
  },
  actor: DirectoryUser,
  now: string,
): SupportRequest {
  const req: SupportRequest = {
    id: newSupportId(),
    ...input,
    reporterId: actor.id,
    status: 'open',
    assigneeId: null,
    resolutionNotes: '',
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, by: actor.id, from: null, to: 'open' }],
  };
  log.requests.push(req);
  return req;
}

/** Reporters see their own requests; administrators (support owners) see all. */
export function canViewSupport(user: DirectoryUser, req: SupportRequest): boolean {
  return req.reporterId === user.id || req.assigneeId === user.id || canAdminister(user);
}

export function updateSupportRequest(
  log: SupportLog,
  id: string,
  input: {
    status?: SupportStatus;
    assigneeId?: string | null;
    resolutionNotes?: string;
    note?: string;
  },
  actor: DirectoryUser,
  now: string,
): SupportRequest {
  const req = log.requests.find((r) => r.id === id);
  if (!req || !canViewSupport(actor, req)) throw notFound(`Support request ${id}`);
  const isSupport = canAdminister(actor) || req.assigneeId === actor.id;
  if (!isSupport) {
    // Reporters may only reply (moving waiting_for_user back to in_progress) or close.
    const allowed =
      input.status === undefined ||
      input.status === 'closed' ||
      (req.status === 'waiting_for_user' && input.status === 'in_progress');
    if (!allowed || input.assigneeId !== undefined || input.resolutionNotes !== undefined) {
      throw forbidden('Only support owners can change this request.');
    }
  }
  if (input.status && input.status !== req.status) {
    if (!TRANSITIONS[req.status].includes(input.status)) {
      throw invalidTransition(`Cannot move from ${req.status} to ${input.status}.`);
    }
    if (input.status === 'resolved' && !(input.resolutionNotes ?? req.resolutionNotes).trim()) {
      throw invalid('Resolution notes are required to resolve a request.');
    }
    req.history.push({
      at: now,
      by: actor.id,
      from: req.status,
      to: input.status,
      ...(input.note ? { note: input.note } : {}),
    });
    req.status = input.status;
  } else if (input.note) {
    req.history.push({ at: now, by: actor.id, from: req.status, to: req.status, note: input.note });
  }
  if (input.assigneeId !== undefined) req.assigneeId = input.assigneeId;
  if (input.resolutionNotes !== undefined) req.resolutionNotes = input.resolutionNotes;
  req.updatedAt = now;
  return req;
}

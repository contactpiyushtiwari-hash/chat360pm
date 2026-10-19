import { DomainError, forbidden, invalid, invalidTransition, notFound } from './errors';
import { newAccountRequestId } from './ids';
import { canAdminister } from './rbac';
import type { AccountRequest, AccountRequestLog, DirectoryUser, ProjectIndexEntry } from './types';

export function activePmProjects(index: ProjectIndexEntry[], userId: string): ProjectIndexEntry[] {
  return index.filter(
    (p) => p.pmId === userId && (p.status === 'active' || p.status === 'on_hold'),
  );
}

/**
 * Records a deactivation request. If the user is PM of active projects the request waits in
 * `pending_transfers` and the Delivery Head is notified; projects are never orphaned silently.
 */
export function requestDeactivation(
  log: AccountRequestLog,
  user: DirectoryUser,
  input: { reason: string; confirmEmail: string },
  index: ProjectIndexEntry[],
  now: string,
): AccountRequest {
  if (input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw invalid('The confirmation email does not match your account.');
  }
  if (
    log.requests.some(
      (r) =>
        r.userId === user.id &&
        ['pending_transfers', 'pending_review', 'approved'].includes(r.status),
    )
  ) {
    throw new DomainError('conflict', 'You already have an open deactivation request.');
  }
  const owned = activePmProjects(index, user.id).map((p) => p.id);
  const req: AccountRequest = {
    id: newAccountRequestId(),
    userId: user.id,
    reason: input.reason,
    status: owned.length ? 'pending_transfers' : 'pending_review',
    activePmProjects: owned,
    createdAt: now,
    updatedAt: now,
    steps: [
      { name: 'revoke_sessions', status: 'pending' },
      { name: 'mark_deactivated', status: 'pending' },
    ],
  };
  log.requests.push(req);
  return req;
}

export function cancelDeactivation(
  log: AccountRequestLog,
  id: string,
  user: DirectoryUser,
  now: string,
) {
  const req = log.requests.find((r) => r.id === id && r.userId === user.id);
  if (!req) throw notFound(`Request ${id}`);
  if (!['pending_transfers', 'pending_review'].includes(req.status)) {
    throw invalidTransition('This request can no longer be cancelled.');
  }
  req.status = 'cancelled';
  req.updatedAt = now;
  return req;
}

/** Re-evaluates pending_transfers requests after PM transfers complete. */
export function refreshPendingTransfers(
  log: AccountRequestLog,
  index: ProjectIndexEntry[],
  now: string,
) {
  for (const req of log.requests) {
    if (req.status !== 'pending_transfers' && req.status !== 'pending_review') continue;
    const owned = activePmProjects(index, req.userId).map((p) => p.id);
    req.activePmProjects = owned;
    const next = owned.length ? 'pending_transfers' : 'pending_review';
    if (next !== req.status) {
      req.status = next;
      req.updatedAt = now;
    }
  }
}

export function reviewDeactivation(
  log: AccountRequestLog,
  id: string,
  decision: 'approve' | 'reject',
  notes: string,
  admin: DirectoryUser,
  index: ProjectIndexEntry[],
  now: string,
): AccountRequest {
  if (!canAdminister(admin)) throw forbidden('Only administrators can review account requests.');
  const req = log.requests.find((r) => r.id === id);
  if (!req) throw notFound(`Request ${id}`);
  if (req.userId === admin.id) throw forbidden('You cannot review your own deactivation request.');
  if (decision === 'reject') {
    if (!notes.trim()) throw invalid('A reason is required to reject a request.');
    if (!['pending_transfers', 'pending_review'].includes(req.status))
      throw invalidTransition('Request is not pending.');
    req.status = 'rejected';
  } else {
    const owned = activePmProjects(index, req.userId).map((p) => p.id);
    if (owned.length) {
      req.activePmProjects = owned;
      throw new DomainError(
        'precondition_failed',
        'Transfer the user’s active projects before approving.',
        { projects: owned },
      );
    }
    if (req.status !== 'pending_review')
      throw invalidTransition('Request is not ready for approval.');
    req.status = 'approved';
  }
  req.reviewedBy = admin.id;
  req.reviewNotes = notes;
  req.updatedAt = now;
  return req;
}

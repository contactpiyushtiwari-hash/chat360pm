import type { DirectoryUser, NotificationRecord, Project } from '@chat360/core';
import { nameResolver, timeContext, type Deps } from '../deps';
import type { MailMessage } from '../ports';

const MAX_ATTEMPTS = 5;
const SENDING_TIMEOUT_MS = 15 * 60_000;

interface Claimed {
  id: string;
  message: MailMessage | null;
  missing: string[];
}

function link(deps: Deps, path: string) {
  return `${deps.config.appOrigin}${path}`;
}

function buildMessage(
  deps: Deps,
  project: Project,
  n: NotificationRecord,
  users: DirectoryUser[],
): Claimed {
  const nameOf = nameResolver(users);
  const recipients = n.recipientIds.map((id) => users.find((u) => u.id === id));
  const to = recipients
    .filter((u): u is DirectoryUser => !!u && u.status !== 'deactivated' && !!u.email)
    .map((u) => u.email);
  const missing = n.recipientIds.filter(
    (id) => !to.includes(users.find((u) => u.id === id)?.email ?? '\u0000'),
  );
  if (!to.length) return { id: n.id, message: null, missing };
  const p = `${project.clientName} — ${project.name}`;
  let subject = `[Chat360 Ops] ${p}`;
  let body = '';
  const esc = project.escalations.find((e) => e.notifications.some((x) => x.id === n.id));
  const tr = project.transfers.find((t) => t.notifications.some((x) => x.id === n.id));
  if (esc) {
    const task = project.tasks.find((t) => t.id === esc.taskId);
    subject = `[Chat360 Ops] Escalation ${esc.id} (L${esc.level}, ${esc.severity}): ${task?.title ?? esc.taskId}`;
    body = [
      `Project: ${p} (${project.id})`,
      `Task: ${esc.taskId} ${task?.title ?? ''}`,
      `Owner: ${nameOf(esc.ownerId)}`,
      `Type: ${esc.type.replace('_', ' ')}`,
      `Original deadline: ${esc.originalDue}`,
      esc.revisedEta ? `Revised ETA: ${esc.revisedEta}` : '',
      `Reason: ${esc.reason}`,
      esc.impact ? `Impact: ${esc.impact}` : '',
      `Next action: ${esc.nextAction}`,
      '',
      `Review and acknowledge: ${link(deps, `/projects/${project.id}?tab=escalations`)}`,
    ]
      .filter((l) => l !== '')
      .join('\n');
  } else if (tr) {
    const verb =
      {
        'transfer.submitted': 'submitted',
        'transfer.approved': 'approved',
        'transfer.rejected': 'rejected',
        'transfer.completed': 'completed',
        'transfer.reassigned': 'reassigned by the Delivery Head',
      }[n.kind] ?? n.kind;
    subject = `[Chat360 Ops] PM transfer ${verb}: ${p}`;
    body = [
      `Project: ${p} (${project.id})`,
      `Transfer: ${tr.id} (${tr.kind === 'direct_reassignment' ? 'direct reassignment' : 'PM request'})`,
      `Current PM: ${nameOf(tr.fromPmId)}`,
      tr.newPmId || tr.proposedPmId ? `New PM: ${nameOf(tr.newPmId ?? tr.proposedPmId)}` : '',
      `Effective date: ${tr.requestedEffectiveDate}`,
      `Reason: ${tr.reason}`,
      tr.rejectionReason ? `Rejection reason: ${tr.rejectionReason}` : '',
      '',
      `Open: ${link(deps, `/transfers/${project.id}/${tr.id}`)}`,
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
  return { id: n.id, message: { to, subject, body }, missing };
}

function allNotifications(p: Project): NotificationRecord[] {
  return [
    ...p.escalations.flatMap((e) => e.notifications),
    ...p.transfers.flatMap((t) => t.notifications),
  ];
}

/**
 * Delivers pending notifications for one project. At-most-once: each notification is marked
 * `sending` in OneDrive before the Graph call; one stuck in `sending` (e.g. the Worker died
 * mid-send) becomes `unknown` and is surfaced, never silently resent.
 */
export async function deliverNotifications(deps: Deps, projectId: string) {
  const config = await deps.repos.orgConfig();
  const directory = await deps.repos.directory();
  const { now } = timeContext(deps, config);
  const nowMs = Date.parse(now);
  const stats = { sent: 0, failed: 0, notConfigured: 0, unknown: 0 };

  const { result: claimed } = await deps.repos.updateProject(projectId, (p) => {
    const out: Claimed[] = [];
    for (const n of allNotifications(p)) {
      if (
        n.status === 'sending' &&
        n.lastAttemptAt &&
        nowMs - Date.parse(n.lastAttemptAt) > SENDING_TIMEOUT_MS
      ) {
        n.status = 'unknown';
        n.lastError = 'Delivery outcome unknown (interrupted). Check the mailbox before resending.';
        continue;
      }
      if (!(n.status === 'pending' || (n.status === 'failed' && n.attempts < MAX_ATTEMPTS)))
        continue;
      if (!deps.mailer.configured) {
        n.status = 'not_configured';
        n.lastError = 'Notification mailbox is not configured.';
        continue;
      }
      const c = buildMessage(deps, p, n, directory.users);
      if (!c.message) {
        n.status = 'failed';
        n.attempts = MAX_ATTEMPTS;
        n.lastError = 'No active recipient with an email address.';
        continue;
      }
      n.status = 'sending';
      n.attempts += 1;
      n.lastAttemptAt = now;
      out.push(c);
    }
    return out;
  });

  const outcomes = new Map<string, { ok: boolean; error?: string; retryable?: boolean }>();
  for (const c of claimed) {
    try {
      const r = await deps.mailer.send(c.message!);
      if (r.status === 'accepted') outcomes.set(c.id, { ok: true });
      else
        outcomes.set(c.id, {
          ok: false,
          error: r.status === 'failed' ? r.error : r.reason,
          retryable: r.status === 'failed' && r.retryable,
        });
    } catch (err) {
      outcomes.set(c.id, { ok: false, error: String(err).slice(0, 200), retryable: true });
    }
  }

  if (claimed.length) {
    await deps.repos.updateProject(projectId, (p) => {
      for (const n of allNotifications(p)) {
        const o = outcomes.get(n.id);
        if (!o) continue;
        if (o.ok) {
          // "sent" means Microsoft Graph accepted the message (HTTP 202); delivery is not confirmed.
          n.status = 'sent';
          n.sentAt = now;
          delete n.lastError;
        } else {
          n.status = 'failed';
          n.lastError = o.error;
          if (!o.retryable) n.attempts = MAX_ATTEMPTS;
        }
      }
    });
  }
  for (const o of outcomes.values()) {
    if (o.ok) stats.sent++;
    else stats.failed++;
  }
  if (stats.failed) deps.log.warn('notification_failures', { projectId, failed: stats.failed });
  return stats;
}

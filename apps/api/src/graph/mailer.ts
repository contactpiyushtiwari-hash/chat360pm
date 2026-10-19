import type { Mailer, MailMessage, SendOutcome } from '../ports';
import { toGraphError, type GraphClient } from './client';

export function graphMessage(m: MailMessage) {
  const rcpt = (a: string) => ({ emailAddress: { address: a } });
  return {
    subject: m.subject,
    body: { contentType: 'Text', content: m.body },
    toRecipients: m.to.map(rcpt),
    ccRecipients: (m.cc ?? []).map(rcpt),
  };
}

/**
 * Sends notifications from one approved shared mailbox using app-only Mail.Send.
 * Requires an Exchange application access policy restricting the app to that mailbox (docs/security.md).
 * sendMail is not idempotent, so it is never retried automatically here.
 */
export class GraphMailer implements Mailer {
  readonly configured = true;
  constructor(
    private readonly graph: GraphClient,
    private readonly mailbox: string,
  ) {}

  async send(m: MailMessage): Promise<SendOutcome> {
    const res = await this.graph.raw({
      method: 'POST',
      path: `/users/${encodeURIComponent(this.mailbox)}/sendMail`,
      body: { message: graphMessage(m), saveToSentItems: true },
      retries: 0,
    });
    if (res.status === 202) return { status: 'accepted' };
    const err = await toGraphError(res);
    return {
      status: 'failed',
      error: `${err.status} ${err.code}`,
      retryable: err.status === 429 || err.status >= 500,
    };
  }
}

export class NotConfiguredMailer implements Mailer {
  readonly configured = false;
  async send(): Promise<SendOutcome> {
    return { status: 'not_configured', reason: 'NOTIFICATION_MAILBOX is not configured' };
  }
}

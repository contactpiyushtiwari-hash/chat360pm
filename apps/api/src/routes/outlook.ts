import {
  accessSubjectOf,
  addDays,
  classifyRecipients,
  EMAIL_TEMPLATES,
  emailPreviewSchema,
  emailSendSchema,
  invalid,
  meetingSchema,
  notFound,
  projectAccess,
  recordAudit,
  renderTemplate,
  sequenceId,
  summarizeProject,
  templateVars,
  type CommunicationRef,
  type EmailPreviewInput,
} from '@chat360/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { hmac, hmacVerify } from '../auth/crypto';
import { userGraph } from '../auth/delegated';
import { domainContext } from '../deps';
import { body, limit, requireUser, type AppContext, type AppEnv } from '../http/context';

export const outlookRoutes = new Hono<AppEnv>();

const PREVIEW_PURPOSE = 'email-preview-v1';
const PREVIEW_TTL_MS = 30 * 60_000;

async function projectFor(c: AppContext, projectId: string | null) {
  if (!projectId) return null;
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const project = await deps.repos.project(projectId);
  if (!project || projectAccess(user, accessSubjectOf(project), ctx.today) === 'none')
    throw notFound('Project');
  return project;
}

function finalBody(input: EmailPreviewInput, workbookUrl: string | null) {
  return input.includeWorkbookLink && workbookUrl
    ? `${input.body}\n\nProject tracker: ${workbookUrl}`
    : input.body;
}

function canonical(userId: string, input: EmailPreviewInput, finalText: string, exp: number) {
  return JSON.stringify([
    userId,
    exp,
    input.projectId,
    [...input.to].sort(),
    [...input.cc].sort(),
    input.subject,
    finalText,
  ]);
}

outlookRoutes.get('/email/templates', async (c) => {
  const user = requireUser(c);
  const project = await projectFor(c, c.req.query('projectId') ?? null);
  const ctx = await domainContext(c.get('deps'), user);
  const vars = templateVars(
    project,
    user.displayName,
    project ? summarizeProject(project, ctx.today) : undefined,
  );
  return c.json({
    templates: EMAIL_TEMPLATES.map((t) => ({
      id: t.id,
      label: t.label,
      audience: t.audience,
      subject: renderTemplate(t.subject, vars),
      body: renderTemplate(t.body, vars),
    })),
  });
});

/**
 * Returns exactly what will be sent plus a short-lived signed preview token. Sending requires the
 * token (so the confirmed content cannot be changed) and explicit confirmation for external recipients.
 */
outlookRoutes.post('/email/preview', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const input = await body(c, emailPreviewSchema);
  const project = await projectFor(c, input.projectId);
  const text = finalBody(input, project?.workbook.webUrl ?? null);
  const { internal, external } = classifyRecipients(
    [...input.to, ...input.cc],
    deps.config.allowedEmailDomains,
  );
  const exp = deps.clock().getTime() + PREVIEW_TTL_MS;
  const sig = await hmac(
    deps.config.cookieSecret,
    PREVIEW_PURPOSE,
    canonical(user.id, input, text, exp),
  );
  deps.analytics.track('email_preview', { projectId: input.projectId ?? undefined });
  return c.json({
    preview: {
      from: user.email,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: text,
      attachments: [] as string[],
    },
    internalRecipients: internal,
    externalRecipients: external,
    requiresExternalConfirmation: external.length > 0,
    previewToken: `${exp}.${sig}`,
  });
});

outlookRoutes.post('/email/send', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  await limit(c, `email:${user.id}`, 30, 3600);
  const input = await body(c, emailSendSchema);
  const project = await projectFor(c, input.projectId);
  const text = finalBody(input, project?.workbook.webUrl ?? null);
  const [expStr, sig] = input.previewToken.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < deps.clock().getTime())
    throw invalid('The preview has expired. Preview the email again before sending.');
  if (
    !(await hmacVerify(
      deps.config.cookieSecret,
      PREVIEW_PURPOSE,
      canonical(user.id, input, text, exp),
      sig,
    ))
  ) {
    throw invalid('The email changed after preview. Preview it again before sending.');
  }
  const { external } = classifyRecipients(
    [...input.to, ...input.cc],
    deps.config.allowedEmailDomains,
  );
  if (external.length && !input.confirmExternal)
    throw invalid('Confirm sending to external recipients.');
  // Replay protection: a preview token can be used once.
  if (await deps.coord.remember(`email-sent:${sig}`, '1', PREVIEW_TTL_MS / 1000)) {
    throw invalid('This email was already sent.');
  }

  const graph = await userGraph(c, { needOutlook: true });
  const outcome = await graph.sendMail({
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    body: text,
  });
  deps.analytics.track('email_sent', {
    projectId: input.projectId ?? undefined,
    outcome: outcome.status,
  });
  if (project) {
    const ctx = await domainContext(deps, user);
    await deps.repos.updateProject(project.id, (p) => {
      p.counters.comm += 1;
      const ref: CommunicationRef = {
        id: sequenceId('COM', p.counters.comm, 4),
        kind: 'email',
        at: ctx.now,
        by: user.id,
        subject: input.subject,
        recipients: [...input.to, ...input.cc],
        status: outcome.status === 'accepted' ? 'sent' : 'failed',
        ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
      };
      p.communications.push(ref);
      recordAudit(p, user.id, ctx.now, `email.${ref.status}`, ref.id, {
        recipients: ref.recipients.length,
      });
    });
  }
  if (outcome.status !== 'accepted') {
    await deps.coord.forget(`email-sent:${sig}`);
    return c.json(
      {
        error: {
          code: 'email_send_failed',
          message: 'Outlook did not accept the email. It was not sent.',
          details: { reason: outcome.status === 'failed' ? outcome.error : outcome.reason },
          requestId: c.get('requestId'),
        },
      },
      502,
    );
  }
  // Graph returns 202 Accepted: the message was queued by Outlook. Delivery is not confirmed.
  return c.json({ status: 'accepted' });
});

outlookRoutes.get('/calendar/events', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  const range = c.req.query('range') === 'week' ? 7 : 1;
  const graph = await userGraph(c, { needOutlook: true });
  // calendarView takes UTC instants; widen by a day so the org-timezone day is fully covered.
  const start = `${addDays(ctx.today, -1)}T00:00:00Z`;
  const end = `${addDays(ctx.today, range + 1)}T00:00:00Z`;
  const events = await graph.listEvents(start, end, ctx.config.timezone);
  const lastDay = addDays(ctx.today, range - 1);
  return c.json({
    today: ctx.today,
    timezone: ctx.config.timezone,
    events: events.filter(
      (e) => e.start.slice(0, 10) <= lastDay && e.end.slice(0, 10) >= ctx.today,
    ),
  });
});

async function logMeeting(
  c: AppContext,
  projectId: string | null,
  kind: CommunicationRef['status'],
  subject: string,
  attendees: string[],
  externalId?: string,
  error?: string,
) {
  if (!projectId) return;
  const user = requireUser(c);
  const deps = c.get('deps');
  const ctx = await domainContext(deps, user);
  await deps.repos.updateProject(projectId, (p) => {
    p.counters.comm += 1;
    p.communications.push({
      id: sequenceId('COM', p.counters.comm, 4),
      kind: 'meeting',
      at: ctx.now,
      by: user.id,
      subject,
      recipients: attendees,
      status: kind,
      ...(externalId ? { externalId } : {}),
      ...(error ? { error } : {}),
    });
  });
}

outlookRoutes.post('/calendar/events', async (c) => {
  const user = requireUser(c);
  const deps = c.get('deps');
  await limit(c, `meeting:${user.id}`, 30, 3600);
  const input = await body(c, meetingSchema);
  const project = await projectFor(c, input.projectId);
  const { external } = classifyRecipients(input.attendees, deps.config.allowedEmailDomains);
  if (external.length && !input.confirmExternal)
    throw invalid('Confirm sending invitations to external attendees.');
  const graph = await userGraph(c, { needOutlook: true });
  const agenda = [
    input.agenda,
    project
      ? `Project: ${project.clientName} — ${project.name}\n${deps.config.appOrigin}/projects/${project.id}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  try {
    const event = await graph.createEvent({
      subject: input.subject,
      start: input.start,
      end: input.end,
      timeZone: input.timeZone,
      attendees: input.attendees,
      body: agenda,
      location: input.location,
      online: input.online,
    });
    await logMeeting(c, project?.id ?? null, 'created', input.subject, input.attendees, event.id);
    deps.analytics.track('meeting_created', { projectId: project?.id, outcome: 'ok' });
    return c.json({ event }, 201);
  } catch (err) {
    await logMeeting(
      c,
      project?.id ?? null,
      'failed',
      input.subject,
      input.attendees,
      undefined,
      String(err).slice(0, 200),
    ).catch(() => undefined);
    deps.analytics.track('meeting_created', { projectId: project?.id, outcome: 'failed' });
    throw err;
  }
});

outlookRoutes.patch('/calendar/events/:eid', async (c) => {
  requireUser(c);
  const input = await body(
    c,
    z.object({
      subject: z.string().trim().min(1).max(255).optional(),
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        .optional(),
      end: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        .optional(),
      timeZone: z.string().min(1).max(64),
    }),
  );
  const graph = await userGraph(c, { needOutlook: true });
  const event = await graph.updateEvent(c.req.param('eid'), input);
  return c.json({ event });
});

outlookRoutes.post('/calendar/events/:eid/cancel', async (c) => {
  requireUser(c);
  const { comment } = await body(c, z.object({ comment: z.string().max(1000).default('') }));
  const graph = await userGraph(c, { needOutlook: true });
  await graph.cancelEvent(c.req.param('eid'), comment);
  return c.json({ status: 'cancelled' });
});

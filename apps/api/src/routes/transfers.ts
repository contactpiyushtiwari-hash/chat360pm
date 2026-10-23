import {
  approveTransfer,
  cancelTransfer,
  directReassignment,
  findTransfer,
  isEffective,
  reassignPmSchema,
  rejectTransfer,
  requestTransfer,
  startReview,
  submitTransfer,
  transferDecisionSchema,
  transferDraftSchema,
  transferRejectSchema,
  forbidden,
} from '@chat360/core';
import { Hono } from 'hono';
import { body, idempotencyKey, requireUser, type AppEnv } from '../http/context';
import { executeTransfer } from '../services/transfers';
import { loadProject, mutateProject, redactFinance } from './project-helpers';

export const transferRoutes = new Hono<AppEnv>();

/** Path A — the current PM raises a request (draft or submitted). */
transferRoutes.post('/:id/transfers', async (c) => {
  const key = idempotencyKey(c, true);
  const input = await body(c, transferDraftSchema);
  const directory = (await c.get('deps').repos.directory()).users;
  const { project, result, replayedRef } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => requestTransfer(p, input, ctx, directory),
    { idempotencyKey: key },
  );
  const t = result ?? project.transfers.find((x) => x.id === replayedRef);
  if (result)
    c.get('deps').analytics.track('transfer_requested', {
      projectId: project.id,
      outcome: result.status,
    });
  return c.json({ transfer: t }, result ? 201 : 200);
});

transferRoutes.get('/:id/transfers/:tid', async (c) => {
  const { project, access, ctx } = await loadProject(c, c.req.param('id'));
  const t = findTransfer(redactFinance(project, ctx.actor, ctx.today), c.req.param('tid'));
  const involved = [t.fromPmId, t.requestedBy, t.newPmId, t.proposedPmId].includes(ctx.actor.id);
  if (!involved && access !== 'portfolio' && access !== 'manager') throw forbidden();
  return c.json({
    transfer: t,
    project: {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      currentPmId: project.team.pm,
    },
  });
});

transferRoutes.post('/:id/transfers/:tid/submit', async (c) => {
  const directory = (await c.get('deps').repos.directory()).users;
  const { result } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => submitTransfer(p, c.req.param('tid'), ctx, directory),
    {},
  );
  return c.json({ transfer: result });
});

transferRoutes.post('/:id/transfers/:tid/review', async (c) => {
  const { result } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => startReview(p, c.req.param('tid'), ctx),
    {},
  );
  return c.json({ transfer: result });
});

transferRoutes.post('/:id/transfers/:tid/approve', async (c) => {
  const input = await body(c, transferDecisionSchema);
  const deps = c.get('deps');
  const directory = (await deps.repos.directory()).users;
  const { result, ctx } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => approveTransfer(p, c.req.param('tid'), input.newPmId, input.notes, ctx, directory),
    {},
  );
  deps.analytics.track('transfer_approved', { projectId: c.req.param('id') });
  // Execute now if effective; otherwise the scheduled job executes on the effective date.
  const transfer =
    result && isEffective(result, ctx.today)
      ? await executeTransfer(deps, c.req.param('id'), result.id, requireUser(c))
      : result;
  return c.json({ transfer });
});

transferRoutes.post('/:id/transfers/:tid/reject', async (c) => {
  const input = await body(c, transferRejectSchema);
  const { result } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => rejectTransfer(p, c.req.param('tid'), input.reason, ctx),
    {},
  );
  c.get('deps').analytics.track('transfer_rejected', { projectId: c.req.param('id') });
  return c.json({ transfer: result });
});

transferRoutes.post('/:id/transfers/:tid/cancel', async (c) => {
  const { result } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) => cancelTransfer(p, c.req.param('tid'), ctx),
    {},
  );
  return c.json({ transfer: result });
});

/** Resumes an interrupted execution (recovery path). Idempotent. */
transferRoutes.post('/:id/transfers/:tid/retry', async (c) => {
  const { access } = await loadProject(c, c.req.param('id'));
  if (access !== 'portfolio')
    throw forbidden('Only the Delivery and Operations Head can retry a transfer.');
  const transfer = await executeTransfer(
    c.get('deps'),
    c.req.param('id'),
    c.req.param('tid'),
    requireUser(c),
  );
  return c.json({ transfer });
});

/** Path B — the Delivery and Operations Head reassigns the PM directly (after confirmation). */
transferRoutes.post('/:id/reassign-pm', async (c) => {
  const key = idempotencyKey(c, true);
  const input = await body(c, reassignPmSchema);
  const deps = c.get('deps');
  const directory = (await deps.repos.directory()).users;
  const { project, result, replayedRef, ctx } = await mutateProject(
    c,
    c.req.param('id'),
    (p, ctx) =>
      directReassignment(
        p,
        {
          newPmId: input.newPmId,
          reason: input.reason,
          effectiveDate: input.effectiveDate,
          handoverNotes: input.handoverNotes,
        },
        ctx,
        directory,
      ),
    { idempotencyKey: key },
  );
  const t = result ?? project.transfers.find((x) => x.id === replayedRef)!;
  if (result) deps.analytics.track('pm_reassigned', { projectId: project.id });
  const transfer = isEffective(t, ctx.today)
    ? await executeTransfer(deps, project.id, t.id, requireUser(c))
    : t;
  return c.json({ transfer }, result ? 201 : 200);
});

import { recordAudit, touch, type DomainContext } from './context';
import { DomainError, forbidden } from './errors';
import { accessSubjectOf, can } from './rbac';
import type { UpdateFinanceInput } from './schemas';
import type { Project, ProjectFinance } from './types';

export const DEFAULT_CURRENCY = 'INR';

export function emptyFinance(currency = DEFAULT_CURRENCY): ProjectFinance {
  return {
    currency,
    raisedOverdueForGoLive: 0,
    raisableImmediately: 0,
    toBeRaised: 0,
    remarks: '',
    updatedAt: null,
    updatedBy: null,
  };
}

/** Finance for a project, defaulting for documents created before finance tracking existed. */
export function financeOf(project: Project): ProjectFinance {
  return project.finance ?? emptyFinance();
}

/** Total = amount raised and overdue (for go-live) + amount raisable immediately. */
export function financeTotal(f: ProjectFinance): number {
  return Math.round((f.raisedOverdueForGoLive + f.raisableImmediately) * 100) / 100;
}

export function updateFinance(project: Project, input: UpdateFinanceInput, ctx: DomainContext) {
  if (!can(ctx.actor, 'finance.edit', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the PM, Sales POC or Delivery Head can update project finance.');
  }
  const current = financeOf(project);
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current.updatedAt) {
    throw new DomainError(
      'conflict',
      'Finance was changed by someone else. Reload to see the latest figures.',
      { currentUpdatedAt: current.updatedAt },
    );
  }
  const next: ProjectFinance = {
    currency: input.currency,
    raisedOverdueForGoLive: input.raisedOverdueForGoLive,
    raisableImmediately: input.raisableImmediately,
    toBeRaised: input.toBeRaised,
    remarks: input.remarks,
    updatedAt: ctx.now,
    updatedBy: ctx.actor.id,
  };
  const changed = (
    ['currency', 'raisedOverdueForGoLive', 'raisableImmediately', 'toBeRaised', 'remarks'] as const
  ).filter((k) => current[k] !== next[k]);
  if (!changed.length) return current;
  project.finance = next;
  // Amounts are recorded in the project audit so changes to billing figures are traceable.
  recordAudit(project, ctx.actor.id, ctx.now, 'finance.updated', project.id, {
    fields: changed,
    from: Object.fromEntries(changed.map((k) => [k, current[k]])),
    to: Object.fromEntries(changed.map((k) => [k, next[k]])),
  });
  touch(project, ctx.now);
  return next;
}

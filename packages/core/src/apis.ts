import { recordAudit, touch, type DomainContext } from './context';
import { forbidden, invalid, notFound } from './errors';
import { sequenceId } from './ids';
import { accessSubjectOf, can, teamMemberIds } from './rbac';
import type { ApiDependency, Project } from './types';
import type { z } from 'zod';
import type { apiDependencySchema, updateApiDependencySchema } from './schemas';

type CreateInput = z.infer<typeof apiDependencySchema>;
type UpdateInput = z.infer<typeof updateApiDependencySchema>;

/** Rejects values that look like credentials: API records must never hold secrets. */
export function looksLikeSecret(value: string): boolean {
  return (
    /(api[_-]?key|secret|password|passwd|token|bearer)\s*[:=]/i.test(value) ||
    /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/.test(value) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(value)
  );
}

function assertNoSecrets(input: Record<string, unknown>) {
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && looksLikeSecret(v)) {
      throw invalid(
        `"${k}" looks like it contains a credential. Store secrets in the client's vault, not here.`,
      );
    }
  }
}

function assertCan(project: Project, ctx: DomainContext) {
  if (!can(ctx.actor, 'api.manage', accessSubjectOf(project), ctx.today)) {
    throw forbidden('Only the PM, Tech Team or FDE can manage API dependencies.');
  }
}

export function addApiDependency(
  project: Project,
  input: CreateInput,
  ctx: DomainContext,
): ApiDependency {
  assertCan(project, ctx);
  assertNoSecrets(input);
  if (input.ownerId && !teamMemberIds(project.team).includes(input.ownerId)) {
    throw invalid('API owner must be a member of the project team.');
  }
  project.counters.api += 1;
  const api: ApiDependency = {
    id: sequenceId('API', project.counters.api, 3),
    ...input,
    updatedAt: ctx.now,
    updatedBy: ctx.actor.id,
  };
  project.apis.push(api);
  recordAudit(project, ctx.actor.id, ctx.now, 'api.created', api.id, { name: api.name });
  touch(project, ctx.now);
  return api;
}

export function updateApiDependency(
  project: Project,
  id: string,
  input: UpdateInput,
  ctx: DomainContext,
): ApiDependency {
  assertCan(project, ctx);
  assertNoSecrets(input);
  const api = project.apis.find((a) => a.id === id);
  if (!api) throw notFound(`API ${id}`);
  if (input.ownerId && !teamMemberIds(project.team).includes(input.ownerId)) {
    throw invalid('API owner must be a member of the project team.');
  }
  Object.assign(api, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
  api.updatedAt = ctx.now;
  api.updatedBy = ctx.actor.id;
  recordAudit(project, ctx.actor.id, ctx.now, 'api.updated', api.id, {
    fields: Object.keys(input),
  });
  touch(project, ctx.now);
  return api;
}

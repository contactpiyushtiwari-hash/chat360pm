import {
  defaultOrgConfig,
  newAuditId,
  notFound,
  type AccountRequestLog,
  type AuditEntry,
  type AuditLog,
  type Directory,
  type OrgConfig,
  type Project,
  type ProjectIndex,
  type ProjectIndexEntry,
  type SupportLog,
} from '@chat360/core';
import { PreconditionFailedError, type DocStore, type StoredDoc } from '../ports';

/** OneDrive layout under the configured root (docs/infrastructure.md §Data layout). */
export const PATHS = {
  directory: '_system/directory.json',
  config: '_system/config.json',
  index: '_system/projects-index.json',
  support: '_system/support.json',
  accounts: '_system/account-requests.json',
  audit: (month: string) => `_system/audit/${month}.json`,
  project: (folderPath: string) => `${folderPath}/project.json`,
};

const CACHE_TTL_MS = 30_000;

/**
 * Per-isolate cache for read-mostly system documents (directory, config, index).
 * Another isolate's write becomes visible within the TTL; authorisation-critical changes
 * (deactivation) also revoke sessions immediately via the Coordinator.
 */
export class ReadCache {
  private entries = new Map<string, { doc: StoredDoc<unknown>; at: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  get<T>(path: string): StoredDoc<T> | undefined {
    const e = this.entries.get(path);
    if (!e || this.now() - e.at > CACHE_TTL_MS) return undefined;
    return e.doc as StoredDoc<T>;
  }
  set(path: string, doc: StoredDoc<unknown>) {
    this.entries.set(path, { doc, at: this.now() });
  }
  clear() {
    this.entries.clear();
  }
}

export interface UpdateResult<T, R> {
  data: T;
  result: R;
  changed: boolean;
}

export class Repos {
  constructor(
    readonly store: DocStore,
    private readonly cache: ReadCache,
    private readonly maxRetries = 6,
  ) {}

  private async cached<T>(path: string): Promise<StoredDoc<T> | null> {
    const hit = this.cache.get<T>(path);
    if (hit) return hit;
    const doc = await this.store.getJson<T>(path);
    if (doc) this.cache.set(path, doc);
    return doc;
  }

  /**
   * Optimistic read-modify-write. `mutate` may run more than once (on 412 it re-runs against
   * fresh data), so it must only change the draft. Writes are skipped when nothing changed.
   */
  async update<T, R>(
    path: string,
    init: (() => T) | null,
    mutate: (draft: T) => R,
  ): Promise<UpdateResult<T, R>> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const cur = await this.store.getJson<T>(path);
      if (!cur && !init) throw notFound(path.split('/').at(-2) ?? 'Document');
      const draft = cur ? structuredClone(cur.data) : init!();
      const before = cur ? JSON.stringify(cur.data) : null;
      const result = mutate(draft);
      if (before !== null && JSON.stringify(draft) === before) {
        this.cache.set(path, cur!);
        return { data: draft, result, changed: false };
      }
      try {
        const { etag } = await this.store.putJson(
          path,
          draft,
          cur ? { ifMatch: cur.etag } : { ifNoneMatch: '*' },
        );
        this.cache.set(path, { data: draft, etag });
        return { data: draft, result, changed: true };
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
        await new Promise((r) => setTimeout(r, 25 * 2 ** attempt + Math.random() * 50));
      }
    }
    throw new PreconditionFailedError(`Gave up updating ${path} after ${this.maxRetries} attempts`);
  }

  async directory(): Promise<Directory> {
    return (await this.cached<Directory>(PATHS.directory))?.data ?? { schemaVersion: 1, users: [] };
  }
  updateDirectory<R>(mutate: (d: Directory) => R) {
    return this.update<Directory, R>(
      PATHS.directory,
      () => ({ schemaVersion: 1, users: [] }),
      mutate,
    );
  }

  /** Stored config merged over defaults, so newly added settings get safe values. */
  async orgConfig(): Promise<OrgConfig> {
    const stored = (await this.cached<OrgConfig>(PATHS.config))?.data;
    return { ...defaultOrgConfig(), ...stored };
  }
  updateConfig<R>(mutate: (c: OrgConfig) => R) {
    return this.update<OrgConfig, R>(PATHS.config, defaultOrgConfig, mutate);
  }

  async index(fresh = false): Promise<ProjectIndex> {
    const doc = fresh
      ? await this.store.getJson<ProjectIndex>(PATHS.index)
      : await this.cached<ProjectIndex>(PATHS.index);
    return doc?.data ?? { schemaVersion: 1, projects: [] };
  }

  /** Writes the entry only if something other than revision/updatedAt changed. */
  upsertIndexEntry(entry: ProjectIndexEntry) {
    const strip = (e: ProjectIndexEntry) => JSON.stringify({ ...e, revision: 0, updatedAt: '' });
    return this.update<ProjectIndex, void>(
      PATHS.index,
      () => ({ schemaVersion: 1, projects: [] }),
      (idx) => {
        const i = idx.projects.findIndex((p) => p.id === entry.id);
        if (i < 0) idx.projects.push(entry);
        else if (strip(idx.projects[i]!) !== strip(entry)) idx.projects[i] = entry;
      },
    );
  }

  async indexEntry(id: string): Promise<ProjectIndexEntry | null> {
    const idx = await this.index();
    const hit = idx.projects.find((p) => p.id === id);
    if (hit) return hit;
    // A project created moments ago in another isolate may not be in this cache yet.
    return (await this.index(true)).projects.find((p) => p.id === id) ?? null;
  }

  async project(id: string): Promise<Project | null> {
    const entry = await this.indexEntry(id);
    if (!entry) return null;
    return (await this.store.getJson<Project>(PATHS.project(entry.folderPath)))?.data ?? null;
  }

  async createProject(project: Project) {
    await this.store.putJson(PATHS.project(project.folderPath), project, { ifNoneMatch: '*' });
  }

  async updateProject<R>(id: string, mutate: (p: Project) => R): Promise<UpdateResult<Project, R>> {
    const entry = await this.indexEntry(id);
    if (!entry) throw notFound(`Project ${id}`);
    return this.update<Project, R>(PATHS.project(entry.folderPath), null, mutate);
  }

  async support(): Promise<SupportLog> {
    return (
      (await this.store.getJson<SupportLog>(PATHS.support))?.data ?? {
        schemaVersion: 1,
        requests: [],
      }
    );
  }
  updateSupport<R>(mutate: (s: SupportLog) => R) {
    return this.update<SupportLog, R>(
      PATHS.support,
      () => ({ schemaVersion: 1, requests: [] }),
      mutate,
    );
  }

  async accounts(): Promise<AccountRequestLog> {
    return (
      (await this.store.getJson<AccountRequestLog>(PATHS.accounts))?.data ?? {
        schemaVersion: 1,
        requests: [],
      }
    );
  }
  updateAccounts<R>(mutate: (s: AccountRequestLog) => R) {
    return this.update<AccountRequestLog, R>(
      PATHS.accounts,
      () => ({ schemaVersion: 1, requests: [] }),
      mutate,
    );
  }

  /** Organisation-level audit trail (admin actions, logins of new users, deactivations). */
  async appendAudit(entry: Omit<AuditEntry, 'id'>) {
    const month = entry.at.slice(0, 7);
    await this.update<AuditLog, void>(
      PATHS.audit(month),
      () => ({ schemaVersion: 1, entries: [] }),
      (log) => {
        log.entries.push({ id: newAuditId(), ...entry });
      },
    );
  }

  async auditMonth(month: string): Promise<AuditLog> {
    return (
      (await this.store.getJson<AuditLog>(PATHS.audit(month)))?.data ?? {
        schemaVersion: 1,
        entries: [],
      }
    );
  }
}

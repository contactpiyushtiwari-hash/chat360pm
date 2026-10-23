import {
  PreconditionFailedError,
  type DocStore,
  type StoredDoc,
  type WriteCondition,
} from '../ports';

/** Created on first use, so an empty database needs no migration step. */
export const DOCS_SCHEMA =
  'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL, etag TEXT NOT NULL, updated_at INTEGER NOT NULL)';

/**
 * JSON documents in Cloudflare D1, one row per document path (ADR-021). The eTag is a random
 * version stamp; conditional writes are single SQL statements, so a stale write changes no row
 * and surfaces as PreconditionFailedError exactly like a OneDrive 412 did.
 * ponytail: a whole project is one row (D1 rows max out at 2 MB); split tasks out if a project nears that.
 */
export class D1DocStore implements DocStore {
  private ready: Promise<unknown> | null = null;

  constructor(private readonly db: D1Database) {}

  private init() {
    this.ready ??= this.db.prepare(DOCS_SCHEMA).run();
    return this.ready;
  }

  async getJson<T>(path: string): Promise<StoredDoc<T> | null> {
    await this.init();
    const row = await this.db
      .prepare('SELECT data, etag FROM docs WHERE path = ?')
      .bind(path)
      .first<{ data: string; etag: string }>();
    return row ? { data: JSON.parse(row.data) as T, etag: row.etag } : null;
  }

  async putJson<T>(path: string, data: T, condition: WriteCondition): Promise<{ etag: string }> {
    await this.init();
    const etag = crypto.randomUUID();
    const json = JSON.stringify(data);
    const now = Date.now();
    const res =
      'ifNoneMatch' in condition
        ? await this.db
            .prepare(
              'INSERT INTO docs (path, data, etag, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO NOTHING',
            )
            .bind(path, json, etag, now)
            .run()
        : await this.db
            .prepare(
              'UPDATE docs SET data = ?, etag = ?, updated_at = ? WHERE path = ? AND etag = ?',
            )
            .bind(json, etag, now, path, condition.ifMatch)
            .run();
    if (res.meta.changes !== 1) throw new PreconditionFailedError(`${path} changed concurrently`);
    return { etag };
  }

  async listFolders(path: string): Promise<string[]> {
    await this.init();
    const prefix = `${path}/`;
    const { results } = await this.db
      .prepare('SELECT path FROM docs WHERE substr(path, 1, ?) = ?')
      .bind(prefix.length, prefix)
      .all<{ path: string }>();
    const names = new Set<string>();
    for (const r of results) {
      const rest = r.path.slice(prefix.length);
      if (rest.includes('/')) names.add(rest.split('/')[0]!);
    }
    return [...names];
  }
}

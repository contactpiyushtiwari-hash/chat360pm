import {
  PreconditionFailedError,
  type Coordination,
  type DocStore,
  type JobRun,
  type Mailer,
  type MailMessage,
  type SendOutcome,
  type SessionRecord,
  type SessionStore,
  type StoredDoc,
  type WriteCondition,
} from '../ports';

/**
 * In-memory adapters for local development and automated tests. They mimic the production
 * contracts (eTags and conflicts on stale writes) so concurrency logic is exercised, but they do
 * NOT verify the D1 adapter (see test/d1-store.test.ts for that).
 */

interface MemFile {
  json: string;
  etag: string;
}

export class MemoryDocStore implements DocStore {
  readonly files = new Map<string, MemFile>();
  private n = 0;
  /** Test hook: make the next N writes to a path fail with 412 (simulated concurrent edit). */
  readonly conflictsToInject = new Map<string, number>();
  /** Test hook: fail operations on matching paths. */
  failPaths: RegExp | null = null;

  private nextEtag() {
    return `"{mem-${++this.n}},1"`;
  }

  async getJson<T>(path: string): Promise<StoredDoc<T> | null> {
    if (this.failPaths?.test(path)) throw new Error(`Injected failure reading ${path}`);
    const f = this.files.get(path);
    if (!f) return null;
    return { data: JSON.parse(f.json) as T, etag: f.etag };
  }

  async putJson<T>(path: string, data: T, condition: WriteCondition) {
    if (this.failPaths?.test(path)) throw new Error(`Injected failure writing ${path}`);
    const inject = this.conflictsToInject.get(path) ?? 0;
    if (inject > 0) {
      this.conflictsToInject.set(path, inject - 1);
      // Simulate someone else's write landing first.
      const cur = this.files.get(path);
      if (cur) cur.etag = this.nextEtag();
      throw new PreconditionFailedError(`${path} changed concurrently (injected)`);
    }
    const cur = this.files.get(path);
    if ('ifNoneMatch' in condition && cur)
      throw new PreconditionFailedError(`${path} already exists`);
    if ('ifMatch' in condition && (!cur || cur.etag !== condition.ifMatch)) {
      throw new PreconditionFailedError(`${path} changed concurrently`);
    }
    const file: MemFile = { json: JSON.stringify(data), etag: this.nextEtag() };
    this.files.set(path, file);
    return { etag: file.etag };
  }

  async listFolders(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (rest.includes('/')) names.add(rest.split('/')[0]!);
      }
    }
    return [...names];
  }
}

export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, SessionRecord>();
  async create(r: SessionRecord) {
    this.sessions.set(r.id, { ...r });
  }
  async get(id: string) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return { ...s };
  }
  async touch(id: string, now: number) {
    const s = this.sessions.get(id);
    if (s) s.lastSeenAt = now;
  }
  async delete(id: string) {
    this.sessions.delete(id);
  }
  async deleteForUser(userId: string) {
    let n = 0;
    for (const [k, v] of this.sessions) {
      if (v.userId === userId) {
        this.sessions.delete(k);
        n++;
      }
    }
    return n;
  }
}

export class MemoryCoordination implements Coordination {
  private counters = new Map<string, number>();
  private leases = new Map<string, { owner: string; expiresAt: number }>();
  private memo = new Map<string, { v: string; expiresAt: number }>();
  readonly jobRuns: JobRun[] = [];
  async rateLimit(key: string, limit: number, windowSeconds: number) {
    const k = `${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    return n <= limit;
  }
  async acquireLease(name: string, owner: string, ttl: number) {
    const cur = this.leases.get(name);
    if (cur && cur.expiresAt > Date.now() && cur.owner !== owner) return false;
    this.leases.set(name, { owner, expiresAt: Date.now() + ttl * 1000 });
    return true;
  }
  async releaseLease(name: string, owner: string) {
    if (this.leases.get(name)?.owner === owner) this.leases.delete(name);
  }
  async remember(key: string, value: string, ttl: number) {
    const cur = this.memo.get(key);
    if (cur && cur.expiresAt > Date.now()) return cur.v;
    this.memo.set(key, { v: value, expiresAt: Date.now() + ttl * 1000 });
    return null;
  }
  async store(key: string, value: string, ttl: number) {
    this.memo.set(key, { v: value, expiresAt: Date.now() + ttl * 1000 });
  }
  async forget(key: string) {
    this.memo.delete(key);
  }
  async recordJobRun(run: JobRun) {
    this.jobRuns.unshift(run);
  }
  async recentJobRuns(limit: number) {
    return this.jobRuns.slice(0, limit);
  }
  async purgeExpired() {}
}

/** Records messages instead of sending. Used in development and tests: no real email leaves. */
export class RecordingMailer implements Mailer {
  readonly configured: boolean;
  readonly sent: MailMessage[] = [];
  fail = false;
  constructor(configured = true) {
    this.configured = configured;
  }
  async send(m: MailMessage): Promise<SendOutcome> {
    if (!this.configured)
      return { status: 'not_configured', reason: 'Notification mailbox not configured' };
    if (this.fail) return { status: 'failed', error: '503 serviceUnavailable', retryable: true };
    this.sent.push(m);
    return { status: 'accepted' };
  }
}

import { readXlsxTables } from '@chat360/core/workbook';
import {
  PreconditionFailedError,
  type CalendarEvent,
  type CellWrite,
  type Coordination,
  type DocStore,
  type GraphProfile,
  type JobRun,
  type Mailer,
  type MailMessage,
  type NewEvent,
  type SendOutcome,
  type SessionRecord,
  type SessionStore,
  type StoredDoc,
  type UserGraph,
  type WorkbookGateway,
  type WorkbookTable,
  type WorkbookWrite,
  type WriteCondition,
} from '../ports';

/**
 * In-memory adapters for local development and automated tests. They mimic the production
 * contracts (eTags and 412 on stale writes) so concurrency logic is exercised, but they do NOT
 * verify Microsoft Graph integration.
 */

interface MemFile {
  bytes: Uint8Array;
  etag: string;
  itemId: string;
  contentType: string;
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
    return { data: JSON.parse(new TextDecoder().decode(f.bytes)) as T, etag: f.etag };
  }

  async putJson<T>(path: string, data: T, condition: WriteCondition) {
    const r = await this.putFile(
      path,
      new TextEncoder().encode(JSON.stringify(data)),
      'application/json',
      condition,
    );
    return { etag: r.etag };
  }

  async putFile(path: string, bytes: Uint8Array, contentType: string, condition: WriteCondition) {
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
    const file: MemFile = {
      bytes,
      contentType,
      etag: this.nextEtag(),
      itemId: cur?.itemId ?? `item-${this.n}`,
    };
    this.files.set(path, file);
    return {
      itemId: file.itemId,
      webUrl: `https://onedrive.local/${encodeURI(path)}`,
      etag: file.etag,
    };
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

  fileByItemId(itemId: string) {
    for (const [path, f] of this.files) if (f.itemId === itemId) return { path, ...f };
    return null;
  }
}

/** Holds tables parsed from the generated .xlsx and applies writes in memory. */
export class MemoryWorkbookGateway implements WorkbookGateway {
  readonly workbooks = new Map<string, WorkbookTable[]>();
  failWrites = false;
  writeLog: { itemId: string; writes: WorkbookWrite[]; cells: CellWrite[] }[] = [];

  constructor(private readonly store: MemoryDocStore) {}

  private load(itemId: string): WorkbookTable[] {
    let wb = this.workbooks.get(itemId);
    if (!wb) {
      const f = this.store.fileByItemId(itemId);
      if (!f) throw new Error(`Workbook ${itemId} not found`);
      wb = readXlsxTables(f.bytes).map((t) => ({
        name: t.name,
        sheet: t.sheet,
        headers: t.headers,
        rows: t.rows,
        firstDataRow: t.firstDataRow,
      }));
      this.workbooks.set(itemId, wb);
    }
    return wb;
  }

  async readTables(itemId: string, tables: string[]) {
    const wb = this.load(itemId);
    return tables.flatMap((name) => {
      const t = wb.find((x) => x.name === name);
      return t ? [structuredClone(t)] : [];
    });
  }

  async write(itemId: string, writes: WorkbookWrite[], cells: CellWrite[]) {
    this.writeLog.push({ itemId, writes, cells });
    if (this.failWrites)
      return writes.map((w) => ({ table: w.table, ok: false, error: 'Injected write failure' }));
    const wb = this.load(itemId);
    return writes.map((w) => {
      const t = wb.find((x) => x.name === w.table)!;
      for (const p of w.patches) t.rows[p.row - t.firstDataRow] = [...p.values];
      for (const a of w.appends) t.rows.push([...a]);
      return { table: w.table, ok: true };
    });
  }

  /** Test helper: simulate a workbook generated before a table existed. */
  dropTable(itemId: string, table: string) {
    const wb = this.load(itemId);
    this.workbooks.set(
      itemId,
      wb.filter((t) => t.name !== table),
    );
  }

  /** Test helper: simulate a person editing a cell in Excel. */
  editCell(itemId: string, table: string, rowKeyValue: string, header: string, value: unknown) {
    const t = this.load(itemId).find((x) => x.name === table)!;
    const col = t.headers.indexOf(header);
    const row = t.rows.find((r) => r.includes(rowKeyValue));
    if (!row || col < 0) throw new Error('Row or column not found');
    row[col] = value;
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
  async setTokens(id: string, tokens: string, scopes: string) {
    const s = this.sessions.get(id);
    if (s) Object.assign(s, { tokens, scopes });
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

export class FakeUserGraph implements UserGraph {
  constructor(public profile: GraphProfile | null = null) {}
  readonly sent: MailMessage[] = [];
  readonly events: CalendarEvent[] = [];
  fail = false;
  async getProfile(): Promise<GraphProfile> {
    if (!this.profile) throw new Error('No fake profile configured');
    return this.profile;
  }
  async sendMail(m: MailMessage): Promise<SendOutcome> {
    if (this.fail) return { status: 'failed', error: '403 ErrorAccessDenied', retryable: false };
    this.sent.push(m);
    return { status: 'accepted' };
  }
  async listEvents(startIso: string, endIso: string) {
    return this.events.filter((e) => e.start < endIso && e.end > startIso);
  }
  async createEvent(e: NewEvent) {
    if (this.fail) throw new Error('Calendar unavailable');
    const ev: CalendarEvent = {
      id: `evt-${this.events.length + 1}`,
      subject: e.subject,
      start: e.start,
      end: e.end,
      timeZone: e.timeZone,
      location: e.location,
      attendees: e.attendees.map((a) => ({ email: a, name: a, response: 'none' })),
      isOnline: e.online,
      joinUrl: null,
      webLink: null,
      isCancelled: false,
      organizer: 'me',
    };
    this.events.push(ev);
    return ev;
  }
  async updateEvent(id: string, patch: Partial<NewEvent>) {
    const ev = this.events.find((e) => e.id === id);
    if (!ev) throw new Error('Not found');
    Object.assign(ev, {
      ...(patch.subject ? { subject: patch.subject } : {}),
      ...(patch.start ? { start: patch.start } : {}),
      ...(patch.end ? { end: patch.end } : {}),
    });
    return ev;
  }
  async cancelEvent(id: string) {
    const ev = this.events.find((e) => e.id === id);
    if (ev) ev.isCancelled = true;
  }
}

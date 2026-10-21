import type { TableSnapshot } from '@chat360/core/workbook';

/**
 * Ports: everything the application needs from the outside world. Production adapters talk to
 * Microsoft Graph and the Coordinator Durable Object; development/test adapters are in-memory.
 */

export interface StoredDoc<T> {
  data: T;
  etag: string;
}

export type WriteCondition = { ifMatch: string } | { ifNoneMatch: '*' };

/** Thrown when a conditional write loses a race (HTTP 412 / 409 from OneDrive). */
export class PreconditionFailedError extends Error {
  override name = 'PreconditionFailedError';
}

/** JSON documents and files in the authorised OneDrive location. Paths are relative to the root. */
export interface DocStore {
  getJson<T>(path: string): Promise<StoredDoc<T> | null>;
  putJson<T>(path: string, data: T, condition: WriteCondition): Promise<{ etag: string }>;
  putFile(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    condition: WriteCondition,
  ): Promise<{ itemId: string; webUrl: string; etag: string }>;
  /** Immediate child folder names of a folder (for reconciliation). */
  listFolders(path: string): Promise<string[]>;
}

export interface WorkbookTable extends TableSnapshot {
  name: string;
  sheet: string;
}

export interface WorkbookWrite {
  sheet: string;
  table: string;
  patches: { row: number; values: unknown[] }[];
  appends: unknown[][];
}

export interface CellWrite {
  sheet: string;
  address: string;
  values: unknown[][];
}

/** Excel workbook operations on an existing OneDrive item. */
export interface WorkbookGateway {
  /** Returns the tables that exist; tables missing from the workbook are omitted. */
  readTables(itemId: string, tables: string[]): Promise<WorkbookTable[]>;
  /** Applies writes; returns per-table success so partial failures are visible. */
  write(
    itemId: string,
    writes: WorkbookWrite[],
    cells: CellWrite[],
  ): Promise<{ table: string; ok: boolean; error?: string }[]>;
}

export interface SessionRecord {
  /** SHA-256 of the cookie value; the raw value is never stored. */
  id: string;
  userId: string;
  tenantId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  authTime: number;
  /** AES-GCM encrypted Microsoft tokens (delegated), if any. */
  tokens: string | null;
  scopes: string;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  touch(id: string, now: number): Promise<void>;
  setTokens(id: string, tokens: string, scopes: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<number>;
}

export interface Coordination {
  /** Fixed-window counter. Returns false when the limit is exceeded. */
  rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  /** Acquires a named lease; false if someone else holds it. */
  acquireLease(name: string, owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLease(name: string, owner: string): Promise<void>;
  /** Stores a value once; returns the existing value if the key was already set. */
  remember(key: string, value: string, ttlSeconds: number): Promise<string | null>;
  /** Overwrites a remembered value. */
  store(key: string, value: string, ttlSeconds: number): Promise<void>;
  forget(key: string): Promise<void>;
  recordJobRun(run: JobRun): Promise<void>;
  recentJobRuns(limit: number): Promise<JobRun[]>;
  /** Removes expired sessions, counters, leases and memos. */
  purgeExpired(): Promise<void>;
}

export interface JobRun {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  stats: Record<string, number>;
  errors: string[];
}

export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

/** Outcome of a Graph send: `accepted` means Graph returned 202; delivery itself is not confirmed. */
export type SendOutcome =
  | { status: 'accepted' }
  | { status: 'not_configured'; reason: string }
  | { status: 'failed'; error: string; retryable: boolean };

/** App-only notification mail from the approved shared mailbox. */
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<SendOutcome>;
}

export interface GraphProfile {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  userType: string | null;
  accountEnabled: boolean | null;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  timeZone: string;
  location: string;
  attendees: { email: string; name: string; response: string }[];
  isOnline: boolean;
  joinUrl: string | null;
  webLink: string | null;
  isCancelled: boolean;
  organizer: string;
}

export interface NewEvent {
  subject: string;
  start: string;
  end: string;
  timeZone: string;
  attendees: string[];
  body: string;
  location: string;
  online: boolean;
}

/** Delegated Microsoft Graph operations performed as the signed-in employee. */
export interface UserGraph {
  getProfile(): Promise<GraphProfile>;
  sendMail(message: MailMessage): Promise<SendOutcome>;
  listEvents(startIso: string, endIso: string, timeZone: string): Promise<CalendarEvent[]>;
  createEvent(event: NewEvent): Promise<CalendarEvent>;
  updateEvent(id: string, patch: Partial<NewEvent>): Promise<CalendarEvent>;
  cancelEvent(id: string, comment: string): Promise<void>;
}

export interface AnalyticsSink {
  track(
    event: string,
    props: {
      userHash?: string;
      role?: string;
      projectId?: string;
      outcome?: string;
      value?: number;
    },
  ): void;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

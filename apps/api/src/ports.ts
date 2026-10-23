/**
 * Ports: everything the application needs from the outside world. Production adapters use
 * Cloudflare D1 and the Coordinator Durable Object; development/test adapters are in-memory.
 */

export interface StoredDoc<T> {
  data: T;
  etag: string;
}

export type WriteCondition = { ifMatch: string } | { ifNoneMatch: '*' };

/** Thrown when a conditional write loses a race (the document changed since it was read). */
export class PreconditionFailedError extends Error {
  override name = 'PreconditionFailedError';
}

/** JSON documents keyed by path. */
export interface DocStore {
  getJson<T>(path: string): Promise<StoredDoc<T> | null>;
  putJson<T>(path: string, data: T, condition: WriteCondition): Promise<{ etag: string }>;
  /** Immediate child "folder" names under a path prefix (for reconciliation). */
  listFolders(path: string): Promise<string[]>;
}

export interface SessionRecord {
  /** SHA-256 of the cookie value; the raw value is never stored. */
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  authTime: number;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  touch(id: string, now: number): Promise<void>;
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

/** Outcome of a send: `accepted` means the provider took the message; delivery is not confirmed. */
export type SendOutcome =
  | { status: 'accepted' }
  | { status: 'not_configured'; reason: string }
  | { status: 'failed'; error: string; retryable: boolean };

/** Notification mail. No provider is configured yet, so every send reports `not_configured`. */
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<SendOutcome>;
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

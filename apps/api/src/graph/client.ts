import { GraphError } from '../http/errors';
import type { Logger } from '../ports';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export type TokenProvider = () => Promise<string>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GraphRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path relative to the v1.0 root, starting with `/`. */
  path: string;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  /** Override default retry count (e.g. 0 for non-idempotent sends). */
  retries?: number;
  timeoutMs?: number;
}

export interface GraphClientOptions {
  token: TokenProvider;
  fetch?: FetchLike;
  log?: Logger;
  maxRetries?: number;
  /** Upper bound for a single wait, to stay within Worker time limits. */
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Thin Graph client. Retries throttling (429) and transient 5xx responses with Retry-After
 * honoured and exponential backoff otherwise. Only idempotent requests should keep the default
 * retry count; callers pass `retries: 0` for operations like sendMail.
 */
export class GraphClient {
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GraphClientOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxBackoffMs = opts.maxBackoffMs ?? 8000;
    this.sleep = opts.sleep ?? sleepDefault;
  }

  async raw(req: GraphRequest): Promise<Response> {
    const retries = req.retries ?? this.maxRetries;
    for (let attempt = 0; ; attempt++) {
      const token = await this.opts.token();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...req.headers };
      let body: BodyInit | undefined = req.rawBody;
      if (req.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(req.body);
      }
      let res: Response;
      try {
        res = await this.fetchImpl(`${GRAPH_BASE}${req.path}`, {
          method: req.method ?? 'GET',
          headers,
          body,
          signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
        });
      } catch (err) {
        if (attempt < retries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new GraphError(504, 'network_error', `Graph request failed: ${String(err)}`);
      }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < retries) {
        const ra = Number(res.headers.get('Retry-After'));
        const wait =
          Number.isFinite(ra) && ra > 0
            ? Math.min(ra * 1000, this.maxBackoffMs)
            : this.backoff(attempt);
        this.opts.log?.warn('graph_retry', {
          status: res.status,
          path: req.path.split('?')[0],
          attempt,
          wait,
        });
        await this.sleep(wait);
        continue;
      }
      return res;
    }
  }

  private backoff(attempt: number) {
    return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), this.maxBackoffMs);
  }

  async json<T>(req: GraphRequest): Promise<T> {
    const res = await this.raw(req);
    if (!res.ok) throw await toGraphError(res);
    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Graph JSON batching (max 20 per call). Requests run sequentially via `dependsOn` when
   * `sequential` is set, which the Excel API needs for writes to the same workbook.
   */
  async batch(
    requests: {
      id: string;
      method: string;
      url: string;
      body?: unknown;
      headers?: Record<string, string>;
    }[],
    sequential: boolean,
  ): Promise<Map<string, { status: number; body: unknown }>> {
    const out = new Map<string, { status: number; body: unknown }>();
    for (let i = 0; i < requests.length; i += 20) {
      const chunk = requests.slice(i, i + 20).map((r, j) => ({
        id: r.id,
        method: r.method,
        url: r.url,
        headers: {
          ...(r.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...r.headers,
        },
        ...(r.body !== undefined ? { body: r.body } : {}),
        ...(sequential && j > 0 ? { dependsOn: [requests[i + j - 1]!.id] } : {}),
      }));
      const res = await this.json<{ responses: { id: string; status: number; body: unknown }[] }>({
        method: 'POST',
        path: '/$batch',
        body: { requests: chunk },
      });
      for (const r of res.responses) out.set(r.id, { status: r.status, body: r.body });
    }
    return out;
  }
}

export async function toGraphError(res: Response): Promise<GraphError> {
  let code = `http_${res.status}`;
  let message = res.statusText || 'Graph error';
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = j.error?.code ?? code;
    message = j.error?.message ?? message;
  } catch {
    /* non-JSON error body */
  }
  const ra = Number(res.headers.get('Retry-After'));
  return new GraphError(
    res.status,
    code,
    message,
    res.headers.get('request-id') ?? undefined,
    Number.isFinite(ra) ? ra : undefined,
  );
}

/** Graph `$batch` sub-response error, normalised. */
export function batchError(status: number, body: unknown): GraphError {
  const e = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
  return new GraphError(status, e?.code ?? `http_${status}`, e?.message ?? 'Batch request failed');
}

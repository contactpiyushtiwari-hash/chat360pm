/** Error returned by the API, with the server's code, request ID and (for 5xx) an error ID. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> | undefined,
    public readonly requestId: string | undefined,
    public readonly errorId: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level validation messages, keyed by field path. */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {};
  }
}

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

type Listener = (e: ApiError) => void;
const authListeners = new Set<Listener>();
/** Lets the session layer react to an expired session anywhere in the app. */
export function onAuthError(l: Listener): () => void {
  authListeners.add(l);
  return () => {
    authListeners.delete(l);
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-Requested-With'] = 'chat360';
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      isOffline() ? 'offline' : 'network_error',
      isOffline() ? 'You appear to be offline.' : 'Could not reach the server.',
      undefined,
      undefined,
      undefined,
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (
      data as {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
          requestId?: string;
          errorId?: string;
        };
      } | null
    )?.error;
    const err = new ApiError(
      res.status,
      e?.code ?? `http_${res.status}`,
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
      e?.requestId,
      e?.errorId,
    );
    if (res.status === 401 || err.code === 'reauth_required') authListeners.forEach((l) => l(err));
    throw err;
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body, ...(idempotencyKey ? { idempotencyKey } : {}) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });

export function loginUrl(returnTo: string, prompt?: 'login') {
  const q = new URLSearchParams({ returnTo, ...(prompt ? { prompt } : {}) });
  return `/api/auth/login?${q.toString()}`;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/** GET a resource with loading/error state; aborts on unmount or path change. */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path, { signal: c.signal });
      if (!c.signal.aborted) setData(d);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (!c.signal.aborted)
        setError(
          e instanceof ApiError
            ? e
            : new ApiError(0, 'unknown', String(e), undefined, undefined, undefined),
        );
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/**
 * Runs a mutation with a single in-flight guard so double clicks cannot submit twice.
 * The same idempotency key is reused for retries of one logical action.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const inflight = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (inflight.current) return undefined;
      inflight.current = true;
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e
            : new ApiError(0, 'unknown', String(e), undefined, undefined, undefined),
        );
        return undefined;
      } finally {
        inflight.current = false;
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}

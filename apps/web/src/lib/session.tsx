import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, ApiError, onAuthError } from './api';
import type { DirectoryEntry, Me } from './types';
import { ErrorState, Spinner } from '../components/ui';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface SessionValue {
  status: Status;
  me: Me | null;
  error: ApiError | null;
  refresh: () => Promise<void>;
  directory: DirectoryEntry[];
  nameOf: (id: string | null | undefined) => string;
  reloadDirectory: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);

  const reloadDirectory = useCallback(async () => {
    try {
      setDirectory((await api<{ users: DirectoryEntry[] }>('/api/directory/users')).users);
    } catch {
      /* names fall back to ids; pages show their own errors */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/api/me');
      setMe(m);
      setStatus('authenticated');
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setStatus('anonymous');
      } else {
        setError(e as ApiError);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthError((e) => {
      if (e.status === 401) {
        setMe(null);
        setStatus('anonymous');
      }
    });
  }, [refresh]);

  useEffect(() => {
    if (status === 'authenticated') void reloadDirectory();
  }, [status, reloadDirectory]);

  const value = useMemo<SessionValue>(() => {
    const map = new Map(directory.map((u) => [u.id, u.displayName]));
    return {
      status,
      me,
      error,
      refresh,
      directory,
      reloadDirectory,
      nameOf: (id) =>
        id ? (map.get(id) ?? (id === 'system' ? 'System' : 'Unknown user')) : 'Unassigned',
    };
  }, [status, me, error, refresh, directory, reloadDirectory]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error('useMe requires an authenticated session');
  return me;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, refresh } = useSession();
  const loc = useLocation();
  if (status === 'loading')
    return (
      <div className="center-page">
        <Spinner label="Signing you in…" />
      </div>
    );
  if (status === 'anonymous')
    return (
      <Navigate to={`/login?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
    );
  if (status === 'error' && error)
    return (
      <div className="center-page">
        <ErrorState error={error} onRetry={refresh} title="Could not load your account" />
      </div>
    );
  return <>{children}</>;
}

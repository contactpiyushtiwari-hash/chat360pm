import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../lib/api';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant} ${rest.className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner spinner-sm" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function ButtonLink({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`btn btn-${variant}`}>
      <span>{children}</span>
    </Link>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Chat360 Ops`;
  }, [title]);
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

const TONES = {
  green: 'success',
  completed: 'success',
  done: 'success',
  synced: 'success',
  sent: 'success',
  resolved: 'success',
  approved: 'info',
  amber: 'warning',
  blocked: 'warning',
  pending: 'warning',
  syncing: 'info',
  in_progress: 'info',
  submitted: 'info',
  under_review: 'info',
  acknowledged: 'info',
  waiting_for_user: 'warning',
  red: 'danger',
  failed: 'danger',
  conflict: 'danger',
  open: 'danger',
  rejected: 'danger',
  critical: 'danger',
  high: 'warning',
  unknown: 'warning',
} as const;

export function Badge({ value, label }: { value: string; label?: string }) {
  const tone = (TONES as Record<string, string>)[value] ?? 'neutral';
  return <span className={`badge badge-${tone}`}>{label ?? value.replace(/_/g, ' ')}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        ○
      </div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Explains what went wrong and what to do next; never hides the error. */
export function recoveryText(e: ApiError): string {
  switch (e.code) {
    case 'offline':
      return 'Check your internet connection, then retry.';
    case 'network_error':
      return 'The server could not be reached. Retry in a moment.';
    case 'unauthenticated':
      return 'Your session has ended. Sign in again to continue.';
    case 'forbidden':
    case 'not_authorized':
      return 'You do not have permission for this. Ask your PM or an administrator if you need access.';
    case 'not_found':
      return 'It may have been moved, or you may not have access to it.';
    case 'graph_permission_denied':
      return 'Microsoft 365 refused the operation. An administrator needs to check the app permissions.';
    case 'graph_not_found':
      return 'The OneDrive file or folder is missing. Check whether it was moved or deleted.';
    case 'graph_throttled':
      return 'Microsoft 365 is busy. Wait a minute and retry.';
    case 'concurrent_update':
    case 'conflict':
      return 'Someone else changed this at the same time. Reload and try again.';
    case 'consent_required':
      return 'Connect Outlook to use this feature.';
    case 'rate_limited':
      return 'Too many requests. Wait a moment, then retry.';
    default:
      return e.status >= 500
        ? 'Please retry. If it keeps failing, raise a support request with the error ID.'
        : '';
  }
}

export function ErrorState({
  error,
  onRetry,
  title = 'Something went wrong',
}: {
  error: ApiError;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <h3>{title}</h3>
      <p>{error.message}</p>
      {recoveryText(error) && <p className="muted">{recoveryText(error)}</p>}
      {(error.errorId || error.requestId) && (
        <p className="mono small">
          {error.errorId ? `Error ID: ${error.errorId}` : `Request ID: ${error.requestId}`}
        </p>
      )}
      <div className="row">
        {onRetry && <Button onClick={onRetry}>Retry</Button>}
        {error.code === 'unauthenticated' && (
          <a
            className="btn btn-primary"
            href={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
          >
            Sign in
          </a>
        )}
        {error.status >= 500 && <ButtonLink to="/support?new=1">Get help</ButtonLink>}
      </div>
    </div>
  );
}

/** Inline error for forms and actions. */
export function InlineError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="inline-error" role="alert">
      <strong>{error.message}</strong>
      {recoveryText(error) && <span> {recoveryText(error)}</span>}
      {error.errorId && <span className="mono small"> ({error.errorId})</span>}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    required?: boolean;
  }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required,
      })}
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input className="input" {...p} />
);
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className="input" rows={3} {...p} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="input" {...p} />
);

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="checkbox">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </label>
    </div>
  );
}

/** Accessible modal dialog: labelled, focus moves in, Escape closes, focus returns on close. */
export function Dialog({
  title,
  open,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = [
          ...el.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input, select, textarea',
          ),
        ];
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            data-close
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (t: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={`tab ${value === t.id ? 'tab-active' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value);
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length]!.id);
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id);
          }}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      tone === 'error' ? 8000 : 4500,
    );
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

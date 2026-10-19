import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/telemetry';

interface State {
  error: Error | null;
}

/** Catches render errors, reports them, and shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(
      'boundary',
      Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }),
    );
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-page">
        <div className="error-state" role="alert">
          <h1>Something went wrong on this page</h1>
          <p>The error has been reported automatically. Reloading usually fixes it.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn btn-secondary" href="/">
              Go to dashboard
            </a>
            <a className="btn btn-ghost" href="/support?new=1">
              Report a problem
            </a>
          </div>
        </div>
      </div>
    );
  }
}

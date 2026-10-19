/**
 * Frontend crash reporting to the first-party /api/client-errors endpoint (no third-party vendor).
 * Messages are truncated here and redacted again on the server.
 */
let installed = false;
let sent = 0;

export function reportError(kind: 'error' | 'unhandledrejection' | 'boundary', error: unknown) {
  if (sent >= 20) return; // avoid flooding during an error loop
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  const payload = {
    kind,
    message: e.message.slice(0, 1000),
    stack: e.stack?.slice(0, 8000),
    route: location.pathname,
    release: __RELEASE__,
  };
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chat360' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}

export function installErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => reportError('error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) =>
    reportError('unhandledrejection', ev.reason),
  );
}

/** Allow-listed product usage events (see PRODUCT_EVENTS in @chat360/core). */
export function track(name: string, props: Record<string, string | number | boolean> = {}) {
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chat360' },
    credentials: 'same-origin',
    body: JSON.stringify({ name, props }),
  }).catch(() => undefined);
}

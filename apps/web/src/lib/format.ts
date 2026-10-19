const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Formats an ISO calendar date (YYYY-MM-DD) without timezone drift. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? d : dateFmt.format(date);
}

export function fmtInstant(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function pct(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v * 100)}%`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Formats a wall-clock "YYYY-MM-DDTHH:mm[:ss]" value without applying the browser's timezone. */
export function fmtWallTime(dt: string): { date: string; time: string } {
  return { date: fmtDate(dt.slice(0, 10)), time: dt.slice(11, 16) };
}

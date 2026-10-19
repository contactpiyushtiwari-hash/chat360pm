const SENSITIVE_KEY =
  /token|secret|password|passwd|authorization|cookie|verifier|^code$|assertion|body|content|description|notes|stack/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;

/** Masks email local parts and token-like strings in free text. */
export function redactText(s: string, max = 500): string {
  const out = s
    .replace(BEARER, '$1[REDACTED]')
    .replace(JWT, '[REDACTED_JWT]')
    .replace(EMAIL, '$1***@$2');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * Deep-redacts a log payload: sensitive keys are replaced, strings are masked and truncated.
 * Email bodies, notes and descriptions are never logged (PRD-SEC-009).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[DEPTH]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

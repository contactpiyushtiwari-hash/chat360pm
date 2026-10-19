import type { Coordinator } from './do/coordinator';

/** Cloudflare bindings and variables. Secrets are marked; see docs/deployment.md. */
export interface Env {
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  STORAGE_BACKEND?: string;
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  /** Secret. */
  ENTRA_CLIENT_SECRET?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  BOOTSTRAP_ADMIN_OIDS?: string;
  GRAPH_DRIVE_ID?: string;
  ONEDRIVE_ROOT_PATH?: string;
  NOTIFICATION_MAILBOX?: string;
  /** Secret: base64 of 32 random bytes. Encrypts stored Microsoft tokens. */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Secret: base64 of 32 random bytes. Signs/encrypts auth cookies and preview tokens. */
  COOKIE_SECRET?: string;
  DEV_AUTH?: string;
  RELEASE?: string;
  COORDINATOR: DurableObjectNamespace<Coordinator>;
  ANALYTICS?: AnalyticsEngineDataset;
}

export type Environment = 'development' | 'staging' | 'production';

export interface AppConfig {
  environment: Environment;
  appOrigin: string;
  release: string;
  storageBackend: 'graph' | 'memory';
  devAuth: boolean;
  entra: { tenantId: string; clientId: string; clientSecret: string } | null;
  allowedEmailDomains: string[];
  bootstrapAdminIds: string[];
  graph: { driveId: string; rootPath: string } | null;
  notificationMailbox: string | null;
  tokenKey: string;
  cookieSecret: string;
  secureCookies: boolean;
  sessionCookieName: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Parses and validates configuration. Fails closed: production refuses developer
 * authentication, in-memory storage, missing secrets or a non-HTTPS origin.
 */
export function loadConfig(env: Partial<Env>): AppConfig {
  const environment = (env.ENVIRONMENT ?? 'development') as Environment;
  if (!['development', 'staging', 'production'].includes(environment)) {
    throw new ConfigError(`Unknown ENVIRONMENT ${environment}`);
  }
  const devAuth = env.DEV_AUTH === 'enabled';
  const storageBackend = env.STORAGE_BACKEND === 'memory' ? 'memory' : 'graph';
  const appOrigin = (env.APP_ORIGIN ?? '').replace(/\/$/, '');
  const errors: string[] = [];

  if (environment !== 'development') {
    if (devAuth) errors.push('DEV_AUTH must be disabled outside development');
    if (storageBackend === 'memory')
      errors.push('STORAGE_BACKEND=memory is only allowed in development');
    if (!appOrigin.startsWith('https://')) errors.push('APP_ORIGIN must be an https:// origin');
  }
  if (!appOrigin) errors.push('APP_ORIGIN is required');

  const entra =
    env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET
      ? {
          tenantId: env.ENTRA_TENANT_ID,
          clientId: env.ENTRA_CLIENT_ID,
          clientSecret: env.ENTRA_CLIENT_SECRET,
        }
      : null;
  if (!entra && !devAuth)
    errors.push('ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET are required');

  const graph =
    env.GRAPH_DRIVE_ID && env.ONEDRIVE_ROOT_PATH
      ? { driveId: env.GRAPH_DRIVE_ID, rootPath: env.ONEDRIVE_ROOT_PATH.replace(/^\/+|\/+$/g, '') }
      : null;
  if (storageBackend === 'graph' && (!graph || !entra)) {
    errors.push(
      'GRAPH_DRIVE_ID, ONEDRIVE_ROOT_PATH and Entra credentials are required for graph storage',
    );
  }

  const keyOk = (k: string | undefined) => !!k && atobSafe(k)?.length === 32;
  if (!keyOk(env.TOKEN_ENCRYPTION_KEY))
    errors.push('TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes');
  if (!keyOk(env.COOKIE_SECRET)) errors.push('COOKIE_SECRET must be base64 of 32 bytes');

  if (errors.length) throw new ConfigError(`Invalid configuration: ${errors.join('; ')}`);

  const secureCookies = appOrigin.startsWith('https://');
  return {
    environment,
    appOrigin,
    release: env.RELEASE ?? 'dev',
    storageBackend,
    devAuth,
    entra,
    allowedEmailDomains: list(env.ALLOWED_EMAIL_DOMAINS).map((d) => d.toLowerCase()),
    bootstrapAdminIds: list(env.BOOTSTRAP_ADMIN_OIDS),
    graph,
    notificationMailbox: env.NOTIFICATION_MAILBOX?.trim() || null,
    tokenKey: env.TOKEN_ENCRYPTION_KEY!,
    cookieSecret: env.COOKIE_SECRET!,
    secureCookies,
    // __Host- requires Secure; plain name only for http://localhost development.
    sessionCookieName: secureCookies ? '__Host-c360_session' : 'c360_session',
  };
}

function atobSafe(b64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

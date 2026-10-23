import type { Coordinator } from './do/coordinator';

/** Cloudflare bindings and variables. Secrets are marked; see docs/deployment.md. */
export interface Env {
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  STORAGE_BACKEND?: string;
  /** Secret: one-time code that lets the first administrator create their account. */
  SETUP_CODE?: string;
  DEV_AUTH?: string;
  RELEASE?: string;
  DB: D1Database;
  COORDINATOR: DurableObjectNamespace<Coordinator>;
  ANALYTICS?: AnalyticsEngineDataset;
}

export type Environment = 'development' | 'staging' | 'production';

export interface AppConfig {
  environment: Environment;
  appOrigin: string;
  release: string;
  storageBackend: 'd1' | 'memory';
  devAuth: boolean;
  setupCode: string | null;
  secureCookies: boolean;
  sessionCookieName: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Parses and validates configuration. Fails closed: outside development it refuses developer
 * sign-in, in-memory storage, a non-HTTPS origin and a guessable setup code.
 */
export function loadConfig(env: Partial<Env>): AppConfig {
  const environment = (env.ENVIRONMENT ?? 'development') as Environment;
  if (!['development', 'staging', 'production'].includes(environment)) {
    throw new ConfigError(`Unknown ENVIRONMENT ${environment}`);
  }
  const devAuth = env.DEV_AUTH === 'enabled';
  const storageBackend = env.STORAGE_BACKEND === 'memory' ? 'memory' : 'd1';
  const appOrigin = (env.APP_ORIGIN ?? '').replace(/\/$/, '');
  const setupCode = env.SETUP_CODE?.trim() || null;
  const errors: string[] = [];

  if (environment !== 'development') {
    if (devAuth) errors.push('DEV_AUTH must be disabled outside development');
    if (storageBackend === 'memory')
      errors.push('STORAGE_BACKEND=memory is only allowed in development');
    if (!appOrigin.startsWith('https://')) errors.push('APP_ORIGIN must be an https:// origin');
    if (setupCode && setupCode.length < 12)
      errors.push('SETUP_CODE must be at least 12 characters');
  }
  if (!appOrigin) errors.push('APP_ORIGIN is required');

  if (errors.length) throw new ConfigError(`Invalid configuration: ${errors.join('; ')}`);

  const secureCookies = appOrigin.startsWith('https://');
  return {
    environment,
    appOrigin,
    release: env.RELEASE ?? 'dev',
    storageBackend,
    devAuth,
    setupCode,
    secureCookies,
    // __Host- requires Secure; plain name only for http://localhost development.
    sessionCookieName: secureCookies ? '__Host-c360_session' : 'c360_session',
  };
}

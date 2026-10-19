import { AuthError } from '../http/errors';
import type { AppContext } from '../http/context';
import { requireUser } from '../http/context';
import type { UserGraph } from '../ports';
import { decryptJson, encryptJson } from './crypto';
import { BASE_SCOPES, OUTLOOK_SCOPES, type TokenSet } from './oidc';

export const TOKEN_PURPOSE = 'graph-tokens-v1';

export function hasOutlookConsent(scopes: string) {
  const granted = scopes.toLowerCase().split(/\s+/);
  return OUTLOOK_SCOPES.every((s) =>
    granted.some((g) => g === s.toLowerCase() || g.endsWith(`/${s.toLowerCase()}`)),
  );
}

/**
 * Delegated Graph access as the signed-in employee. Tokens are stored encrypted in the session
 * (never sent to the browser) and refreshed server-side when close to expiry.
 */
export async function userGraph(c: AppContext, opts: { needOutlook: boolean }): Promise<UserGraph> {
  requireUser(c);
  const deps = c.get('deps');
  const session = c.get('session')!;
  if (opts.needOutlook && !hasOutlookConsent(session.scopes)) {
    throw new AuthError('consent_required', 'Connect Outlook to use email and calendar features.');
  }
  if (!session.tokens) throw new AuthError('unauthenticated', 'Please sign in again.');
  const tokens = await decryptJson<TokenSet>(deps.config.tokenKey, TOKEN_PURPOSE, session.tokens);
  if (!tokens) throw new AuthError('unauthenticated', 'Please sign in again.');
  if (tokens.expiresAt - 120_000 > deps.clock().getTime() || !deps.oidc) {
    return deps.userGraphFor(tokens.accessToken);
  }
  if (!tokens.refreshToken)
    throw new AuthError('unauthenticated', 'Your session expired. Please sign in again.');
  const scopes = hasOutlookConsent(session.scopes)
    ? [...BASE_SCOPES, ...OUTLOOK_SCOPES]
    : BASE_SCOPES;
  const fresh = await deps.oidc.refresh(tokens.refreshToken, scopes);
  const stored: TokenSet = { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
  delete stored.idToken;
  await deps.sessions.setTokens(
    session.id,
    await encryptJson(deps.config.tokenKey, TOKEN_PURPOSE, stored),
    fresh.scope || session.scopes,
  );
  return deps.userGraphFor(fresh.accessToken);
}

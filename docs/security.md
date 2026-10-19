# Security

Scope: the Chat360 Project Operations web app (`apps/web`), API Worker (`apps/api`), Coordinator Durable Object, and the Microsoft 365 data they touch. Items marked **pending** need action by Chat360 IT or a Cloudflare account owner; they have not been done.

## Authentication

- Microsoft Entra ID, single tenant (`ENTRA_TENANT_ID`), authorization-code flow with PKCE; the Worker is a confidential client (`ENTRA_CLIENT_SECRET`, stored as a Worker secret).
- ID token verified with the tenant JWKS (RS256), issuer `https://login.microsoftonline.com/<tenant>/v2.0`, audience = client id, nonce, `tid` = tenant, 2-minute clock tolerance. State and PKCE verifier travel in an AES-GCM encrypted, 10-minute, `SameSite=Lax` cookie scoped to `/api/auth`.
- After token exchange the API calls `/me` and refuses `userType != Member`, `#EXT#` (guest) UPNs and `accountEnabled = false`. The email domain must be in `ALLOWED_EMAIL_DOMAINS` (e.g. `chat.io`) — a consistency check, **never** an authorisation or privilege grant.
- **Recommended (pending):** in Entra, set the enterprise app to _Assignment required = Yes_ and assign the employee security group, so non-assigned accounts cannot even obtain a token.
- No local passwords exist.

## Sessions

- 256-bit random cookie `__Host-c360_session` (HttpOnly, Secure, SameSite=Strict, Path=/), 12 h absolute lifetime, 8 h idle timeout. Only `SHA-256(cookie)` is stored (Coordinator SQLite).
- Delegated Microsoft tokens are encrypted with AES-256-GCM (HKDF-derived, purpose-separated key from `TOKEN_ENCRYPTION_KEY`) and never sent to the browser. Refresh happens server-side.
- Revocation: logout deletes the session; admin deactivation and approved account requests delete all of a user's sessions immediately. Every request re-checks the user's directory status (≤30 s cache per isolate).
- Re-authentication (sign-in within 15 minutes) is required for account deactivation.

## Authorisation

- Global roles assigned by admins: `admin`, `delivery_head`, `pm`, `tech`, `fde`, `sales_poc`, `csm`. New users start with **no roles**.
- Project access ladder evaluated server-side on every request: portfolio (Delivery Head role) > manager (current PM / project's Delivery Head) > contributor (team member or task owner) > read (former PM inside the retention window) > none. See `packages/core/src/rbac.ts` and ADR-010.
- Administrators have **no implicit project data access**.
- Inaccessible projects return 404 (no existence leak).
- Bootstrap admins are named by Entra object id (`BOOTSTRAP_ADMIN_OIDS`), never by email. They receive admin only on first sign-in or when no active admin exists (lock-out recovery). Admins cannot remove their own admin role or deactivate themselves.

## Microsoft Graph permissions (least privilege)

| Permission                                      | Type        | Why                                                                          | Approval                                                                                         |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `openid profile email offline_access User.Read` | Delegated   | Sign-in, profile check                                                       | User consent                                                                                     |
| `Mail.Send`                                     | Delegated   | Send email as the user (on request)                                          | Incremental; may need admin consent per tenant policy                                            |
| `Calendars.ReadWrite`                           | Delegated   | View/create meetings as the user                                             | Incremental; as above                                                                            |
| `Sites.Selected`                                | Application | Read/write only the approved SharePoint site/library holding project folders | **Admin consent + site-specific grant (pending)**                                                |
| `Mail.Send`                                     | Application | Notifications/reminders from one shared mailbox                              | **Admin consent + Exchange `New-ApplicationAccessPolicy` restricting to that mailbox (pending)** |

Not requested: `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Mail.ReadWrite`, `User.Read.All`, directory write permissions. The app cannot delete Microsoft identities.

## Secure configuration

- Secrets (Worker secrets only, never in git): `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `COOKIE_SECRET` (each key: 32 random bytes, base64).
- `loadConfig` fails closed: outside `development` it rejects `DEV_AUTH=enabled`, `STORAGE_BACKEND=memory`, non-HTTPS `APP_ORIGIN`, and missing/short secrets; the Worker answers `503 service_misconfigured` and logs the reason.
- Developer sign-in routes are not registered unless `ENVIRONMENT=development` and `DEV_AUTH=enabled`.
- `.gitignore` excludes `.dev.vars` and `.env*`. CI does not need secrets for checks; deployment secrets live in GitHub environment secrets.

## Web protections

- **CSRF:** SameSite=Strict cookies + mandatory `X-Requested-With: chat360` on writes + same-origin `Origin` check.
- **XSS:** React escaping; no `dangerouslySetInnerHTML`; user-supplied links accepted only as `http(s)` URLs (zod `safeUrl`) and opened with `rel="noopener noreferrer"`. CSP via `apps/web/public/_headers`: `default-src 'self'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'` (inline style attributes are used only for computed Gantt/bar geometry), `frame-ancestors 'none'`, `object-src 'none'`.
- **Other headers:** HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; API responses `Cache-Control: no-store`.
- **Open redirects:** `returnTo` must be a same-origin path (`//` and `/\` rejected).
- **Injection:** no SQL; OneDrive paths are built from validated ids and sanitised folder names (`safeFolderName`), destinations come only from admin configuration and reject `..`/`.` segments; Graph path segments are URL-encoded.
- **SSRF:** the Worker only calls fixed Microsoft hosts and the pre-authenticated download URLs Graph returns; no user-supplied URLs are fetched.

## Data handling and privacy

- Business records live in Chat360's OneDrive/SharePoint, inside the tenant.
- Email **bodies are not stored**; project communications keep subject, recipients, status and time only.
- API dependency fields reject text that looks like credentials (key/secret/password/token patterns, JWTs, live/test keys).
- Logs: deep redaction of keys matching token/secret/password/authorization/cookie/verifier/body/content/description/notes/stack; bearer tokens and JWTs scrubbed; email local parts masked. Client error reports are truncated, redacted, and route query strings dropped.
- Product analytics carry event names and coarse dimensions with an HMAC of the user id — no content, emails or tokens.
- Account deactivation never deletes workbooks, client documents or history.

## Email and calendar safety

- Previews are signed (HMAC over sender, recipients, subject and final body, 30-minute expiry); sends must match exactly and each preview can be sent once.
- External recipients/attendees require explicit confirmation in the UI and are re-checked server-side against `ALLOWED_EMAIL_DOMAINS`.
- Automated tests never send real email (recording adapters only).

## Audit logging

- Per project (`project.json` → `audit`, `teamHistory`, transfer `history`, task `history`, escalation `levelHistory`): task, team, escalation, transfer, workbook-conflict and email events.
- Organisation (`_system/audit/YYYY-MM.json`): first sign-in, bootstrap admin, role/status changes, config changes, deactivation requests and decisions.
- Audit entries are append-only in application code; OneDrive version history provides an additional trail.

## Rate limiting

Per-user/IP fixed windows in the Coordinator (see `docs/api_guidelines.md`). Optional: add a Cloudflare WAF rate-limit rule on `/api/auth/*` (pending).

## Vulnerability management

- Dependencies are pinned in `pnpm-lock.yaml`; CI runs `pnpm audit --prod` (non-blocking report) — review weekly.
- Enable GitHub Dependabot alerts and secret scanning on the repository (pending: repo admin).
- Keep `compatibility_date` current when upgrading Workers runtime features.

## Residual risks (known, accepted for now)

1. **Directory/role cache:** a role removal reaches other isolates within ~30 s (deactivation is immediate via session revocation).
2. **Excel overwrite window:** a cell edited in Excel in the seconds between our read and write of that row can be overwritten (ADR-006).
3. **App-only `Sites.Selected` write:** a compromised Worker secret could modify files in the granted site. Mitigate with secret rotation, Cloudflare account MFA, and limiting the grant to one site.
4. **Notification delivery:** `sent` means Graph accepted the message, not that it was delivered.
5. **Former-PM read access:** 30 days by default — confirm with Chat360 policy.
6. **No formal penetration test or accessibility audit has been performed.**

## Incident response

1. **Contain:** disable a faulty scheduled job instantly via Admin → Configuration → `disabledJobs`; for a severe issue roll back the Worker (`wrangler rollback`) or disable the Pages deployment.
2. **Revoke:** deactivate affected users (sessions end immediately); rotate `ENTRA_CLIENT_SECRET` in Entra and `wrangler secret put`; rotating `TOKEN_ENCRYPTION_KEY`/`COOKIE_SECRET` signs everyone out.
3. **Investigate:** Workers Logs by `requestId`/`errorId`; Admin → Scheduled jobs; project and org audit logs; OneDrive version history to restore documents.
4. **Recover:** restore a `project.json` or tracker from OneDrive version history; run "reconcile" to rebuild the project index; "Retry execution" for interrupted transfers; "Sync now" for trackers.
5. **Communicate** to the Delivery and Operations Head and IT; record the incident and follow-up ADR if a decision changes.

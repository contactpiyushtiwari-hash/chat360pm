# Security

Scope: the Chat360 Project Operations web app (`apps/web`), the API (`apps/api`) running in one Cloudflare Worker, its D1 database and the Coordinator Durable Object. Items marked **pending** need action by a Cloudflare account owner or repository admin; they have not been done.

## Authentication (ADR-022)

- Email + password. Accounts are created by administrators; there is no self-registration.
- New employees and password resets use a **one-time set-password link** (7-day expiry). The 256-bit token sits in the URL fragment, so it is not sent to the server until the form posts it and is not written to request logs; only its SHA-256 is stored; using it deletes it.
- The first administrator signs up on the login page with the `SETUP_CODE` secret (12+ characters required outside development). Setup is refused once any active administrator has a password; it reopens only if every administrator is deactivated or has no password (lock-out recovery).
- Passwords: PBKDF2-HMAC-SHA256, 100,000 iterations (the Workers runtime maximum), 128-bit random salt per hash, 256-bit output, constant-time comparison. Length 10–200, no composition rules. Hashes are stored in `_system/credentials.json`, separate from the directory, and never returned by the API.
- Login gives one generic message for unknown email and wrong password, and verifies a dummy hash when the email is unknown so response time does not reveal accounts. Deactivated accounts are refused.
- Rate limits: 30 login attempts per IP per 10 minutes and 10 per email per 15 minutes; 5 setup attempts per IP per hour; 20 set-password attempts per IP per hour; 10 password changes per user per 15 minutes.
- Changing a password requires the current one. Setting or changing a password signs out the user's other sessions.
- **Not provided:** multi-factor authentication and self-service reset email. Recommended hardening (pending): put **Cloudflare Access** (free for small teams) in front of the Worker to add SSO/MFA.

## Sessions

- 256-bit random cookie `__Host-c360_session` (HttpOnly, Secure, SameSite=Strict, Path=/), 12 h absolute lifetime, 8 h idle timeout. Only `SHA-256(cookie)` is stored (Coordinator SQLite).
- Revocation: logout deletes the session; admin deactivation, approved account requests and password changes delete a user's sessions immediately. Every request re-checks the user's directory status (≤30 s cache per isolate).
- Re-authentication (sign-in within 15 minutes) is required for account deactivation.

## Authorisation

- Global roles assigned by admins: `admin`, `delivery_head`, `pm`, `tech`, `fde`, `sales_poc`, `csm`. Roles are chosen explicitly when an admin adds someone and are **never** derived from an email domain.
- Project access ladder evaluated server-side on every request: portfolio (Delivery Head role) > manager (current PM / project's Delivery Head) > contributor (team member or task owner) > read (former PM inside the retention window) > none. See `packages/core/src/rbac.ts` and ADR-010.
- Administrators have **no implicit project data access**. Admins cannot remove their own admin role or deactivate themselves.
- Inaccessible projects return 404 (no existence leak), including the tracker download and email-template endpoints.

## Secure configuration

- The only secret is `SETUP_CODE` (Worker secret, never in git). `APP_ORIGIN` is a plain variable.
- `loadConfig` fails closed: outside `development` it rejects `DEV_AUTH=enabled`, `STORAGE_BACKEND=memory`, a non-HTTPS `APP_ORIGIN` and a short `SETUP_CODE`; the Worker answers `503 service_misconfigured` and logs the reason. A missing D1 binding also fails closed.
- Developer sign-in routes are not registered unless `ENVIRONMENT=development` and `DEV_AUTH=enabled`.
- `.gitignore` excludes `.dev.vars` and `.env*`. CI needs no secrets.

## Web protections

- **CSRF:** SameSite=Strict cookies + mandatory `X-Requested-With: chat360` on writes + same-origin `Origin` check.
- **XSS:** React escaping; no `dangerouslySetInnerHTML`; user-supplied links accepted only as `http(s)` URLs (zod `safeUrl`) and opened with `rel="noopener noreferrer"`. CSP via `apps/web/public/_headers`: `default-src 'self'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'` (inline style attributes are used only for computed Gantt/bar geometry), `frame-ancestors 'none'`, `object-src 'none'`.
- **Other headers:** HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; API responses `Cache-Control: no-store`.
- **Open redirects:** `returnTo` must be a same-origin path (`//` and `/\` rejected).
- **Injection:** D1 queries are fixed statements with bound parameters; document paths are built from validated ids and sanitised names. The tracker download filename is reduced to safe characters.
- **SSRF:** the Worker makes no outbound requests.

## Project finance

- Finance figures are visible to the PM, the project's Delivery Head, users with the Delivery Head role, the Sales POC (all may edit) and the CSM (view only). Tech Team, FDE, former PMs and administrators do not receive them: the API removes amounts from the project, from `finance.updated` audit entries, from transfer handover snapshots and from the **downloaded tracker's Finance sheet** (`redactFinance`).
- Residual risk: a downloaded tracker is an ordinary file; once someone with finance access shares it, the app cannot control it.

## Data handling and privacy

- Business records live in Chat360's own D1 database inside its Cloudflare account.
- API dependency fields reject text that looks like credentials (key/secret/password/token patterns, JWTs, live/test keys).
- Logs: deep redaction of keys matching token/secret/password/authorization/cookie/verifier/body/content/description/notes/stack; bearer tokens and JWTs scrubbed; email local parts masked. Client error reports are truncated, redacted, and route query strings dropped.
- Product analytics carry event names and coarse dimensions with a hash of the (random UUID) user id: no content, emails or tokens.
- No email is sent by the app. Email drafts are handed to the user's own mail app; nothing about them is stored.
- Account deactivation never deletes projects, client documents or history.

## Audit logging

- Per project (`project.json` → `audit`, `teamHistory`, transfer `history`, task `history`, escalation `levelHistory`): task, team, escalation, transfer and finance events.
- Organisation (`_system/audit/YYYY-MM.json`): first-admin setup, users created, set-password links issued, passwords set and changed, role/status changes, config changes, deactivation requests and decisions.
- Audit entries are append-only in application code; D1 Time Travel provides point-in-time history.

## Vulnerability management

- Dependencies are pinned in `pnpm-lock.yaml`; CI runs `pnpm audit --prod` (non-blocking report): review weekly.
- Enable GitHub Dependabot alerts and secret scanning on the repository (pending: repo admin). Enable MFA on the Cloudflare account (pending).
- Keep `compatibility_date` current when upgrading Workers runtime features.

## Residual risks (known, accepted for now)

1. **Passwords without MFA:** a reused or phished password gives that user's access. Mitigate with Cloudflare Access (pending).
2. **PBKDF2:** weaker than Argon2/scrypt against offline cracking if the database leaked; it is the strongest option the Workers runtime provides natively.
3. **Set-password links are handed over by an admin:** whoever receives the link can set the password. Send it privately.
4. **Directory/role cache:** a role removal reaches other isolates within ~30 s (deactivation is immediate via session revocation).
5. **Notifications:** no mail provider, so nobody is emailed about escalations; people must check the app.
6. **Former-PM read access:** 30 days by default; confirm with Chat360 policy.
7. **No formal penetration test or accessibility audit has been performed.**

## Incident response

1. **Contain:** disable a faulty scheduled job via Admin → Configuration → `disabledJobs`; for a severe issue roll back the Worker (dashboard → Deployments, or `wrangler rollback`).
2. **Revoke:** deactivate affected users (sessions end immediately). A compromised password: issue a new set-password link; using it signs out every other session.
3. **Investigate:** Workers Logs by `requestId`/`errorId`; Admin → Scheduled jobs; project and organisation audit logs.
4. **Recover:** D1 Time Travel to restore the database to a point before the incident; run "reconcile" to rebuild the project index; "Retry execution" for interrupted transfers.
5. **Communicate** to the Delivery and Operations Head; record the incident and a follow-up ADR if a decision changes.

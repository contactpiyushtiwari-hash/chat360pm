# API Guidelines

The API is a Hono app (`apps/api`) running in the same Cloudflare Worker that serves the website, at same-origin `/api/*` (ADR-020). All endpoints listed under **Implemented** exist in code and are exercised by tests in `apps/api/test`; none has yet been verified on a deployed Worker.

## Conventions

- JSON in and out; `Content-Type: application/json`. Dates are `YYYY-MM-DD` in the org timezone; instants are ISO-8601 UTC.
- **Authentication:** session cookie (`__Host-c360_session`, HttpOnly, Secure, SameSite=Strict). No bearer tokens from browsers.
- **CSRF:** every non-GET request must send `X-Requested-With: chat360`; a present `Origin` must equal `APP_ORIGIN`. Violations → `403 csrf_rejected`.
- **Authorisation:** checked server-side for every request against the latest project document (`packages/core/src/rbac.ts`). Projects the caller cannot access → `404`.
- **Validation:** zod schemas in `packages/core/src/schemas.ts`. Unknown fields on task updates are rejected (`.strict()`).
- **Idempotency:** creates require `Idempotency-Key` (8–80 chars, `[A-Za-z0-9_-]`). A repeat returns the original entity with `200` (`replayed: true` where applicable).
- **Concurrency:** writes use eTag compare-and-swap on the D1 row with retries (ADR-021); exhausted retries → `409 concurrent_update`. Task updates may send `expectedUpdatedAt` → `409 conflict` if stale.
- **Rate limits (fixed window, per user unless noted):** project creation 20/h; support 10/h; deactivation 5/h; password change 10 per 15 min; tracker download 30 per 10 min; product events 120/min; client errors 30/min per IP; login 30 per 10 min per IP and 10 per 15 min per email; first-admin setup 5/h per IP; set-password 20/h per IP. → `429 rate_limited`.
- **Correlation:** responses carry `X-Request-Id` (an incoming valid `X-Request-Id` is reused). Server errors add an `errorId` (`ERR-…`) logged with the cause.
- **Caching:** all API responses are `Cache-Control: no-store`.

### Error format

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields are invalid.",
    "details": { "fields": { "reason": "Reason is required" } },
    "requestId": "…",
    "errorId": "ERR-…"
  }
}
```

| HTTP | code                                                                                  | Meaning                                              |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 400  | `link_invalid`                                                                        | Set-password link expired or already used            |
| 401  | `unauthenticated`, `invalid_credentials`                                              | No/expired session, or wrong email/password          |
| 403  | `forbidden`, `not_authorized`, `reauth_required`, `account_inactive`, `csrf_rejected` | Not permitted / needs action                         |
| 404  | `not_found`                                                                           | Missing or not visible                               |
| 409  | `conflict`, `invalid_transition`, `concurrent_update`, `in_progress`                  | State conflict                                       |
| 412  | `precondition_failed`                                                                 | Business precondition (e.g. transfer projects first) |
| 422  | `validation_failed`                                                                   | Input invalid (`details.fields`)                     |
| 429  | `rate_limited`                                                                        | Too many requests                                    |
| 500  | `internal_error`                                                                      | Unexpected; see `errorId`                            |
| 503  | `service_misconfigured`                                                               | Configuration problem (see logs)                     |

## Implemented endpoints

### Auth and session

| Method   | Path                                         | Notes                                                                                                                  |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/auth/config`                           | `{ devAuth, setupAvailable, environment }`                                                                             |
| POST     | `/api/auth/login`                            | `{ email, password }` → session cookie, `{ ok, onboarded }`. Wrong or unknown → `401 invalid_credentials` (same text). |
| POST     | `/api/auth/setup`                            | First administrator: `{ setupCode, email, displayName, password }` → `201`. Only while no active admin can sign in.    |
| POST     | `/api/auth/set-password`                     | `{ token, password }` from a set-password link → session; signs out other sessions. Used/expired → `400 link_invalid`. |
| POST     | `/api/auth/logout`                           | `{ ok }`                                                                                                               |
| GET/POST | `/api/auth/dev-users`, `/api/auth/dev-login` | **Development only**; not registered otherwise.                                                                        |
| GET      | `/api/me`                                    | User, permissions, onboarding status, environment, timezone, today.                                                    |
| PATCH    | `/api/me/onboarding`                         | `{ completeSteps[], skipSteps[] }`                                                                                     |
| GET      | `/api/directory/users`                       | Active employees `{ id, displayName, email, roles }` for pickers.                                                      |

### Projects, tasks, APIs, escalations, tracker

| Method | Path                                                             | Permission                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/templates`                                        | signed in                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/api/projects`                                                  | lists only accessible projects (index entries + `access`)                                                                                                                                                                                                                                                                                                               |
| POST   | `/api/projects`                                                  | PM or Delivery Head role; `Idempotency-Key`; returns `{ project }` (`201`)                                                                                                                                                                                                                                                                                              |
| GET    | `/api/projects/:id`                                              | read access; project without internal fields + `summary`, `access`, `permissions`                                                                                                                                                                                                                                                                                       |
| PATCH  | `/api/projects/:id`                                              | manager (`updateProjectSchema`)                                                                                                                                                                                                                                                                                                                                         |
| PUT    | `/api/projects/:id/team`                                         | manager; PM cannot be changed here                                                                                                                                                                                                                                                                                                                                      |
| PUT    | `/api/projects/:id/finance`                                      | PM, Delivery Head or Sales POC; `{ currency, raisedOverdueForGoLive, raisableImmediately, toBeRaised, remarks, expectedUpdatedAt? }`; returns the presented project. Project responses include `finance` (plus `total` computed client-side) only when `permissions.viewFinance` is true; amounts are also removed from audit entries and transfer snapshots otherwise. |
| GET    | `/api/projects/:id/history`                                      | read                                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/api/projects/:id/handover`                                     | manager or portfolio                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/api/projects/:id/tasks`                                        | manager; `Idempotency-Key`                                                                                                                                                                                                                                                                                                                                              |
| PATCH  | `/api/projects/:id/tasks/:taskId`                                | manager (any field) or owner (execution fields)                                                                                                                                                                                                                                                                                                                         |
| POST   | `/api/projects/:id/tasks/:taskId/comments`                       | owner/manager                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/api/projects/:id/tasks/:taskId/confirm`                        | owner or manager; `{ outcome: 'completed', notes, evidenceUrl? }` or `{ outcome: 'not_completed', reasonCategory, reason, impact, nextAction, revisedEta }`                                                                                                                                                                                                             |
| POST   | `/api/projects/:id/apis` / PATCH `/api/projects/:id/apis/:apiId` | PM/Tech/FDE; credential-like text rejected                                                                                                                                                                                                                                                                                                                              |
| POST   | `/api/projects/:id/escalations/:escId/acknowledge` / `resolve`   | escalation manager, PM or Delivery Head                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/projects/:id/tracker.xlsx`                                 | read; the Excel tracker generated now from the project (`attachment`); Finance sheet empty without finance access                                                                                                                                                                                                                                                       |

### Transfers

| Method | Path                                             | Permission                                                                                           |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST   | `/api/projects/:id/transfers`                    | current PM; `{ proposedPmId, reason, requestedEffectiveDate, handoverNotes, submit }`                |
| GET    | `/api/projects/:id/transfers/:tid`               | involved users, manager, portfolio                                                                   |
| POST   | `…/transfers/:tid/submit`                        | requester                                                                                            |
| POST   | `…/transfers/:tid/review` / `approve` / `reject` | Delivery Head role (`approve`: `{ newPmId?, notes }`, `reject`: `{ reason }`)                        |
| POST   | `…/transfers/:tid/cancel`                        | requester or Delivery Head                                                                           |
| POST   | `…/transfers/:tid/retry`                         | Delivery Head; resumes execution                                                                     |
| POST   | `/api/projects/:id/reassign-pm`                  | Delivery Head; `{ newPmId, reason, effectiveDate, handoverNotes, confirm: true }`; `Idempotency-Key` |

### Cross-project, analytics, support, account

| Method   | Path                                                                      | Notes                                                          |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| GET      | `/api/today`                                                              | Caller's tasks due today/overdue + next 7 days + delay reasons |
| GET      | `/api/escalations`                                                        | Scoped open escalations (from index summaries)                 |
| GET      | `/api/transfers`                                                          | Scoped transfers; `canReview`                                  |
| GET      | `/api/analytics`                                                          | `{ scope: 'portfolio'                                          | 'mine', truncated, analytics }` (max 300 projects read) |
| GET/POST | `/api/support`, GET/PATCH `/api/support/:sid`                             | Reporter/admin visibility rules                                |
| GET/POST | `/api/account/deactivation`, POST `/api/account/deactivation/:rid/cancel` | POST needs sign-in ≤15 min                                     |
| POST     | `/api/account/password`                                                   | `{ currentPassword, newPassword }`; signs out other sessions   |

### Email drafts

| Method | Path                              | Notes                                                                                     |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/email/templates?projectId=` | Templates filled from a project the caller can see (404 otherwise). Nothing is sent here. |

### Admin

`GET /api/admin/users` (adds `passwordSet`), `POST /api/admin/users` (`{ email, displayName, roles }` → `{ user, setupLink: { url, expiresAt } }`, `409` if the email exists), `POST /api/admin/users/:uid/setup-link` (new one-time link, e.g. forgotten password), `PUT /api/admin/users/:uid` (`roles`, `status`), `GET|PUT /api/admin/config`, `GET /api/admin/account-requests`, `POST /api/admin/account-requests/:rid/approve|reject`, `GET /api/admin/jobs`, `POST /api/admin/jobs/:name/run`, `GET /api/admin/audit?month=YYYY-MM`, `GET /api/admin/health`.

### Telemetry

`GET /api/health` (public, no secrets), `POST /api/client-errors` (no auth, 30/min/IP), `POST /api/events` (allow-listed names).

## Proposed (not implemented)

- `POST /api/projects/:id/tracker/import` — accept selected edits from a downloaded tracker (needs Chat360 ownership rules).
- An email provider for notifications and password-reset emails.
- `GET /api/projects/:id/export` — full JSON export for audits.

## Testing conventions

- `packages/core/test` — pure domain tests (no I/O).
- `apps/api/test` — the real Hono app via `app.request()` with in-memory adapters (`apps/api/dev/memory-deps.ts`); `d1-store.test.ts` runs the D1 adapter's SQL on Node's SQLite (**not** real D1).
- `apps/web/test` — component/route tests in jsdom; `apps/web/e2e` — Playwright against the dev API and production build.
- The app sends no email; the dev/test mailers only record, to test notification bookkeeping.

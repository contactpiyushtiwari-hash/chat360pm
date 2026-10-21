# API Guidelines

The API is a Hono app running on a Cloudflare Worker (`apps/api`), reached by the browser at same-origin `/api/*` through the Pages Function proxy (ADR-002). All endpoints listed under **Implemented** exist in code and are exercised by tests in `apps/api/test`; none has yet been verified against the live Chat360 tenant.

## Conventions

- JSON in and out; `Content-Type: application/json`. Dates are `YYYY-MM-DD` in the org timezone; instants are ISO-8601 UTC.
- **Authentication:** session cookie (`__Host-c360_session`, HttpOnly, Secure, SameSite=Strict). No bearer tokens from browsers.
- **CSRF:** every non-GET request must send `X-Requested-With: chat360`; a present `Origin` must equal `APP_ORIGIN`. Violations → `403 csrf_rejected`.
- **Authorisation:** checked server-side for every request against the latest project document (`packages/core/src/rbac.ts`). Projects the caller cannot access → `404`.
- **Validation:** zod schemas in `packages/core/src/schemas.ts`. Unknown fields on task updates are rejected (`.strict()`).
- **Idempotency:** creates require `Idempotency-Key` (8–80 chars, `[A-Za-z0-9_-]`). A repeat returns the original entity with `200` (`replayed: true` where applicable).
- **Concurrency:** writes use OneDrive eTag compare-and-swap with retries; exhausted retries → `409 concurrent_update`. Task updates may send `expectedUpdatedAt` → `409 conflict` if stale.
- **Rate limits (fixed window, per user unless noted):** project creation 20/h; email send 30/h; meetings 30/h; support 10/h; deactivation 5/h; product events 120/min; workbook create/sync 10 per project per 10 min; client errors 30/min per IP; sign-in 30/min per IP. → `429 rate_limited`.
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

| HTTP    | code                                                                                                                         | Meaning                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 401     | `unauthenticated`                                                                                                            | No/expired session                                   |
| 403     | `forbidden`, `not_authorized`, `reauth_required`, `consent_required`, `account_inactive`, `csrf_rejected`                    | Not permitted / needs action                         |
| 404     | `not_found`                                                                                                                  | Missing or not visible                               |
| 409     | `conflict`, `invalid_transition`, `concurrent_update`, `in_progress`                                                         | State conflict                                       |
| 412     | `precondition_failed`                                                                                                        | Business precondition (e.g. transfer projects first) |
| 422     | `validation_failed`                                                                                                          | Input invalid (`details.fields`)                     |
| 429     | `rate_limited`                                                                                                               | Too many requests                                    |
| 500     | `internal_error`                                                                                                             | Unexpected; see `errorId`                            |
| 502/503 | `graph_error`, `graph_permission_denied`, `graph_not_found`, `graph_throttled`, `email_send_failed`, `service_misconfigured` | Microsoft 365 or configuration problem               |

## Implemented endpoints

### Auth and session

| Method   | Path                                         | Notes                                                                                                |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET      | `/api/auth/config`                           | `{ devAuth, entraConfigured, environment }`                                                          |
| GET      | `/api/auth/login?returnTo=&prompt=login`     | Redirects to Entra (code + PKCE). `returnTo` must be a same-origin path.                             |
| GET      | `/api/auth/consent?returnTo=`                | Incremental consent for `Mail.Send` + `Calendars.ReadWrite`.                                         |
| GET      | `/api/auth/callback`                         | Validates state/ID token/profile/policy; creates session; redirects. Errors → `/login?error=<code>`. |
| POST     | `/api/auth/logout`                           | `{ ok, logoutUrl }` (Entra end-session URL).                                                         |
| GET/POST | `/api/auth/dev-users`, `/api/auth/dev-login` | **Development only**; not registered otherwise.                                                      |
| GET      | `/api/me`                                    | User, permissions, onboarding status, Outlook consent, environment, timezone, today.                 |
| PATCH    | `/api/me/onboarding`                         | `{ completeSteps[], skipSteps[] }`                                                                   |
| GET      | `/api/directory/users`                       | Active employees `{ id, displayName, email, roles }` for pickers.                                    |

### Projects, tasks, APIs, escalations, workbook

| Method | Path                                                             | Permission                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/templates`                                        | signed in                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/api/projects`                                                  | lists only accessible projects (index entries + `access`)                                                                                                                                                                                                                                                                                                               |
| POST   | `/api/projects`                                                  | PM or Delivery Head role; `Idempotency-Key`; returns `{ project, workbook }` (`201`)                                                                                                                                                                                                                                                                                    |
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
| POST   | `/api/projects/:id/workbook`                                     | contributor; generate if missing                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/api/projects/:id/workbook/sync`                                | contributor; returns outcome                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/api/projects/:id/workbook/conflicts/resolve`                   | manager; `{ keys[], resolution: 'use_app' }`                                                                                                                                                                                                                                                                                                                            |

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

### Outlook (delegated)

| Method | Path                               | Notes                                                                              |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| GET    | `/api/email/templates?projectId=`  | Rendered from project data                                                         |
| POST   | `/api/email/preview`               | Returns exact preview, internal/external split, `previewToken` (HMAC, 30 min)      |
| POST   | `/api/email/send`                  | Requires matching `previewToken`; `confirmExternal` if external; one use per token |
| GET    | `/api/calendar/events?range=today  | week`                                                                              | Org-timezone wall times |
| POST   | `/api/calendar/events`             | Create; external attendees need `confirmExternal`                                  |
| PATCH  | `/api/calendar/events/:eid`        | Update subject/time                                                                |
| POST   | `/api/calendar/events/:eid/cancel` | Cancel with comment                                                                |

All return `403 consent_required` until the user connects Outlook.

### Admin

`GET /api/admin/users`, `PUT /api/admin/users/:uid` (`roles`, `status`), `GET|PUT /api/admin/config`, `GET /api/admin/account-requests`, `POST /api/admin/account-requests/:rid/approve|reject`, `GET /api/admin/jobs`, `POST /api/admin/jobs/:name/run`, `GET /api/admin/audit?month=YYYY-MM`, `GET /api/admin/health`.

### Telemetry

`GET /api/health` (public, no secrets), `POST /api/client-errors` (no auth, 30/min/IP), `POST /api/events` (allow-listed names).

## Proposed (not implemented)

- `POST /api/projects/:id/workbook/import` — accept selected Excel edits back into the app (needs Chat360 ownership rules).
- Attachment upload for outgoing email.
- `GET /api/projects/:id/export` — full JSON export for audits.

## Microsoft Graph contracts used

| Purpose                  | Call                                                                                                                          | Permission (type)                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Read JSON doc            | `GET /drives/{drive}/root:/{path}?$select=id,eTag,webUrl,name,@microsoft.graph.downloadUrl` then GET download URL             | Sites.Selected (app)                                 |
| Write JSON / upload xlsx | `PUT /drives/{drive}/root:/{path}:/content` with `If-Match` or `?@microsoft.graph.conflictBehavior=fail`                      | Sites.Selected (app)                                 |
| List project folders     | `GET …:/children?$select=name,folder`                                                                                         | Sites.Selected (app)                                 |
| Workbook session         | `POST /drives/{drive}/items/{id}/workbook/createSession` / `closeSession`                                                     | Sites.Selected (app)                                 |
| Read tables              | `$batch` of `GET …/workbook/tables/{name}/range?$select=address,formulas`                                                     | Sites.Selected (app)                                 |
| Write rows/cells         | sequential `$batch` of `PATCH …/worksheets/{sheet}/range(address='A6:Q6')` and `POST …/tables/{name}/rows`                    | Sites.Selected (app)                                 |
| Notifications            | `POST /users/{mailbox}/sendMail` (not retried)                                                                                | Mail.Send (app) + Exchange application access policy |
| Profile at sign-in       | `GET /me?$select=id,displayName,mail,userPrincipalName,userType,accountEnabled`                                               | User.Read (delegated)                                |
| Send as user             | `POST /me/sendMail`                                                                                                           | Mail.Send (delegated)                                |
| Calendar                 | `GET /me/calendarView` (Prefer `outlook.timezone`), `POST /me/events`, `PATCH /me/events/{id}`, `POST /me/events/{id}/cancel` | Calendars.ReadWrite (delegated)                      |

Retries: 429/503/504 and network errors are retried (Retry-After honoured, ≤8 s per wait, 3 retries) only for idempotent calls; `sendMail` and event creation use `retries: 0`. Default request timeout 20 s.

## Testing conventions

- `packages/core/test` — pure domain tests (no I/O).
- `apps/api/test` — the real Hono app via `app.request()` with in-memory adapters (`apps/api/dev/memory-deps.ts`); `graph.test.ts` pins Graph request shapes against a mocked `fetch` (contract tests — **not** live verification).
- `apps/web/test` — component/route tests in jsdom; `apps/web/e2e` — Playwright against the dev API and production build.
- Never send real client email in tests; the dev/test mailers only record.

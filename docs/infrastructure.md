# Infrastructure

**Implemented** = code and configuration exist in this repository. **Provisioned** = actually created in Chat360's Cloudflare account. **Nothing is provisioned yet.**

## Architecture

```
Browser (React SPA)
   │  same origin: https://<app>/...
   ▼
Worker "chat360pm" (root wrangler.toml, ADR-020)
   ├─ static assets: apps/web/dist + _headers (CSP, HSTS), SPA fallback
   └─ /api/* → Hono app (apps/api) ── fetch() + scheduled() (Cron)
          ├─► D1 database "chat360pm" (binding DB): all business documents (ADR-021)
          └─► Coordinator Durable Object (SQLite): sessions, rate limits, leases,
                                                  idempotency memos, job ledger
```

No VPS, container, external database, object storage, Microsoft 365 or paid third-party service is used. Everything fits the Cloudflare Workers free plan (see §Capacity).

## Components

| Component         | Implementation                                                                                 | Status                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Website + API     | One Worker `chat360pm`, static assets + `run_worker_first = ["/api/*"]`                        | Implemented; bundles and runs in `wrangler dev` |
| Storage           | D1 database `chat360pm`, table `docs(path, data, etag, updated_at)` created on first use       | Implemented; **database ID to be filled in**    |
| Scheduling        | Cron Triggers `30 3 * * *`, `30 13 * * *`, `15 * * * *` (UTC)                                  | Implemented                                     |
| Coordination      | Durable Object `Coordinator` (SQLite backend, migration `v1`), single named instance           | Implemented; exercised in `workerd`             |
| Identity          | Email + password, admin-issued set-password links, first admin via `SETUP_CODE` (ADR-022)      | Implemented                                     |
| Product analytics | Workers Logs (`analytics_event` lines); Analytics Engine used if an `ANALYTICS` binding exists | Implemented                                     |
| Logs              | Workers Logs (`[observability] enabled`, 100% head sampling)                                   | Implemented                                     |
| CI                | GitHub Actions `ci.yml` (checks only); deploys are done by Cloudflare Workers Builds           | Implemented                                     |

## Data ownership and layout

All business data is owned by Chat360 and stored in its own D1 database, one JSON document per row, keyed by path:

```
_system/directory.json          employees (random UUIDs), roles, status, onboarding, identity history
_system/credentials.json        password hashes (PBKDF2) and pending set-password links (hashed)
_system/config.json             timezone, working days, holidays, delay reasons, escalation levels/SLAs,
                                project groups ("destinations"), support contact, disabledJobs
_system/projects-index.json     one summary per project (lists, access checks, portfolio views)
_system/support.json            support requests
_system/account-requests.json   deactivation requests
_system/audit/YYYY-MM.json      organisation audit log
Projects/<PRJ-ID> <Client> - <Project>/project.json   system of record for one project
```

`project.json` holds team and team history, finance figures, tasks (with revisions, confirmations, comments, history), API dependencies, escalations (with level history and notification records), transfers (with snapshot, execution steps and history), document links, project audit and idempotency keys.

The Excel tracker is not stored: `GET /api/projects/:id/tracker.xlsx` builds it from `project.json` on demand.

The Coordinator holds **no business records**. Losing it signs everyone out and resets counters.

## Consistency model

- Each document write is a compare-and-swap on the row's eTag (ADR-004, ADR-021): a single conditional SQL statement; a lost race changes no row and the pure mutation is re-run on fresh data. Multi-document operations (project + index, transfers) are ordered, recorded and idempotent; the daily `reconcile` job rebuilds index entries from project documents and recovers projects missing from the index.
- Read-mostly system documents (directory, config, index) are cached per Worker isolate for 30 s.

## Scheduled processing

| Cron (UTC)    | Default local time (IST) | Jobs                                                                                     |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `30 3 * * *`  | 09:00                    | `morning_reminders` (digest per owner, once per day; needs a mail provider), `reconcile` |
| `30 13 * * *` | 19:00                    | `daily_confirmation` (no-response marks, escalations, notifications) — working days only |
| `15 * * * *`  | hourly                   | `maintenance` (SLA escalation ladder, notification retries, due transfers, purge)        |

Jobs run under a 15-minute lease, record a run in the job ledger (Admin → Scheduled jobs) and can be disabled via `disabledJobs` without a deploy. If Chat360 changes the org timezone, update the cron times in `wrangler.toml`.

## Capacity and limits (Workers free plan)

- 100,000 requests per day; D1 free quotas for storage, rows read and rows written. An internal team stays far below them.
- **10 ms CPU per request.** Time waiting on D1 or the Durable Object does not count. Password hashing (PBKDF2, 100,000 rounds) and generating a large tracker are the heaviest steps; if logs show CPU-limit errors, Workers Paid raises the limit.
- **50 subrequests per invocation.** If D1 and Durable Object calls count toward it, a scheduled job over more than roughly ten active projects could stop part-way; projects not reached are processed by the next hourly run, and Workers Paid removes the concern. Not yet measured on a real deployment.
- A project is one D1 row (2 MB maximum), enough for thousands of tasks.
- Analytics reads at most 300 project documents per request.

## Secrets and configuration

See `docs/deployment.md`. The only secret is `SETUP_CODE`; `APP_ORIGIN` is a plain variable. Fail-closed constants and bindings are in `wrangler.toml`.

## Monitoring and recovery

- Logs: JSON lines with `requestId`, `errorId`, `job`, `projectId`; redacted (see `docs/security.md`). Useful queries: `msg = "request_error"`, `msg = "job_finished" AND level = "error"`, `msg = "notification_failures"`, `msg = "client_error"`, `msg = "configuration_error"`.
- **Pending:** Cloudflare notifications on Worker error rate and an uptime check on `/api/health`.
- Recovery: D1 Time Travel (point-in-time restore); see `docs/deployment.md` §Rollback and recovery and `docs/security.md` §Incident response.

## External dependencies

Cloudflare Workers, D1, Durable Objects, Cron Triggers, Workers Builds; GitHub (source, Actions). npm runtime dependencies: `hono`, `zod`, `fflate`, `react`, `react-dom`, `react-router`.

## Known limitations

1. No email is sent: notifications are recorded as "not configured" and shown in the app; email drafts open in the user's own mail app.
2. The Excel tracker is a download, not a shared live file; edits made in a downloaded copy are not imported.
3. No live verification on a deployed Cloudflare account has been performed yet.

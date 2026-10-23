# Deployment

This repository has **not been deployed** anywhere yet. It runs on the **Cloudflare Workers free plan**: one Worker serves the website and the API, data lives in a free **D1** database, and people sign in with email and password (ADR-020, ADR-021, ADR-022). No Microsoft 365 setup is needed. Never put real credentials in this file or in git.

## Prerequisites

- Node.js ≥ 22, pnpm 10 (`corepack enable`).
- Python 3 + `openpyxl` (optional, for `pnpm validate:workbook`); LibreOffice optional for formula recalculation checks.
- A Cloudflare account. The free plan is enough; no card is needed.

## Local development

```bash
pnpm install
pnpm dev            # API dev server on :8787 (in-memory, developer sign-in) + Vite on :5173
```

Open http://localhost:5173 and choose a fictional demo user, or sign in as `demo-pm1@chat.io` with password `demo-password`. Nothing leaves your machine and data resets on restart.

To run the real Worker locally with a local D1 database: `pnpm exec wrangler dev --var ENVIRONMENT:development --var APP_ORIGIN:http://localhost:8787 --var SETUP_CODE:any-local-code` from the repository root, then open http://localhost:8787 and use **First-time setup**.

## Testing

```bash
pnpm typecheck          # tsc for core, api, web
pnpm lint               # eslint + prettier --check
pnpm test               # core (vitest), api integration + D1 store tests, web jsdom tests
pnpm build              # vite build
pnpm e2e                # Playwright: dev API + production web build (desktop + emulated phone)
pnpm validate:workbook  # generate a sample tracker and validate with openpyxl/LibreOffice
SCREENSHOTS=1 pnpm e2e  # also refresh docs/screenshots
pnpm exec wrangler deploy --dry-run --outdir .wrangler/dry-run   # bundle the Worker as Cloudflare would
```

In environments with a pre-installed Chromium, set `PW_CHROMIUM_PATH` if the Playwright revision differs.

What the tests do **not** cover: real D1 (the store is tested over Node's SQLite and in local `wrangler dev`), a deployed Worker, real devices.

## Settings

| Name              | Where                          | Secret  | Notes                                                                                           |
| ----------------- | ------------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`      | Dashboard                      | no      | Exact site address, e.g. `https://chat360pm.<subdomain>.workers.dev` (no trailing slash)        |
| `SETUP_CODE`      | Dashboard                      | **yes** | 12+ characters. Lets the first administrator create their account; useless once an admin exists |
| `ENVIRONMENT`     | `wrangler.toml`                | no      | `production`                                                                                    |
| `STORAGE_BACKEND` | `wrangler.toml`                | no      | `d1` (only allowed value outside development)                                                   |
| `DEV_AUTH`        | `wrangler.toml`                | no      | `disabled` (refused outside development)                                                        |
| `DB`              | `wrangler.toml` (D1 binding)   | no      | The D1 database; its `database_id` must be filled in                                            |
| `COORDINATOR`     | `wrangler.toml` (Durable Obj.) | no      | Created automatically on first deploy                                                           |
| `RELEASE`         | optional                       | no      | Shown in crash reports                                                                          |

## Deploy on Cloudflare (Workers Builds, free plan)

1. **Create the database:** Cloudflare dashboard → **Storage & Databases → D1 → Create database**, name it `chat360pm`. Copy its **Database ID**.
2. **Put the ID in the repo:** in `wrangler.toml`, replace `REPLACE_WITH_D1_DATABASE_ID` with that ID and push to `main`. The ID is not a secret. The app creates its table on first use, so no migration is needed.
3. **Connect the repo** (already done for `chat360pm`): Workers & Pages → `chat360pm` → Settings → Build: repository and branch `main`, root directory `/`, build command empty, deploy command `npx wrangler deploy`.
4. **Settings → Variables and Secrets** (Production):
   - `APP_ORIGIN` (Text): your Worker address.
   - `SETUP_CODE` (Secret): any long code you make up, e.g. the output of `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`.
     `keep_vars = true` in `wrangler.toml` keeps them across deploys.
5. **Deployments → Retry build** (or push to `main`). Open `<APP_ORIGIN>/api/health`: `{"status":"ok"}` means it is configured; `503 service_misconfigured` means a setting is missing, and **Observability → Logs** shows a `configuration_error` line naming it.
6. Open `<APP_ORIGIN>`, choose **First-time setup**, enter the setup code, your name, email and a password. You are now the administrator.
7. **Admin → Users and roles → Add an employee** for everyone else. Each gets a one-time set-password link (valid 7 days) to send them privately. Give yourself other roles (e.g. Project Manager) there too: administrators get no project access by default.

Product analytics are written to Workers Logs. To use Workers Analytics Engine instead, add an `[[analytics_engine_datasets]]` binding named `ANALYTICS` to `wrangler.toml`.

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes and pull requests: install, typecheck, lint, tests, build, Worker bundle dry run, workbook validation, Playwright e2e, `pnpm audit --prod` (report only). No secrets required. Deployment is done by Cloudflare Workers Builds, not by GitHub Actions.

## Verification after deploy

1. `GET <APP_ORIGIN>/api/health` → `{"status":"ok",…}`.
2. First-time setup, then Admin → Health (storage OK).
3. Add a test PM, tech and Delivery Head; open each set-password link in a private window and sign in.
4. Create a test project; **Download Excel tracker**; open it in Excel and check the seven sheets (six delivery sheets + Finance), tables, dropdowns and formulas, and that Finance → Total equals the first two amounts.
5. Confirm a task as Not completed; check the escalation appears for the PM (email notifications show as "not configured").
6. Run a transfer request → approve, and a direct reassignment; check history.
7. Admin → Scheduled jobs → run `maintenance` and `reconcile`; check runs are OK. After an hour, check the hourly cron ran (Scheduled jobs list).
8. Test on real phones and tablets (Safari iOS, Chrome Android) and record results in `docs/product.md`.

## Rollback and recovery

- Worker: Cloudflare dashboard → `chat360pm` → Deployments → an earlier deployment → _Rollback_ (or `npx wrangler rollback`).
- Data: D1 → `chat360pm` → **Time Travel** restores the database to an earlier point in time. Then run Admin → Scheduled jobs → `reconcile`.
- Locked out (no admin can sign in): if every administrator is deactivated or has no password, **First-time setup** becomes available again with the `SETUP_CODE`. To reset one person's password, another admin issues a new set-password link.
- Emergency stop for scheduled work: add the job name to `disabledJobs` (Admin → Configuration). To stop all crons immediately, remove the `[triggers]` block and redeploy.

## Limits of the free plan

- 100,000 requests per day; D1 free storage and read/write quotas apply (ample for an internal team).
- **10 ms of CPU time per request.** Waiting on the database does not count. Password hashing (PBKDF2, 100,000 rounds) and generating a large Excel tracker are the heaviest operations and the most likely to hit it; the symptom is an "exceeded CPU" error in the logs. The Workers Paid plan raises the limit.

## Troubleshooting

| Symptom                                     | Likely cause / fix                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Build fails mentioning `database_id`        | Step 1–2 not done: create the D1 database and put its ID in `wrangler.toml`                                |
| `503 service_misconfigured`                 | `APP_ORIGIN` missing or not `https://`, or `SETUP_CODE` shorter than 12 characters; see the logs           |
| No "First-time setup" button                | `SETUP_CODE` not set, or an administrator already exists (sign in instead)                                 |
| "This link has expired or was already used" | Ask an administrator for a new set-password link                                                           |
| Notifications show "not configured"         | Expected: no email provider is set up. Escalations and reminders are visible in the app                    |
| Jobs not running                            | Check Admin → Scheduled jobs (`disabled`, `skippedOverlap`), Worker cron logs, and that `[triggers]` exist |

## Outstanding validation (not yet done)

- A real Cloudflare deployment with D1, the Durable Object and crons.
- Opening downloaded trackers in desktop Excel and Excel for the web.
- Real-device testing (only browser emulation was run).
- Alerting configuration in Cloudflare.

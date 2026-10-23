# Chat360 Project Operations Platform

Internal, serverless project-delivery platform for Chat360 employees: projects and their downloadable Excel trackers, tasks and daily confirmations, escalations, safe PM transfers, email drafts from templates, finance, analytics, onboarding, support and account lifecycle.

- **Hosting:** one Cloudflare Worker serves the React website and the API (free plan; `wrangler.toml`)
- **API:** Hono with Cron Triggers and one Durable Object for coordination (`apps/api`)
- **Storage:** Cloudflare D1, one JSON document per row — no Microsoft 365 or OneDrive needed
- **Sign-in:** email + password; admins add employees and send them a one-time set-password link
- **Domain:** pure TypeScript business rules and the Excel tracker generator (`packages/core`)

```bash
pnpm install
pnpm dev     # http://localhost:5173 — in-memory data, fictional demo users, nothing is sent
pnpm check   # typecheck + lint + tests + build
pnpm e2e     # browser end-to-end tests
```

Status: implemented and tested locally (including the real Worker in `wrangler dev`); **not yet deployed**. To go live: create a D1 database, put its ID in `wrangler.toml`, set `APP_ORIGIN` and `SETUP_CODE` in Cloudflare — see `docs/deployment.md`. Other docs: product, API, security, infrastructure, design and decision records in `docs/`. Future AI-assisted work: read `CLAUDE.md`.

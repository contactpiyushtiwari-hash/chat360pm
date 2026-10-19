# Chat360 Project Operations Platform

Internal, serverless project-delivery platform for Chat360 employees: projects and their official Excel trackers in OneDrive, tasks and daily confirmations, escalations, safe PM transfers, Outlook email and calendar, analytics, onboarding, support and account lifecycle.

- **Frontend:** React SPA on Cloudflare Pages (`apps/web`)
- **API:** Hono on a Cloudflare Worker with Cron Triggers and one Durable Object for coordination (`apps/api`)
- **Domain:** pure TypeScript business rules and the Excel generator/sync planner (`packages/core`)
- **Storage:** Microsoft OneDrive/SharePoint via Microsoft Graph — no separate database

```bash
pnpm install
pnpm dev     # http://localhost:5173 — in-memory data, fictional demo users, nothing is sent
pnpm check   # typecheck + lint + tests + build
pnpm e2e     # browser end-to-end tests
```

Status: implemented and tested locally; **not yet deployed or verified against the Chat360 Microsoft 365 tenant**. See `docs/deployment.md` for the remaining setup and `docs/` for product, API, security, infrastructure, design and decision records. Future AI-assisted work: read `CLAUDE.md`.

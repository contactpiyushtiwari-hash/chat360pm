# Product Guide — Chat360 Project Operations Platform

An internal web app for Chat360 employees to run client bot-delivery projects: create projects, manage tasks, confirm daily progress, escalate delays, hand projects over safely, download each project's Excel tracker, and draft client emails from templates.

**Principle:** enter information once; keep the records in Chat360's own database; automate the repetitive parts; make ownership and status obvious. Runs on the Cloudflare free plan with email + password sign-in; no Microsoft 365 is needed (ADR-021, ADR-022).

Status labels: **Implemented** = built and covered by automated tests here; **Verified** = confirmed on a real deployment (none yet: the app has not been deployed); **In Progress**; **Planned**.

## Navigation

| Item             | Who sees it                              | Purpose                                                                            |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Dashboard        | Everyone                                 | Decisions needed today, overdue count, escalations assigned to you, your projects. |
| My Tasks Today   | Everyone                                 | Completed / Not completed for every task due today or overdue.                     |
| Projects         | Everyone (only projects they can access) | List, search, filter by health; open a project.                                    |
| Escalations      | Everyone (scoped)                        | Open escalations you manage/own or on your projects; all for the Delivery Head.    |
| Transfers        | Everyone (scoped)                        | Transfer requests and history; review queue for the Delivery Head.                 |
| Analytics        | Everyone (scoped)                        | Delivery metrics with definitions.                                                 |
| Email            | Everyone                                 | Fill a template from project data and open it in your own email app.               |
| Support          | Everyone                                 | Raise and follow support requests.                                                 |
| Admin            | Administrators                           | Add employees, set-password links, roles, configuration, requests, jobs, audit.    |
| Account (avatar) | Everyone                                 | Profile, change password, setup checklist, deactivation request.                   |

## Modules and feature status

| Module               | Feature                                                                                                             | Status                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Sign-in              | Email + password, first-admin setup, admin-issued set-password links, change password, sign-out                     | Implemented                             |
| Sign-in              | Multi-factor authentication                                                                                         | Planned (Cloudflare Access recommended) |
| Onboarding           | Role-specific checklist, skip optional steps, system-verified steps                                                 | Implemented                             |
| Projects             | Creation wizard with templates                                                                                      | Implemented                             |
| Projects             | Team management with history; document links                                                                        | Implemented                             |
| Excel tracker        | Download any time, built from current data (six delivery sheets + Finance)                                          | Implemented                             |
| Excel tracker        | Importing edits made in a downloaded tracker back into the app                                                      | Planned                                 |
| Tasks                | List / Kanban / Gantt, task dialog, revisions, comments, history                                                    | Implemented                             |
| Daily confirmation   | My Tasks Today, Completed/Not completed, end-of-day no-response marking                                             | Implemented                             |
| Escalations          | Policy levels and SLAs, acknowledge/resolve, shown in the app                                                       | Implemented                             |
| Notifications        | Email notifications for escalations, transfers and reminders                                                        | Planned (no mail provider yet)          |
| API dependencies     | Track readiness/testing/next action; credential-like text rejected                                                  | Implemented                             |
| Transfers            | PM request with handover; Head approve/reject; direct reassignment; resumable execution                             | Implemented                             |
| Email                | Templates filled from project data; open in your own email app or copy                                              | Implemented                             |
| Analytics            | Portfolio and own-project delivery metrics                                                                          | Implemented                             |
| Support              | Requests, triage, statuses, history                                                                                 | Implemented                             |
| Account              | Deactivation request with project protection and admin review                                                       | Implemented                             |
| Monitoring           | Client crash reports, structured logs, job ledger, health page                                                      | Implemented                             |
| Finance              | Per-project Finance tab (4 figures, calculated Total), Finance sheet in the download, handover and analytics totals | Implemented                             |
| Billing / app stores | Not applicable (ADR-015, ADR-016)                                                                                   | —                                       |

## Excel tracker

Project → **Download Excel tracker** gives `<Client> - <Project> - Tracker.xlsx`, built from the project's current data each time. Anyone who can see the project can download it.

| Sheet             | Table(s)                                            | Columns                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gantt Chart       | `tblGantt` + week timeline (conditional formatting) | Task ID, WBS ID, Milestone / Task, Type, Owner, Planned Start, Planned End, Revised End, Status, Dependencies, % Complete                                                                                                                                                                    |
| WBS               | `tblWBS`                                            | WBS ID, Task ID, Phase, Task, Description, Owner, Priority, Planned Start, Planned End, Revised End, Current Due _(formula)_, Actual Start, Actual End, Status, Dependencies, Days Late _(formula, working days)_, Remarks                                                                   |
| API List Pending  | `tblAPIs`                                           | API ID, API Name, Purpose, Owner, Readiness, Testing Status, Blocker, Dependency, Next Action, Target Date, Technical Reference, Days to Target _(formula)_                                                                                                                                  |
| Escalation Matrix | `tblEscalationMatrix`, `tblEscalationLog`           | Matrix: Level, Responsible Role, Manager Mapping, Severity, Escalation Condition, SLA (hours). Log: Escalation ID, Task ID, Task, Owner, Type, Level, Severity, Reason, Impact, Next Action, Original Due, Revised ETA, Raised At, Manager, Notification, Acknowledgement, Resolution Status |
| Last Week Task    | `tblLastWeek`                                       | Week Of, Task ID, Task, Owner, Original Deadline, Completion Date, Status, Carry Forward, Delay Reason, Blocker, Closure Notes                                                                                                                                                               |
| This Week Task    | `tblThisWeek`                                       | Week Of, Task ID, Task, Owner, Priority, Due Date, Status, Dependencies, Blocker, Next Action, Revised ETA, Completion Confirmation                                                                                                                                                          |
| Finance           | `tblFinance`                                        | Project ID, Client, Currency, Amount Raised and Overdue (for Go-Live), Amount that can be raised on immediate basis, Total _(formula = first two amounts)_, Amount to be raised, Remarks, Last Updated                                                                                       |

Rules people should know:

- Edit tasks **in the app**. A downloaded tracker is a snapshot: changes made in the file are not read back into the app.
- Download again to get the latest data.
- Weekly sheets keep one row per week per task, so past weeks remain as history.
- Manager names come from the project team; unassigned roles show "Unassigned". No names are invented.

**Finance visibility:** only the PM, Delivery Head, Sales POC (edit) and CSM (view) see finance figures, in the app and in the Finance sheet of their download. Everyone else gets the Finance sheet without figures.

## Key workflows

**Create a project** — Projects → New project → five steps → Create project. The project page then offers **Download Excel tracker**.

**Daily confirmation** — My Tasks Today → Completed (closure notes, optional evidence link) or Not completed (reason category, reason, next action, revised ETA; optional impact). Unanswered tasks are marked Unconfirmed at the configured end-of-day time and escalated once.

**Escalations** — the manager (PM, or Delivery Head when the PM owns the task) sees it on Dashboard and Escalations, and can acknowledge and resolve with notes. No email is sent yet. Unresolved escalations move up a level after the SLA.

**Request project transfer (PM)** — Project → Transfers → Request project transfer. The current status, outstanding work, deadlines, APIs, UAT issues, commitments, escalations, blockers and documents are attached automatically. Save as draft or submit.

**Review a transfer (Delivery Head)** — Transfers → open request → Start review → Approve… (choose new PM) or Reject… (reason required). If the effective date is today or earlier it executes immediately; otherwise on that date. Execution steps and any errors are shown; "Retry execution" resumes an interrupted one.

**Change project PM (Delivery Head)** — Project → Transfers → Change project PM → review the handover → tick the confirmation → Confirm reassignment.

**Finance** — Project → Finance → Update figures (PM, Sales POC or Delivery Head). Enter Amount Raised and Overdue (for Go-Live), Amount that can be raised on immediate basis and Amount to be raised; Total is calculated.

**Email** — Email → project and template (optional) → To/Cc/Subject/Message → **Open in my email app** (or **Copy**). The app sends nothing itself.

**First sign-in** — An administrator adds you and sends you a set-password link (valid 7 days, works once). Open it, choose a password, and you are signed in. Forgot it? Ask an administrator for a new link. Change it any time under Account.

**First administrator** — On a fresh deployment, the sign-in page shows **First-time setup**; enter the `SETUP_CODE` from the Cloudflare settings, your name, email and a password.

**Support** — Support → New request; follow status and notes. Include the error ID shown on error screens.

**Account deactivation** — Account → Request deactivation… (sign in again if asked, type your email). PMs with active projects must have them transferred before approval.

## Onboarding content

Common: what the platform does, role assignment (checked automatically). Role additions: PM (create project, daily confirmations, transfers), Tech (today, API dependencies), FDE (today), Sales POC (scope/commitments), CSM (UAT/follow-ups), Delivery Head (portfolio analytics, transfer review), Admin (roles, configuration).

## Screenshots

`docs/screenshots/` contains images captured by the automated browser suite from the real UI with fictional demo data (`SCREENSHOTS=1 pnpm e2e`). `mobile-*.png` come from a **browser-emulated** phone viewport, not a physical device.

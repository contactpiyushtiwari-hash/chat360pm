# Product Guide — Chat360 Project Operations Platform

An internal web app for Chat360 employees to run client bot-delivery projects: create projects and their Excel trackers in OneDrive, manage tasks, confirm daily progress, escalate delays, hand projects over safely, and communicate through Outlook.

**Principle:** enter information once; keep the records in Chat360's OneDrive; automate the repetitive parts; make ownership and status obvious.

Status labels: **Implemented** = built and covered by automated tests here; **Verified** = confirmed against the real Chat360 Microsoft 365 tenant (none yet — tenant access was not available); **In Progress**; **Planned**.

## Navigation

| Item             | Who sees it                              | Purpose                                                                            |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Dashboard        | Everyone                                 | Decisions needed today, overdue count, escalations assigned to you, your projects. |
| My Tasks Today   | Everyone                                 | Completed / Not completed for every task due today or overdue.                     |
| Projects         | Everyone (only projects they can access) | List, search, filter by health; open a project.                                    |
| Escalations      | Everyone (scoped)                        | Open escalations you manage/own or on your projects; all for the Delivery Head.    |
| Transfers        | Everyone (scoped)                        | Transfer requests and history; review queue for the Delivery Head.                 |
| Analytics        | Everyone (scoped)                        | Delivery metrics with definitions.                                                 |
| Calendar         | Everyone                                 | Today / next 7 days from Outlook; schedule meetings.                               |
| Email            | Everyone                                 | Compose, preview and send from your Outlook.                                       |
| Support          | Everyone                                 | Raise and follow support requests.                                                 |
| Admin            | Administrators                           | Roles, configuration, account requests, jobs, health, audit.                       |
| Account (avatar) | Everyone                                 | Profile, setup checklist, deactivation request.                                    |

## Modules and feature status

| Module               | Feature                                                                                 | Status                                   |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| Sign-in              | Microsoft (Entra ID) sign-in, guest refusal, sessions, sign-out                         | Implemented                              |
| Onboarding           | Role-specific checklist, skip optional steps, system-verified steps                     | Implemented                              |
| Projects             | Creation wizard with templates and approved destinations                                | Implemented                              |
| Projects             | Team management with history; document links                                            | Implemented                              |
| Excel tracker        | Six-sheet generation in OneDrive; background sync; conflict review; manual sync/retry   | Implemented                              |
| Excel tracker        | Importing edits made in Excel back into the app                                         | Planned                                  |
| Tasks                | List / Kanban / Gantt, task dialog, revisions, comments, history                        | Implemented                              |
| Daily confirmation   | My Tasks Today, Completed/Not completed, end-of-day no-response marking                 | Implemented                              |
| Escalations          | Policy levels and SLAs, acknowledge/resolve, email notifications                        | Implemented                              |
| Reminders            | Morning digest email per owner                                                          | Implemented (needs notification mailbox) |
| API dependencies     | Track readiness/testing/next action; credential-like text rejected                      | Implemented                              |
| Transfers            | PM request with handover; Head approve/reject; direct reassignment; resumable execution | Implemented                              |
| Email                | Templates, preview, external-recipient confirmation, send from own mailbox              | Implemented                              |
| Calendar             | View, create (Teams option), cancel                                                     | Implemented                              |
| Calendar             | Edit meeting time/subject from the UI                                                   | API implemented; UI Planned              |
| Analytics            | Portfolio and own-project delivery metrics                                              | Implemented                              |
| Support              | Requests, triage, statuses, history                                                     | Implemented                              |
| Account              | Deactivation request with project protection and admin review                           | Implemented                              |
| Monitoring           | Client crash reports, structured logs, job ledger, health page                          | Implemented                              |
| Billing / app stores | Not applicable (ADR-015, ADR-016)                                                       | —                                        |

## Excel tracker

Saved as `<Destination>/<PRJ-ID> <Client> - <Project>/<Client> - <Project> - Tracker.xlsx`, next to `project.json`.

| Sheet             | Table(s)                                            | Columns                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gantt Chart       | `tblGantt` + week timeline (conditional formatting) | Task ID, WBS ID, Milestone / Task, Type, Owner, Planned Start, Planned End, Revised End, Status, Dependencies, % Complete                                                                                                                                                                    |
| WBS               | `tblWBS`                                            | WBS ID, Task ID, Phase, Task, Description, Owner, Priority, Planned Start, Planned End, Revised End, Current Due _(formula)_, Actual Start, Actual End, Status, Dependencies, Days Late _(formula, working days)_, Remarks                                                                   |
| API List Pending  | `tblAPIs`                                           | API ID, API Name, Purpose, Owner, Readiness, Testing Status, Blocker, Dependency, Next Action, Target Date, Technical Reference, Days to Target _(formula)_                                                                                                                                  |
| Escalation Matrix | `tblEscalationMatrix`, `tblEscalationLog`           | Matrix: Level, Responsible Role, Manager Mapping, Severity, Escalation Condition, SLA (hours). Log: Escalation ID, Task ID, Task, Owner, Type, Level, Severity, Reason, Impact, Next Action, Original Due, Revised ETA, Raised At, Manager, Notification, Acknowledgement, Resolution Status |
| Last Week Task    | `tblLastWeek`                                       | Week Of, Task ID, Task, Owner, Original Deadline, Completion Date, Status, Carry Forward, Delay Reason, Blocker, Closure Notes                                                                                                                                                               |
| This Week Task    | `tblThisWeek`                                       | Week Of, Task ID, Task, Owner, Priority, Due Date, Status, Dependencies, Blocker, Next Action, Revised ETA, Completion Confirmation                                                                                                                                                          |

Rules people should know:

- Edit tasks **in the app**. If you edit an app-managed cell in Excel, the app will not overwrite it; the project shows a conflict until a PM resolves it.
- You can add your own columns, notes and rows; the app leaves them alone.
- Weekly sheets keep one row per week per task, so past weeks remain as history.
- Manager names come from the project team; unassigned roles show "Unassigned". No names are invented.

## Key workflows

**Create a project** — Projects → New project → five steps → Create. The project page confirms the tracker was generated, or shows the error and a "Generate workbook" button.

**Daily confirmation** — My Tasks Today → Completed (closure notes, optional evidence link) or Not completed (reason category, reason, next action, revised ETA; optional impact). The page then shows the Excel update outcome. Unanswered tasks are marked Unconfirmed at the configured end-of-day time and escalated once.

**Escalations** — the manager (PM, or Delivery Head when the PM owns the task) is emailed, can acknowledge and resolve with notes. Unresolved escalations move up a level after the SLA.

**Request project transfer (PM)** — Project → Transfers → Request project transfer. The current status, outstanding work, deadlines, APIs, UAT issues, commitments, escalations, blockers and documents are attached automatically. Save as draft or submit.

**Review a transfer (Delivery Head)** — Transfers → open request → Start review → Approve… (choose new PM) or Reject… (reason required). If the effective date is today or earlier it executes immediately; otherwise on that date. Execution steps and any errors are shown; "Retry execution" resumes an interrupted one.

**Change project PM (Delivery Head)** — Project → Transfers → Change project PM → review the handover → tick the confirmation → Confirm reassignment.

**Email** — Email → template (optional) → To/Cc/Subject/Message → Preview → confirm external recipients → Send. "Sent" means Outlook accepted the message.

**Calendar** — Connect Outlook once; view today/next 7 days; schedule a meeting (optional Teams); cancel.

**Support** — Support → New request; follow status and notes. Include the error ID shown on error screens.

**Account deactivation** — Account → Request deactivation… (sign in again if asked, type your email). PMs with active projects must have them transferred before approval.

## Onboarding content

Common: what the platform does, role assignment (checked automatically), opening workbooks, connecting Outlook (optional). Role additions: PM (create project, daily confirmations, transfers), Tech (today, API dependencies), FDE (today), Sales POC (scope/commitments), CSM (UAT/follow-ups), Delivery Head (portfolio analytics, transfer review), Admin (roles, configuration).

## Screenshots

`docs/screenshots/` contains images captured by the automated browser suite from the real UI with fictional demo data (`SCREENSHOTS=1 pnpm e2e`). `mobile-*.png` come from a **browser-emulated** phone viewport, not a physical device.

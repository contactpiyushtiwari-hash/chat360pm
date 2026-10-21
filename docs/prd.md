# Product Requirements — Chat360 Project Operations Platform

Status legend used in the right-hand column: **Implemented** (code + automated tests in this repo), **Partial** (some acceptance criteria open), **Planned** (not built). "Verified" is reserved for behaviour confirmed against the real Chat360 Microsoft 365 tenant — **nothing is Verified yet** because no tenant access was available.

## 1. Objectives

1. Remove manual Excel upkeep, repetitive status emails and ad-hoc escalation chasing.
2. Make ownership, deadlines, dependencies and delivery risk visible to everyone who needs them.
3. Keep project records in Chat360's authorised OneDrive with Excel as the official tracker.
4. Make PM transfers safe, approved and fully auditable.

Non-goals: client-facing portal, time tracking, invoicing/billing, replacing Outlook or Teams.

## 2. Personas

| Persona                        | Needs                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Project Manager (PM)           | Create projects/trackers, plan and track tasks, chase dependencies, send updates, request a transfer. |
| Tech Team                      | See and update assigned technical work, report blockers, track APIs.                                  |
| FDE (bot builder)              | Track bot flows, builds and milestones they own.                                                      |
| Sales POC                      | See scope and commercial commitments for their projects.                                              |
| Customer Success Manager (CSM) | Track UAT, client follow-ups and adoption tasks.                                                      |
| Delivery and Operations Head   | Portfolio visibility, escalations, approve transfers, reassign PMs, full history.                     |
| Administrator                  | Assign roles, configure calendar/escalations/destinations, review account requests, watch jobs.       |

## 3. Key user journeys

1. **Create a project:** PM → New project wizard (basics, team, scope, template & destination, review) → project + `project.json` + `.xlsx` tracker (six delivery sheets + Finance) saved in the approved OneDrive folder → link shown.
2. **Daily confirmation:** Owner opens My Tasks Today → Completed (closure notes, evidence) or Not completed (reason, next action, revised ETA) → escalation to the configured manager → Excel updates in the background with the outcome shown.
3. **No response:** at end of day the system marks Unconfirmed and escalates (once).
4. **Transfer (PM-initiated):** PM → Request project transfer (pre-filled handover) → Delivery Head reviews → approve (choose PM) / reject (reason) → executed and audited.
5. **Reassignment (Head-initiated):** Delivery Head → Change project PM → reviews handover → confirms → executed.
6. **Communication:** compose email from template → preview exactly what is sent → confirm external recipients → send from own Outlook; schedule meetings.
7. **Onboarding, support, deactivation** as described below.

## 4. Requirements

### Authentication and access (AUTH)

| ID           | Requirement                                                                                                                         | Status                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| PRD-AUTH-001 | Employees sign in with their Chat360 Microsoft (Entra ID) account; no separate passwords.                                           | Implemented (live tenant pending) |
| PRD-AUTH-002 | Identity is validated server-side (ID token signature, issuer, audience, nonce, tenant); browser-supplied emails are never trusted. | Implemented                       |
| PRD-AUTH-003 | Guests, external and disabled accounts are refused; the email domain alone never authorises or elevates.                            | Implemented                       |
| PRD-AUTH-004 | Users are identified by Entra object id; name/email changes keep history.                                                           | Implemented                       |
| PRD-AUTH-005 | Sessions expire (12 h absolute, 8 h idle) and can be revoked immediately.                                                           | Implemented                       |
| PRD-AUTH-006 | Logout ends the app session and offers Microsoft sign-out.                                                                          | Implemented                       |
| PRD-AUTH-007 | Sensitive actions (deactivation) require a sign-in within 15 minutes.                                                               | Implemented                       |

### Roles and project team (ROLE)

| ID           | Requirement                                                                                            | Status      |
| ------------ | ------------------------------------------------------------------------------------------------------ | ----------- |
| PRD-ROLE-001 | Each project tracks PM, multiple Tech Team members, FDE, Sales POC, CSM, Delivery and Operations Head. | Implemented |
| PRD-ROLE-002 | Admins assign global roles; no names or emails are hard-coded.                                         | Implemented |
| PRD-ROLE-003 | All permissions are enforced server-side per request (`packages/core/src/rbac.ts`).                    | Implemented |
| PRD-ROLE-004 | Team changes record who, when, from, to and why; task owners never change implicitly.                  | Implemented |
| PRD-ROLE-005 | Admins do not receive project data access by virtue of the admin role.                                 | Implemented |

### Projects and Excel (PROJ)

| ID           | Requirement                                                                                                                                                                                             | Status                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| PRD-PROJ-001 | Project wizard collects client, name, category, team, dates, languages, integrations, QA/UAT workflow, template and approved destination.                                                               | Implemented                           |
| PRD-PROJ-002 | A valid `.xlsx` with six delivery sheets (Gantt Chart, WBS, API List Pending, Escalation Matrix, Last Week Task, This Week Task) plus a Finance sheet (PRD-FIN-005) is generated and saved to OneDrive. | Implemented (live OneDrive pending)   |
| PRD-PROJ-003 | Workbooks use Excel tables, filters, formulas, date formats, list validation, conditional formatting and freeze panes.                                                                                  | Implemented                           |
| PRD-PROJ-004 | Updates never blindly overwrite: rows keyed by ID, user columns/rows preserved, Excel edits reported as conflicts.                                                                                      | Implemented                           |
| PRD-PROJ-005 | Synchronisation status (synced, pending, failed, conflict) and errors are visible; sync can be retried.                                                                                                 | Implemented                           |
| PRD-PROJ-006 | Workbook generation failure is reported and retryable without recreating the project.                                                                                                                   | Implemented                           |
| PRD-PROJ-007 | Project documents (SOW, BRD, bot flows) can be linked.                                                                                                                                                  | Implemented (links only)              |
| PRD-PROJ-008 | Excel edits can be imported back into the app.                                                                                                                                                          | Planned                               |
| PRD-PROJ-009 | Project folders are shared automatically with team members.                                                                                                                                             | Planned (library permissions assumed) |

### Tasks and WBS (TASK)

| ID           | Requirement                                                                                                                                               | Status      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| PRD-TASK-001 | Tasks/subtasks with stable ids (`T-0001`), WBS ids, owner, priority, dates, dependencies (cycle-checked), blockers, progress, comments/evidence, history. | Implemented |
| PRD-TASK-002 | The original deadline is immutable; revisions keep from/to/reason/by/at.                                                                                  | Implemented |
| PRD-TASK-003 | Status transitions are validated; completion needs closure notes; reopen/cancel need a reason (PM only for reopen).                                       | Implemented |
| PRD-TASK-004 | List, Kanban and Gantt views.                                                                                                                             | Implemented |
| PRD-TASK-005 | Working days and holidays are configurable and drive ageing and lateness.                                                                                 | Implemented |
| PRD-TASK-006 | My Tasks Today lists tasks due today or overdue; each needs Completed or Not completed.                                                                   | Implemented |
| PRD-TASK-007 | Not completed requires reason category, reason, next action and revised ETA; creates an escalation per policy.                                            | Implemented |
| PRD-TASK-008 | No response by end of day → Unconfirmed; never auto-completed; escalated once while open.                                                                 | Implemented |
| PRD-TASK-009 | Stale concurrent edits are detected.                                                                                                                      | Implemented |

### Escalations (ESC)

| ID          | Requirement                                                                                                                                                                    | Status                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| PRD-ESC-001 | Escalations record project, task, owner, original deadline, reason, impact, next action, revised ETA, manager, trigger time, notification status, acknowledgement, resolution. | Implemented                     |
| PRD-ESC-002 | Configurable levels/SLAs; unresolved escalations move up a level once per SLA. Owner-as-manager skips to the next level.                                                       | Implemented                     |
| PRD-ESC-003 | Duplicate escalations are prevented (deterministic dedupe keys).                                                                                                               | Implemented                     |
| PRD-ESC-004 | Notification outcomes are recorded truthfully (accepted / failed / not configured / unknown).                                                                                  | Implemented (live mail pending) |

### Transfers (TRANSFER)

| ID               | Requirement                                                                                                                                                                          | Status                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| PRD-TRANSFER-001 | PM can request a transfer with reason, proposed PM, effective date, and auto-attached handover (status, tasks, deadlines, blockers, APIs, UAT, commitments, escalations, documents). | Implemented                     |
| PRD-TRANSFER-002 | States: Draft, Submitted, Under Review, Approved, Rejected (reason required), Completed, Cancelled.                                                                                  | Implemented                     |
| PRD-TRANSFER-003 | Delivery Head can reassign the PM directly after reviewing the handover and confirming.                                                                                              | Implemented                     |
| PRD-TRANSFER-004 | History is never deleted or reset; only the current PM changes; previous assignments remain visible.                                                                                 | Implemented                     |
| PRD-TRANSFER-005 | Execution is recorded step by step, idempotent, resumable; completion only after required steps succeed.                                                                             | Implemented                     |
| PRD-TRANSFER-006 | Notifications on submit, approve, reject, complete.                                                                                                                                  | Implemented (live mail pending) |
| PRD-TRANSFER-007 | Previous PM keeps read access for a configured period unless they still hold another role.                                                                                           | Implemented                     |

### Microsoft 365 communication (COMM)

| ID           | Requirement                                                                                                                                                  | Status                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| PRD-COMM-001 | Compose from templates; preview recipients, subject, body, attachments; external recipients need explicit confirmation; content cannot change after preview. | Implemented                       |
| PRD-COMM-002 | Send from the user's own mailbox (delegated); record project-linked sends without storing bodies; show failures.                                             | Implemented (live Graph pending)  |
| PRD-COMM-003 | Today's and upcoming meetings; create (with Teams option), update, cancel; external attendees need confirmation.                                             | Implemented (live Graph pending)  |
| PRD-COMM-004 | Attachments on outgoing email.                                                                                                                               | Planned (workbook link supported) |

### Finance (FIN)

| ID          | Requirement                                                                                                                                                                                                                                 | Status                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| PRD-FIN-001 | Each project records, in a currency (default INR): **Amount Raised and Overdue (for Go-Live)**, **Amount that can be raised on immediate basis**, **Total**, **Amount to be raised**, plus remarks, last updated time and person.           | Implemented                                                    |
| PRD-FIN-002 | **Total = Amount Raised and Overdue (for Go-Live) + Amount that can be raised on immediate basis**; it is calculated (in the app and by an Excel formula), never typed.                                                                     | Implemented (interpretation to confirm with Chat360 — ADR-019) |
| PRD-FIN-003 | Amounts are non-negative with at most 2 decimals; stale concurrent edits are rejected; every change is audited with old and new values.                                                                                                     | Implemented                                                    |
| PRD-FIN-004 | PM, the project's Delivery Head, Delivery Heads (portfolio) and the Sales POC can edit; the CSM can view; Tech Team, FDE, former PMs and administrators cannot see the figures in the app (including audit entries and transfer snapshots). | Implemented                                                    |
| PRD-FIN-005 | The tracker has a seventh sheet, **Finance** (`tblFinance`), kept in sync like the other sheets; an overdue amount above zero is highlighted.                                                                                               | Implemented (live Excel pending)                               |
| PRD-FIN-006 | Finance is part of the transfer handover summary, and analytics show per-currency totals for projects the viewer may see.                                                                                                                   | Implemented                                                    |
| PRD-FIN-007 | Restricting the Finance sheet inside the Excel file itself (separate workbook or sheet protection).                                                                                                                                         | Planned — see ADR-019                                          |

### Onboarding, support, account (ONB / SUP / ACCT)

| ID           | Requirement                                                                                                                                                              | Status      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| PRD-ONB-001  | Role-specific checklist; required vs optional steps; system-verified steps (role assigned, Outlook consent) cannot be self-ticked; incomplete until required steps done. | Implemented |
| PRD-SUP-001  | Support requests with id, category, subject, description, reporter, optional authorised project, priority, status, assignee, resolution notes, history.                  | Implemented |
| PRD-SUP-002  | Reporters see their own; admins triage all; configurable contact route.                                                                                                  | Implemented |
| PRD-ACCT-001 | Deactivation request explains consequences, requires recent sign-in and typed confirmation.                                                                              | Implemented |
| PRD-ACCT-002 | PMs with active projects are blocked until transfers; Delivery Head notified.                                                                                            | Implemented |
| PRD-ACCT-003 | Approval revokes sessions and access; data and Microsoft identity are not deleted.                                                                                       | Implemented |

### Analytics (ANALYTICS)

| ID                | Requirement                                                                                                                                                     | Status      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| PRD-ANALYTICS-001 | Product events (login, onboarding, project/workbook, tasks, confirmations, escalations, transfers, email/calendar outcomes, support) without content or tokens. | Implemented |
| PRD-ANALYTICS-002 | Delivery Head sees portfolio metrics; others see projects where they are PM/team member.                                                                        | Implemented |
| PRD-ANALYTICS-003 | Metric definitions (below) are documented; no fabricated or AI scores.                                                                                          | Implemented |

**Metric definitions (as computed in `packages/core/src/analytics.ts`):**

- _On-time completion_ = completed tasks whose actual end ≤ original deadline ÷ completed tasks (`n/a` if none).
- _Overdue tasks_ = open tasks whose current due date < today (org timezone).
- _Weekly commitments vs completion_ = tasks with an original or revised deadline in the ISO week vs. those completed within that week.
- _Project health_ = **red** if a high/critical escalation is open, ≥3 tasks overdue, go-live passed with open work, or go-live ≤14 days with <70% complete; **amber** if any escalation/overdue task, go-live ≤30 days with <50% complete, or an API past its target; otherwise **green**. Non-active projects are not rated.
- _Go-live risks_ = active projects going live within 30 days whose health is not green.
- _Escalation ageing_ = open escalations bucketed by time since trigger (<1, 1–3, 3–7, >7 days).
- _UAT ageing_ = working days since actual start of open tasks in a phase containing "UAT".
- _Client vs internal blockers_ = not-completed confirmations grouped by the configured side of their reason.
- _Workload_ = open tasks (and overdue) per owner.
- _Confirmation response rate_ = human decisions ÷ (human decisions + system no-response marks).

### Platform quality (NFR / SEC / OPS)

| ID          | Requirement                                                                                                       | Status                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| PRD-NFR-001 | Works on desktop, tablet and phone browsers; no horizontal overflow; 44 px touch targets on phones.               | Implemented (emulation only; real devices pending) |
| PRD-NFR-002 | Loading, empty, error (with recovery and error ID) and custom 404 states throughout.                              | Implemented                                        |
| PRD-NFR-003 | Accessible: labelled controls, keyboard navigation, visible focus, dialogs with focus management, reduced motion. | Implemented (no formal audit yet)                  |
| PRD-SEC-001 | Least-privilege Graph permissions; tokens never in the browser.                                                   | Implemented (admin consent pending)                |
| PRD-SEC-009 | Logs and analytics never contain tokens, cookies, email bodies or notes.                                          | Implemented                                        |
| PRD-OPS-001 | Scheduled jobs are idempotent, overlap-safe and can be disabled by admins.                                        | Implemented                                        |
| PRD-OPS-002 | Crash reports and backend errors carry ids and are visible to maintainers.                                        | Implemented (alert routing pending)                |

## 5. Business rules (summary)

- Dates are calendar dates in the org timezone (default Asia/Kolkata). "Today" is computed server-side.
- The original deadline never changes; the current due date is the latest revision.
- One human decision per task per day; repeating the same decision is idempotent, a contradictory one is rejected.
- Escalation level 1 goes to the project PM; level 2 to the project's Delivery and Operations Head; owner-as-manager skips a level.
- Only the current PM can request a transfer; only users with the Delivery Head role can approve, reject or reassign.
- Admins cannot remove their own admin role or deactivate themselves; PMs with active projects cannot be deactivated.

## 6. Delivery phases

| Phase                  | Scope                                                                     | State                                  |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| 0 Discovery            | Repo inspection (empty), docs, ADRs, CLAUDE.md                            | Done                                   |
| 1 Foundation           | Auth, roles, navigation, projects, workbook generation, tasks             | Implemented                            |
| 2 Delivery operations  | WBS/Gantt/APIs, daily confirmation, escalations, reminders, weekly sheets | Implemented                            |
| 3 Team ownership       | Team management, transfers, reassignment, handover, history               | Implemented                            |
| 4 Microsoft 365        | Outlook email and calendar                                                | Implemented, live verification pending |
| 5 Product operations   | Analytics, monitoring, onboarding, 404/states, support, account lifecycle | Implemented                            |
| 6 Conditional          | Billing and app-store evaluated: not applicable (ADR-015/016)             | Done                                   |
| 7 Production readiness | Tenant setup, live Graph tests, real-device tests, alerting, pilot        | **Pending external access**            |

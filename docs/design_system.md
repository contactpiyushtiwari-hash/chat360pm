# Design System

Source of truth: `apps/web/src/styles.css` (tokens and components) and `apps/web/src/components/ui.tsx` (React components). Plain CSS with custom properties; no CSS framework.

## Principles

Calm enterprise styling, dense but readable information, one obvious primary action per area, honest states (never show success before the server confirms), keyboard and screen-reader friendly, works on phones.

## Tokens

| Token                                      | Value                          | Use                                      |
| ------------------------------------------ | ------------------------------ | ---------------------------------------- |
| `--c-brand`                                | `#1f2a44`                      | Top bar, brand, milestones               |
| `--c-primary` / hover                      | `#1d4ed8` / `#1e40af`          | Primary buttons, links, active nav       |
| `--c-text` / `--c-muted`                   | `#1b2333` / `#5b6475`          | Body / secondary text (≥4.5:1 on white)  |
| `--c-bg` / `--c-surface` / `--c-surface-2` | `#f5f7fb` / `#fff` / `#f0f3f8` | Page / cards / subtle fills              |
| `--c-border` / `--c-border-strong`         | `#d9dfe8` / `#b8c2d1`          | Dividers / inputs                        |
| `--c-success` (+ soft)                     | `#067647`                      | Completed, synced, green health          |
| `--c-warning` (+ soft)                     | `#a24a06`                      | Blocked, pending, amber health           |
| `--c-danger` (+ soft)                      | `#b42318`                      | Overdue, failed, red health, destructive |
| `--c-info` (+ soft)                        | `#175cd3`                      | In progress, notices                     |
| `--c-focus`                                | `#2563eb`                      | Focus ring                               |

Typography: system UI stack (`Segoe UI` first — native on Chat360 Windows machines); sizes 12 / 13 / 15 (base) / 18 / 24 px; monospace for IDs (`T-0007`, `PRJ-…`). Spacing scale 4 / 8 / 12 / 16 / 24 / 32 px. Radius 8 px (cards, dialogs), 6 px (controls). Control height 40 px desktop, **44 px on phones**.

## Layout

- Shell: sticky top bar (56 px) + left nav (232 px) + main (max 1400 px). Below 900 px the nav becomes an off-canvas drawer opened by ☰; when closed it is `visibility: hidden` (not focusable). Route changes move focus to `<main>`.
- `grid-2` collapses to one column under 900 px; `stats` 4 → 2 columns.
- Tables collapse into labelled cards under 720 px (`td[data-label]`). Always set `data-label` on table cells.
- Dialogs become bottom sheets on phones.
- Environment banner (development/staging) at the very top.

## Components (`components/ui.tsx`)

| Component                                        | Notes                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `ButtonLink`                          | Variants `primary`, `secondary`, `danger`, `ghost`; `loading` shows a spinner, disables, sets `aria-busy`. Use `danger` for destructive or escalating actions. |
| `Card`                                           | Optional title and actions.                                                                                                                                    |
| `PageHeader`                                     | Sets `document.title`; title, subtitle, actions.                                                                                                               |
| `Badge`                                          | Maps domain values (health, status, sync state, severity) to tones; text is always present (colour is never the only signal).                                  |
| `Field` + `Input`/`TextArea`/`Select`/`Checkbox` | Label, hint and error wired via `id`/`aria-describedby`/`aria-invalid`; required shown with `*`. Server field errors (`error.fields`) map onto fields.         |
| `Dialog`                                         | `role="dialog"`, `aria-modal`, labelled by its title; focus moves in, Tab is trapped, Escape closes, focus returns.                                            |
| `Tabs`                                           | `role="tablist"`/`tab`/`tabpanel`, arrow-key navigation.                                                                                                       |
| `Spinner`, `Skeleton`                            | `role="status"`; use skeletons for page sections, spinners for short waits.                                                                                    |
| `EmptyState`                                     | Title, explanation and the next permitted action.                                                                                                              |
| `ErrorState` / `InlineError`                     | Message, recovery advice by error code, error/request id, Retry / Sign in / Get help.                                                                          |
| `ToastProvider` / `useToast`                     | Polite live region; success 4.5 s, error 8 s. Only after server confirmation.                                                                                  |
| `KeyValue`                                       | Definition list for details.                                                                                                                                   |
| `UserSelect` / `UserMultiSelect`                 | Directory pickers filtered by role; multi-select uses checkbox pills (touch-friendly).                                                                         |
| `HandoverView`                                   | Collapsible handover sections with counts.                                                                                                                     |
| `TaskList` / `TaskKanban` / `TaskGantt`          | Three views of the same tasks; list is the accessible equivalent of the Gantt.                                                                                 |

## States checklist (every data view)

1. **Loading:** skeleton or spinner; actions disabled while submitting (`useAction` blocks double submission).
2. **Empty:** `EmptyState` with a relevant next action allowed by the user's permissions.
3. **Error:** `ErrorState` with recovery text and Retry; 404 → `NotFoundPage`.
4. **Success:** toast after the server responds.
5. **Partial:** e.g. a transfer whose optional notification step failed → each step's outcome shown, with retry.

## Forms

Validate on the server (single source of truth in `@chat360/core/schemas`); disable submit until obvious requirements are met; show field errors inline; keep user input on error; confirmations for irreversible or outward-facing actions (PM reassignment, deactivation).

## Accessibility

Skip link; visible 3 px focus ring; all controls labelled; icons have text alternatives; status changes announced via live regions; colour contrast ≥ 4.5:1 for text; `prefers-reduced-motion` disables animations; touch targets ≥ 44 px on phones. Not yet done: formal audit with assistive technology users.

## Excel styling

Header rows navy with white bold text, date format `dd-mmm-yyyy`, Text format for ID/text columns, conditional formats: overdue rows soft red, Completed green, Blocked amber, Gantt bars blue with navy milestones, table style `TableStyleMedium2`.

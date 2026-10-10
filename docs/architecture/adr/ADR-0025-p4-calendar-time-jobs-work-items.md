# ADR-0025: Business calendar, time semantics, the scheduled-job kit, work items and the in-app inbox (P4 foundation)

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-01), 2026-10-09.
- **Requirements:** REQ-S10-006, REQ-S15-008, REQ-S16-005, REQ-S12-005 (slice I of `docs/architecture/p4-plan.md`).
- **Sources:** master prompt M0196 (§10 calendar), M0225 (§12 starter automation), M0302 (§15 time and currency), M0310 (§16 worker); ADR-0008 §5 ("Working-day calendar (later, P3/P4)").
- **Builds on:** ADR-0003 (UUIDv7, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization), ADR-0007 (API conventions), ADR-0008 (pg-boss, outbox, `processed_message`), ADR-0016 (record guards `0010`, lock registry §6).
- **Physical model:** `packages/db/migrations/0028_p4_calendar_jobs_work_items.sql`. Data dictionary "P4" section; ERD "P4" section.
- **Two gate systems.** Nothing here reads or writes the engineering gate records DG0–DG7. A scheduled job never grants a business approval (ADR-0026 §6).

## Context

P4 adds due dates that are counted in working days (T11 SLAs, approval due dates), recurring jobs (approval escalation, delegation expiry, reporting periods) and tasks that land in a person's My Work. The sources fix four rules:

- M0196: "Use Asia/Riyadh for the default business calendar, with configurable workweek, holidays and working-day SLAs. Do not hardcode public holidays or use elapsed calendar days when working days are specified."
- M0302: "Default timezone is Asia/Riyadh and currency SAR, both configurable. Store timestamps consistently and distinguish observation period, business date and event timestamp."
- M0310: "A durable worker/scheduler backed by the database; add a separate queue service only if justified and included in the self-hosted package."
- M0225: "Reporting period opens or update is due | Create owner tasks and in-app reminders with direct links".

As built before P4: `organization.default_timezone` (default `Asia/Riyadh`) and `organization.default_currency` (default `SAR`) exist (`0001`); `OrganizationUpdate` accepts `defaultTimezone` and `defaultCurrency`; pg-boss, `outbox_event` and `processed_message` exist (`0004`, `0006`, ADR-0008); no calendar, task or inbox table exists.

## Decision

### 1. Business calendar (REQ-S10-006)

**Entities** (`0028`):

| Table | Fields | Notes |
|---|---|---|
| `business_calendar` | `id`, `organization_id`, `code`, `name_en`, `name_ar`, `timezone` (default `Asia/Riyadh`), `workweek smallint[]` (ISO weekdays, 1 = Monday … 7 = Sunday; default `{7,1,2,3,4}` = Sunday–Thursday), `is_default`, `status` (`active` \| `archived`), `version`, stamps | Mutable, versioned, audited (`p2_attach_guards(…, true)`). |
| `business_calendar_holiday` | `id`, `organization_id`, `calendar_id`, `date_from`, `date_to` (inclusive), `name_en`, `name_ar`, `status` (`active` \| `removed`), `version`, stamps | Mutable, versioned, audited. Removal is a status change, never a DELETE. |

**Database invariants** (each fired by the probe, `T-DG4-ARCH-01-evidence/probe-output.txt`):

1. `workweek` is 1–7 distinct values from 1–7 (CHECK `business_calendar_workweek_valid`; probes G04, G05).
2. `timezone` names a zone in `pg_timezone_names` (trigger `business_calendar_timezone_known`; probe G06).
3. At most one calendar per organization has `is_default = true` (unique index `business_calendar_one_default`; probe G07), and a default calendar is `active` (CHECK).
4. A holiday range has `date_to >= date_from` and spans at most 31 days (CHECK `business_calendar_holiday_range`; probe G08).
5. Every insert or update needs its audit event at COMMIT, and `version` steps by exactly 1 (`0010` guards; probes G01, G03).

**No holiday is seeded.** `0028` creates, for every existing organization, one default calendar named `DEFAULT` with the organization's `default_timezone` and the Sunday–Thursday workweek, and zero holidays (`p4_ensure_default_calendar`, idempotent, audited as `system`/`migration` in the backfill; probe "backfill"). A new organization gets its default calendar when the API calls `p4_ensure_default_calendar(org, actor, requestId, 'api')` in the organization-create transaction (BE-A, work split §I).

**Working-day arithmetic** (`packages/shared/src/time/working-days.ts`, pure; BE-A):

- A date is a **working day** of a calendar if and only if its ISO weekday is in `workweek` **and** no `active` holiday of that calendar covers it.
- `addWorkingDays(raisedOn, n, calendar)`: the due date is the **n-th working day strictly after** the business date `raisedOn`. The raise day itself never counts, whether or not it is a working day.
- The function looks at most 3,660 calendar days ahead. If it finds fewer than `n` working days in that window, the result is **Unknown** (`null` with reason `calendar_not_configured`), never a guessed date.
- If the organization has no active default calendar, a working-day due date is **Unknown** with reason `calendar_not_configured`. It is never computed in elapsed calendar days.
- Worked examples (the probe does not run these; they are the unit-test fixtures BE-A must pin):
  - REQ-PB-066 / A09: raised Thursday 2026-10-08, n = 5, workweek Sunday–Thursday, no holiday → Sun 11, Mon 12, Tue 13, Wed 14, **Thu 2026-10-15**.
  - The same with a configured holiday on Sunday 2026-10-11 → Mon 12, Tue 13, Wed 14, Thu 15, **Sun 2026-10-18**.
  - REQ-S10-006: raised on Wednesday 2026-10-14, the day before a configured holiday on Thursday 2026-10-15, n = 5 → Sun 18, Mon 19, Tue 20, Wed 21, **Thu 2026-10-22** (Thursday 15 is skipped as a holiday, Friday and Saturday as weekend days). Without the holiday it is Wed 2026-10-21.
- A due date stored on a record (e.g. `approval.due_date`) also stores `calendar_id` and `calendar_version`. A later calendar change does **not** recompute stored due dates; only due dates computed after the change use it.

**Authorization:** reading calendars and holidays needs `organization.read` on the organization (every seeded role holds it, including AUD; AUD is read-only). Creating or changing them needs `calendar.configure` (category `configure`), granted to `ADM_TECH` only (REQ-S10-006 "configure:ADM"). AUD gets 403 on every write.

**Refusals** (problem `code`, English `detail`; Arabic in `i18n/ar/problems.json`, translated at render time):

| Status | Code | English text |
|---|---|---|
| 422 | `calendar.workweek_invalid` | "The workweek must list one to seven different weekdays (1 = Monday … 7 = Sunday)." |
| 422 | `calendar.timezone_unknown` | "The time zone {timezone} is not a known time zone." |
| 409 | `calendar.code_taken` (`urn:mth:problem:duplicate`) | "A calendar with the code {code} already exists in this organization." |
| 422 | `calendar.holiday_range_invalid` | "A holiday ends on or after its start date and spans at most 31 days." |
| 422 | `calendar.default_not_archivable` | "The default calendar cannot be archived. Make another calendar the default first." |

### 2. Time semantics: observation period, business date, event instant (REQ-S15-008)

Three distinct attributes. A P4 record that needs one of them uses exactly these column shapes:

| Attribute | Column shape | Meaning |
|---|---|---|
| Event instant | `*_at timestamptz` | When something happened. Stored as an absolute instant; node-postgres returns it as a `Date`; the API renders it as RFC 3339 UTC (ADR-0007 "Values"). |
| Business date | `business_date date` (or a named `*_date date`) | The calendar date of the event in the organization's calendar timezone: `p4_business_date(at, timezone)` = `(at AT TIME ZONE timezone)::date` (SQL, `0028`) and its TypeScript twin `businessDateOf(at, timezone)` in `packages/shared/src/time/` (BE-A). |
| Observation period | `period_start date`, `period_end date`, `period_label text` on the record that owns it | The period the value describes, chosen by the user or the reporting-period schedule, never derived from the entry instant. KPI actuals carry it (slice A, ADR-0027). |

- REQ-S15-008 example: an actual for period 2026-10 entered at 2026-11-02 23:30 Asia/Riyadh is stored with `period_label = '2026-10'`, `business_date = 2026-11-02` and the event instant `2026-11-02T20:30:00Z`. The probe (G09) checks `p4_business_date('2026-11-02T20:30:00Z', 'Asia/Riyadh') = 2026-11-02`, and that an entry at 00:30 Riyadh on 2026-11-02 (`2026-11-01T21:30:00Z`) has business date 2026-11-02, not the UTC date 2026-11-01.
- In P4 these columns are used by: `approval.request_business_date`, `approval_decision.business_date`, `approval.due_date`, `work_item.due_date` and `work_item.period_label` (this task); slice A adds the KPI actual columns.
- **Display.** The web shows instants in the user's `app_user.timezone`, or else the organization's `default_timezone`.
- **Currency.** `organization.default_currency` (default `SAR`) is the value a money-bearing record copies into its own `currency` column **when it is created**. Changing the organization default through `updateOrganization` updates only the `organization` row: the P2/P3 tables that carry a `currency` column store it per row as `char(3)` (catalogue test "stores money-bearing currency as char(3)"), and no trigger or job copies the new default into existing rows. Every P4 slice that adds a money column adds a per-row `currency` column with it (work split shared rule S-5).

### 3. Scheduled-job kit (REQ-S16-005)

- **No new queue service.** pg-boss on the product PostgreSQL stays the only queue (ADR-0008 §1); M0310's condition for adding one is not met.
- **`job_schedule`** (`0028`): `id`, `code`, `queue_name`, `cron` (five fields), `timezone` (default `Asia/Riyadh`), `enabled`, `description_en/ar`, `owner_module`, `version`, stamps. Platform-wide (no `organization_id`). Mutable, versioned, audited. `mth_app` has `SELECT, UPDATE` (no INSERT: rows come from migrations). Seeded rows (each audited `system`/`migration`; probe J01):

  | `code` | cron (Asia/Riyadh) | Owner | Purpose |
  |---|---|---|---|
  | `approval.escalation_scan` | `*/15 * * * *` | workflows (BE-B) | REQ-S10-019 (ADR-0026 §6) |
  | `delegation.expiry_sweep` | `*/15 * * * *` | access (BE-B) | REQ-S10-010 |
  | `kpi.reporting_period_open` | `5 0 * * *` | kpi (KBE-C) | REQ-S12-005 |

  Later slices insert their own rows in their own migrations.
- **Registration.** At start, and when it receives the outbox event `job_schedule.updated`, the worker calls `boss.schedule(queue_name, cron, {}, { tz: timezone })` for every enabled row and `boss.unschedule(queue_name)` for every disabled one (BE-A).
- **Rules for every P4 job handler** (BE-A writes the helper `runOnce(consumer, key, fn)` in `apps/worker/src/kit.ts`; every handler uses it):
  1. The handler derives a deterministic **idempotency key** for each effect: `<rule>:<subject id>:<slot>[:<recipient>]`, where the slot is the period label, the due date or the round that makes the effect unique (examples: `kpi.period_open:<kpiDefinitionId>:2026-10:<ownerUserId>`, `approval.escalate:<approvalId>:<round>:<dueDate>`).
  2. The effects and the `processed_message (consumer, idempotency_key)` row are written in **one transaction**. A redelivery or a restart finds the ledger row and does nothing.
  3. Every effect table carries its own unique key as a second line of defence: `work_item (organization_id, dedupe_key)`, `inbox_notification (organization_id, dedupe_key)` (probe G12), `approval_escalation (approval_id, round_no, due_date)` (ADR-0026 §6; probe A19).
  4. No remote I/O inside the transaction.
  5. Audit events of a job carry `actor_type = 'service'` and `source = 'worker'`. A service actor holds no permission and never decides an approval (ADR-0006, ADR-0026 §6).
  6. Retries and the failure queue are ADR-0008 §4's (5 attempts, then `ops.failed`).
- **Kill and restart (A13).** Items 2 and 3 are the whole guarantee: an effect is either committed together with its ledger row or not at all, and a second commit of the same effect violates a unique key. The executable proof (kill the worker mid-job, restart, count rows) is BE-A's integration test plus QA's A13 (p4-plan §5).
- **Authorization.** `GET /api/v1/admin/job-schedules` needs `job.read`; `PATCH /api/v1/admin/job-schedules/{code}` (enabled, cron, timezone) needs `job.configure`. Both go to `ADM_TECH` only (REQ-S16-005 "view-jobs:ADM"). Refusals: 422 `job.cron_invalid` "The schedule must be a cron expression with five fields."; 422 `job.timezone_unknown` "The time zone {timezone} is not a known time zone."

### 4. Work items (My Work tasks) and the in-app inbox (REQ-S12-005)

**`work_item_kind`** (seeded, read-only): `code`, `owner_module`, `label_en`, `label_ar`, `source_ref`. `0028` seeds `kpi_update_due`, `approval_decision`, `approval_escalated` and `approval_changes_requested`. Later slices insert their own kinds in their own migrations, so no CHECK has to be widened.

**`work_item`**: `id`, `organization_id`, `transformation_id` (nullable), `kind`, `assignee_user_id`, `subject_type`, `subject_id`, `link_path`, `message_key`, `message_params jsonb` (object), `due_date` (business date, nullable = no due date), `period_label`, `status` (`open` → `done` | `cancelled`), `completed_at`, `completed_by`, `dedupe_key`, `created_source` (`api` | `worker` | `migration`), `version`, stamps.

- **Text is translated at render time.** A work item stores an i18n key and parameters, never a sentence.
- **Links are relative.** `link_path` starts with one `/` (CHECK; probe G13). The web turns it into a route.
- **Database invariants:** unique `(organization_id, dedupe_key)` (probe G12); kind, assignee, subject and dedupe key are immutable (trigger `work_item_guard`); a `done` or `cancelled` item never changes status again (probe G15); `status = 'done'` exactly when `completed_at` is set (CHECK); audit and version guards (probes G10, G11, G14).

**`inbox_notification`** (the in-app reminder): `id`, `organization_id`, `transformation_id`, `recipient_user_id`, `work_item_id`, `link_path`, `message_key`, `message_params`, `dedupe_key`, `read_at`, `version`, stamps. Unique `(organization_id, dedupe_key)`. `read_at` is set once, and recipient and dedupe key never change (trigger `inbox_notification_read_once`; probe G17). P4 has no email or messaging channel (p4-plan "Rows that may belong to a later stage").

**Creation service** (`tasks/service.ts`, BE-A): `createWorkItemOnce(tx, { kind, assignee, subject, linkPath, messageKey, params, dueDate, periodLabel, dedupeKey })` inserts the work item and one notification with the same dedupe key, plus their audit events, using `INSERT … ON CONFLICT (organization_id, dedupe_key) DO NOTHING`. It returns `created | existing`. Domain modules call it; they never insert into `work_item` themselves.

**REQ-S12-005 flow.** The `kpi.reporting_period_open` handler (KBE-C, slice A) opens each due reporting period and, for each active KPI definition in it, calls `createWorkItemOnce` for the KPI owner with kind `kpi_update_due`, dedupe key `kpi.period_open:<kpiDefinitionId>:<periodLabel>:<ownerUserId>`, the period label, and a link to the KPI update screen. That gives one task and one reminder per owner and KPI, and a restart creates none twice (§3 items 2–3).

**Authorization and actions:**

| Operation | Rule |
|---|---|
| `GET /api/v1/me/work-items` | the caller's own items only (`assignee_user_id = caller`), cursor-paginated, filter by `status`, `kind`, `transformationId`. Needs a session, no permission. |
| `GET /api/v1/work-items/{workItemId}` | the assignee only; anyone else gets 404. |
| `POST /api/v1/work-items/{workItemId}/complete` (`If-Match`) | the assignee only (403 `work_item.not_assignee`). A kind whose task closes with its subject (`approval_decision`, `approval_escalated`) refuses manual completion with 422 `work_item.system_managed`. |
| `GET /api/v1/me/inbox` | the caller's own notifications, newest first, cursor-paginated, with an `unreadCount`. |
| `POST /api/v1/me/inbox/{notificationId}/read` (`If-Match`) | the recipient only; anyone else gets 404. |

Refusals:

| Status | Code | English text |
|---|---|---|
| 403 | `work_item.not_assignee` | "Only the person this task is assigned to can complete it." |
| 422 | `work_item.closed` | "This task is already closed." |
| 422 | `work_item.system_managed` | "This task closes automatically when its approval is decided." |
| 422 | `inbox.already_read` | "This reminder is already marked as read." |

AUD holds no work item, so every work-item and inbox write by an AUD user is refused (404 or 403 as above).

### 5. Decimal and Unknown

Slice I stores no money, rate or FTE value. Its Unknowns are explicit: a working-day due date that cannot be computed is `null` with a reason (`calendar_not_configured`), shown as Unknown, never as a date counted in elapsed days and never as "on time".

## Alternatives considered

- **Hard-coded Saudi public holidays.** Rejected by M0196.
- **A separate queue service (Redis/BullMQ).** Rejected: M0310's justification test is not met; pg-boss already provides cron in a timezone, retries and a dead-letter queue (ADR-0008).
- **Store local wall-clock time.** Rejected: ambiguous across timezone changes. Instants are stored as instants, and dates are explicit `date` columns.
- **Free-text task titles.** Rejected: they cannot be translated at render time (DG2/DG3 lesson 6).
- **Recompute stored due dates when the calendar changes.** Rejected: due dates already communicated would move silently. A stored due date pins `calendar_version` instead.

## Consequences

- `0028` adds six tables and three SQL functions. `packages/db/src/schema.ts`, `catalogue.test.ts` (versioned tables, grants) and the data dictionary list them.
- BE-A owns the TypeScript twins (`businessDateOf`, `addWorkingDays`) and must pin the three worked examples above in unit tests, with the locale unset and with `C.UTF-8`.
- Every later slice that creates tasks or reminders uses `createWorkItemOnce` and adds its kinds by migration.

## Verification

Evidence: `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/probe-output.txt` (PostgreSQL 16.13, disposable cluster). Probes for this ADR: "fresh database", "P4 over P3 database", "backfill: one default calendar per organization", "p4_ensure_default_calendar is idempotent", G01–G17, J01–J02. Not verified by this task, and assigned in the work split: the TypeScript working-day function and its worked examples (BE-A), the worker kill-and-restart test (BE-A, QA A13), and every API refusal above (BE-A).

## Amendment (2026-10-09, T-DG4-ARCH-R1): codes and keys added outside the ADR

### A1. Codes and keys added outside the ADR's refusal table (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `validation.job_code` | 400 field | accepted | A job code is two lower-case words joined by a dot, such as kpi.reporting_period_open. |
| `validation.link_path` | 400 field | accepted | A link must be a path inside this application that starts with a single '/'. |
| `validation.pattern` | 400 field | accepted | Use lower-case letters and '_' only. |

## Amendment (2026-10-10, T-DG4-ARCH-R2): §3 and §4 as built (BE-R1, BE-R2), and a subject-neutral `work_item.system_managed` text

Sources: BE-R1 handback §6 items 1 and 3; BE-R2 handback §5 (D-109, D-110). Nothing above is removed. Where this amendment and §3 or §4 differ, this amendment wins.

### D1. §3: the worker passes each handler its attempt (BE-R2)

Added to the rules for every P4 job handler, as rule 7:

- `apps/worker/src/worker.ts` subscribes every domain handler with `includeMetadata: true`.
- It passes `{ retryCount, retryLimit }` from the job's metadata as the fourth argument of `JobHandler.handle(db, data, jobId, attempt?)`. The type is `JobAttempt`, in `apps/worker/src/handlers/spec.ts`.
- `retryCount` is the number of retries already made (0 on the first attempt). An attempt is the **last** when `retryCount >= retryLimit`, pg-boss's own rule.
- A handler that must record something on its last attempt reads only this argument. `kpi.recalculate` does (ADR-0027 amendment C2). A handler never reads pg-boss's job table.
- When `attempt` is absent (a direct call), the call is not known to be the last attempt.

### D2. §4: work items follow their source (BE-R1; D-102, D-105)

**Two services in `apps/api/src/modules/tasks/service.ts`**, exported by `tasks/index.ts`, with twins in `apps/worker/src/kit.ts` (ADR-0002 rule 5). The parity test `apps/api/test/integration/tasks/work-items.test.ts` proves that both produce the same rows and audit events.

- **`rescheduleWorkItemsOfSubject(tx, actor, { organizationId, subjectType, subjectId, kinds }, dueDate)`.**
  - Locks the source's **open** items of the given kinds `FOR UPDATE`, in id order.
  - Sets `due_date` on each item whose date differs (null = no due date, never guessed), with `version + 1`.
  - Writes one audit event per moved item: the new action **`work_item.reschedule`**, with `changes: { due_date: { from, to } }` and the prior and new versions.
  - Returns how many items moved. Items already on that date are skipped, so a repeat call writes nothing.
  - `kinds` must not be empty (a programming error otherwise).
- **`reassignWorkItemOfSubject(tx, actor, input)`** (`input` is a `createWorkItemOnce` input).
  - Makes `input.assigneeUserId` the holder of the source's only open item of `input.kind`.
  - Every open item of another assignee is cancelled. Each cancellation is the existing action `work_item.cancel`, with `reason: "reassigned"` and `changes.status` `open → cancelled`.
  - If the new assignee already holds an open item, nothing else happens: `unchanged` when nothing was cancelled, else `reassigned`.
  - Otherwise one item is created through `createWorkItemOnce`. The key is the ADR dedupe key when it is free, else its first free variant **`<dedupeKey>#n`** (n = 2, 3, …), with at most 100 keys tried and then a programming-error throw. Its notification takes the same key.
- **Why `#n`.** The `0028` guard `work_item_guard` keeps the assignee and the dedupe key immutable, and a closed item never reopens. So an owner who returns (A → B → A) gets a new item under a new key. The base key stays reserved, so a redelivered creation still creates nothing.
- **Concurrency.** The caller holds the source row's `FOR UPDATE` lock, so reassignments of one source are serialised.
- **Consumers** (BE-R1): RAID actions (`raid/actions.ts`), corrective cases (follow-up date), adoption interventions (due date) and executive-decision asks (required date). Each calls reassign only when the owner changed, and reschedule only when the date changed. So a plain edit never recreates an item that its owner has already completed by hand.
- **Dedupe keys elsewhere.** Every dedupe key that the ADRs give for a reassignable task (ADR-0031 §4 `raid.action:…`, §5.6 `corrective.follow_up:…`, ADR-0033's intervention task, ADR-0032 §6's executive-ask task) also exists in the `#n` form after an A → B → A reassignment. A reader of `work_item.dedupe_key` must match the base key or `^<base>#[0-9]+$`, never only the exact base.

### D3. §4: `work_item.system_managed`, a subject-neutral text (BE-R1 handback §6 item 3)

- **As built,** three kinds refuse manual completion (`SYSTEM_MANAGED_KINDS` in `tasks/routes.ts`): `approval_decision` and `approval_escalated` close when the approval is decided, and `corrective_case_follow_up` closes when the corrective case closes (ADR-0031 §5.6). The §4 text, "This task closes automatically when its approval is decided.", is untrue for the third kind.
- **Decided text** for every kind (replaces the §4 row):

  | Status | Code | English text (exact) |
  |---|---|---|
  | 422 | `work_item.system_managed` | "This task closes automatically when the record it belongs to is decided or closed." |

- **Implementer change (BE-R3):** `taskRefusals.systemManaged` in `apps/api/src/modules/tasks/routes.ts`, and its assertion in `tasks.test.ts` and any integration test that pins the old text.
- **Implementer change (FE task):** `work_item__system_managed` in `apps/web/src/i18n/en/problems.json`, with the new English text, and in `ar/problems.json`, a new Arabic text marked provisional.
- **Unchanged:** the code, the status and the kinds.
- The §4 operations table line "A kind whose task closes with its subject (`approval_decision`, `approval_escalated`) …" is to be read with `corrective_case_follow_up` added.

### D4. Codes and keys

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `work_item.system_managed` | 422 | text changed (D3) | This task closes automatically when the record it belongs to is decided or closed. |
| `work_item.reschedule` | audit action | accepted (BE-R1) | Task due date changed (the audit-trail label the FE task adds; the server sends only the action) |

## Amendment (2026-10-10, T-DG4-ARCH-R3): record names in message parameters

Source: FE-R1 handback §5 item 5 (D-112). Nothing above is removed. Where this amendment and §4 differ, this amendment wins.

### L1. The rule for a record's name in `messageParams` (decided: both names)

**The gap.** `governance.task.minutes_to_approve` sends `forum` = the forum's `name_en` (`governance/minutes.ts`), so an Arabic reader sees the English forum name inside the Arabic sentence.

**Decided: a record whose name the product stores in both languages passes both names.**
- `<param>` stays the **English** name, under the key it has today. Stored rows and the English rendering are unchanged.
- `<param>Ar` is the **Arabic** name (`name_ar`), added beside it.
- **Rendering.** In Arabic, a placeholder `{<param>}` (written `{{<param>}}` in the web's i18next files) takes `params["<param>Ar"]` when that member is a non-empty string, and otherwise `params["<param>"]`. In English, it always takes `params["<param>"]`. A `…Ar` member is never a placeholder of its own. So the EN and AR templates keep the same placeholder set, and a row written before this amendment (no `…Ar` member) renders as today.
- **Which names it covers.** A record whose display name the product stores in both languages: an English column `name_en`, `source_name_en`, `label_en` or `source_label_en`, with the Arabic `name_ar` or `label_ar` beside it. As of migration `0060`, exactly 22 tables have such a pair (a scan of every `CREATE TABLE` and `ALTER TABLE … ADD COLUMN` in `packages/db/migrations/*.sql`; output `bilingual-name-columns.txt` in the T-DG4-ARCH-R3 handback evidence):
  - `name`: `access_group`, `business_calendar`, `business_calendar_holiday`, `business_unit`, `forum`, `organization`, `roadmap_wave`, `role`; and `diagnostic_workstream`, `gate_definition`, `phase_definition` (English column `source_name_en`);
  - `label`: `approval_type`, `benefit_formula_example_variable`, `dependency_type`, `diagnostic_dimension`, `gate_criterion_definition`, `governance_party`, `resource_role`, `tom_dimension`, `transformation_raci_deliverable`, `work_item_kind`; and `good_outcome_criterion` (English column `source_label_en`).
  - A catalogue record that a param already names by its code (for example `approvalType`, `partyCode`, `gateCode`) keeps the code: the client labels codes from its code tables, as the next bullet says.
  - The rule applies to any later producer that passes such a name, and to any later table with such a pair.
- **What it does not cover:**
  - single-language text the user typed (a title, a KPI name, a form name, a performance-area name) is passed as is, because it has no second language;
  - codes (`gateCode`, `phaseCode`, `stepKey`, `partyCode`, `roleCode`, `approvalType`, `criterionKey`, `dimensions`) stay codes, and the client labels them from its code tables (`CODE_PARAMS`);
  - ids, dates and numbers are unchanged.

**Rejected:**
- **A code only.** A forum code is not what a reader recognises, and it would change the existing English text.
- **A record reference resolved at render time.** It would make My Work read one record per item, and a deleted or renamed record would change the text of a past task.

**Every key it affects today (enumerated).** The scan covered every `messageParams:` and `message_params:` producer in `apps/api/src` and `apps/worker/src` (non-test), plus the producers that pass a `params` variable (the `escalations.ts` and `gates.ts` worker handlers, `tasks/meeting-action-follow.ts`, and the `tasks/service.ts` and `worker/src/kit.ts` pass-throughs). No migration writes `message_params`. Exactly one key passes the name of a bilingual record:

| Key | Param today | Change |
|---|---|---|
| `governance.task.minutes_to_approve` | `forum` = `forum.name_en` | add `forumAr` = `forum.name_ar` (ADR-0032 amendment G3) |

Every other param is one of: a user-typed single-language text (`title`, `kpiName`, `formName`, `areaName`, `delayImpact`), a reporting-period label (`periodLabel`, an ASCII code such as `2026-Q3`), a code, an id, a hash (`snapshotSha256`), a date or a number. The scan output is in the T-DG4-ARCH-R3 handback evidence (`message-params-scan.txt`).

**Notices.** The same rule applies to `InboxNotification.messageParams`. No notice passes a bilingual record's name today.

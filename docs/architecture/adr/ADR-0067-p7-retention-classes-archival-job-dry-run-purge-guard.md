# ADR-0067: P7 retention and archival: a retention class for every table (generated from the catalogue, test-enforced), per-class period, action and IT approval reference text, the archival job with its dry run, exactly-once runs, one audit event per action, and a database purge guard that can never delete business, audit or snapshot records

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-03), 2026-11-12. Base `aaaf9b6034a62b52cea5ddb9d80834ea7b9d1906` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirement (slice E of `docs/architecture/p7-plan.md`):** REQ-S16-024. Backup and restore is ADR-0066; upgrades are ADR-0068.
- **Sources (quoted where a design point has one):**
  - M0329 (§16): "Protect finalized records and evidence from destructive deletion. Define retention and archival policies; soft deletion is not a substitute for an approved retention policy."
  - REQ-S16-024 (binding, `docs/delivery/requirements.csv`): acceptance "A19;A22: the retention configuration lists every record class; an archival job run on test data archives only records past retention and logs each action"; note "Retention periods must be agreed with Mobily IT; defaults are placeholders."; access "configure:ADM(IT-approved); view:AUD,ADM"; screen "Administration > Retention".
  - Playbook: no block concerns data retention. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q3**: "retention defaults `retain`, nothing purged in business classes". The plan's recommendation, adopted as written: "every class defaults to `retain` with period 'not set (IT to agree)' … `archive` means the record is written to an archive set in the migration-manifest format (checksummed, in evidence storage) and its live row is marked archived and made read-only; `archive_then_purge` is allowed in P7 only for operational classes … business records, audit and snapshots are never purged by P7 code."
  - The assignment: the IT approval is a **reference** text, never an approval by an agent or by the platform.
  - p7-plan §3 seam 4 (job kit: "the archival schedule ships **disabled**"), seam 5 (reports and snapshots), seam 6 (permissions), seam 9 (deletion and retention).
- **Builds on:** ADR-0003 (no hard delete through the API; "an explicit, audited retention job in a later stage"), ADR-0004 (audit), ADR-0008 and ADR-0043 (worker kit and schedules), ADR-0010 (EvidenceStore; `delete(key)` "reserved for an approved retention job only"), ADR-0016 §6 (lock registry), ADR-0045 (report snapshots), ADR-0053 (service identities), ADR-0064 §2.3 (row encoding).
- **Two gate systems.** A retention class, its IT reference text, a run and an archived-record marker are engineering and operations records. Holding `retention.configure` approves nothing: the reference text records an approval Mobily IT gave **outside** the platform. No agent fills it with a real reference; tests use texts marked `TEST-ONLY`. Nothing here reads or writes DG0–DG7.

## Context

What exists at `aaaf9b60` (read from the tree):

1. **No hard delete through the API** (ADR-0003), `ON DELETE RESTRICT` on every foreign key, append-only history tables (`p2_attach_append_only`) and an append-only `audit_event`.
2. **One existing expiry sweep.** `apps/worker/src/handlers/platform.ts` `purgeExpired` (DG1) deletes expired or revoked `session` rows, expired `oidc_login_state` rows and expired `idempotency_record` rows. It is not a retention policy; it keeps credential material from accumulating.
3. **Every public base table has a primary key** (0143 stops otherwise, because `key_columns` must have one to four columns), so every record has a stable key for an archive marker.
4. **Operational tables that grow without bound:** `processed_message`, `worker_heartbeat`, `inbox_notification` (read items), `job_run` (append-only), `webhook_receipt` (append-only).

## Decision

### 1. Two tables: the classes and the table map (0143)

- `retention_class`: one row per record class with `code`, `category`, bilingual label and description, `managed_by_job`, `action`, `period_days`, `it_approval_reference`, `version`. `mth_app` may update only `action`, `period_days`, `it_approval_reference` and the version columns; every change is audited (`p2_audit_required`). A class is never deleted.
- `retention_table_class`: one row per public base table with its class, its primary key columns (`key_columns`), its `age_column` (the timestamp that decides a record's age; NULL means a run never selects it) and `purge_eligible`. Written by migrations only, append-only.
- **Generated from the catalogue.** 0143 inserts the explicit rows of §3, then every other public base table **that exists** as `business_record`, reading its primary key from `pg_index`. A `DO` block checks that every explicit row names the table's real primary key and a `timestamptz` age column, so a typo stops the migration.
- **Test-enforced.** `catalogue.test.ts` "every public base table has exactly one retention class with its real primary key" fails, naming the table, when a later migration creates a table without adding its `retention_table_class` row **in the same file**. This is a rule for every later migration, in P7 and after (§E.3).

### 2. The classes and their rules (D-243 Q3)

| Code | Category | Can leave `retain`? | Tables |
| --- | --- | --- | --- |
| `business_record` | business | **never** | every table not listed below (generated) |
| `audit_trail` | audit | **never** | `audit_event` |
| `report_snapshot` | snapshot | **never** | `report_snapshot`, `report_snapshot_aggregate`, `report_snapshot_evidence`, `report_snapshot_source`, `report_snapshot_version`, `ranking_snapshot` |
| `system_catalogue` | system | **never** | `schema_migration`, `transfer_table_rule`, `transfer_column_rule`, `retention_class`, `retention_table_class` |
| `derived_index` | derived | **never** | `search_document`, `search_index_state` |
| `retention_backup_history` | audit | **never** | `retention_run`, `retention_run_action`, `retention_archived_record`, `backup_set` |
| `expiring_credential` | operational | **never** (`managed_by_job` = `platform.purge-expired`) | `session`, `oidc_login_state`, `idempotency_record` |
| `job_history` | operational | `archive` only | `job_run` (age `finished_at`; append-only) |
| `webhook_receipt_log` | operational | `archive` only | `webhook_receipt` (age `received_at`; append-only) |
| `processed_message_log` | operational | `archive` or `archive_then_purge` | `processed_message` (age `processed_at`) |
| `worker_heartbeat_log` | operational | `archive` or `archive_then_purge` | `worker_heartbeat` (age `last_beat_at`) |
| `inbox_read_item` | operational | `archive` or `archive_then_purge` | `inbox_notification` (age `read_at`; unread items have no age) |

Rules, each enforced by the database and each with a probe test:

- **Default.** Every class ships `retain` with `period_days` NULL, shown as "Not set (IT to agree)" and never as 0. A fresh installation archives and purges nothing.
- `CHECK retention_class_retain_only`: only an operational class not managed by an existing job can leave `retain`. Business, audit, snapshot, system and derived classes can never be archived or purged by P7 code.
- `CHECK retention_class_enabled_shape`: an enabled action needs a period **and** the IT reference text.
- Trigger `retention_class_guard`: `archive` needs an age column on every table of the class; `archive_then_purge` needs every table purge-eligible; the class definition (code, category, labels, `managed_by_job`) never changes.
- **Purge-eligible** means: operational class, an age column, and no append-only trigger on the table. The catalogue test pins the five aged tables and asserts that no purge-eligible table is append-only.
- **Evidence** (`evidence`, `evidence_content`, the bytes in the EvidenceStore) is in `business_record`: retained, never archived or purged, and `EvidenceStore.delete` is still never called (ADR-0010 holds).
- **The expiry sweep is not changed.** `platform.purge-expired` keeps deleting expired credentials; the class documents it and stays `retain`, so its credential hashes are never written to an archive set (D-243 Q16).

### 3. Seams 5 and 9

- **Seam 5 (reports and snapshots): additive.** Snapshot tables are never archived or purged, so no approved snapshot or historical report can change (A07). Business records a snapshot or a total depends on are `business_record`, retain-only.
- **Seam 9 (deletion): additive while every class is `retain`, which is the shipped state.** Two triggers are added to approved tables, `inbox_notification_archived_read_only` and `worker_heartbeat_archived_read_only` (0144). They are inert until an administrator enables archiving for those classes and a run archives a row. **Enabling** `archive` or `archive_then_purge` for `inbox_read_item` or `worker_heartbeat_log` on an installation changes approved behaviour (an archived read item can no longer be marked unread; a purged one disappears from the inbox). It is an operator decision with an IT reference, not a code change; the admin guide states the effect beside the control. The approved P6 trigger pin for `worker_heartbeat` in `catalogue.test.ts` gains this one line (additive; recorded in the handback).

### 4. Runs (0144 `retention_run`)

- **Modes.** `dry_run` (`createRetentionDryRun`) records `would_archive` and `would_purge` actions and writes nothing else: no archive set, no marker, no delete (CHECK `retention_run_dry_run_writes_nothing`). `run` (`createRetentionRun`) archives and purges.
- **States.** `queued → running → succeeded | failed`; terminal states are immutable; `mode`, `requested_via` and `as_of` never change (trigger `retention_run_guard`).
- **At most one run is queued or running** (index `retention_run_one_active`); the API answers a second request with 422 `retention.run_in_progress`. A class update, a run request and the job's start take advisory lock **730410** `retentionRun` (key `retention`), so a run never sees a class change half-way. The job copies the period it applied into every action row.
- **The job** `retention.archive` (BE-G, `apps/worker/src/handlers/retention/**`) runs under its own service identity `job:retention.archive` (ADR-0053; platform scope; declared and granted codes `retention.read` only, since it writes through the run it was given and the purge function, not through a permission). Its `job_schedule` row (weekly, `Asia/Riyadh`) ships **disabled** (seam 4). Both rows are BE-G's migration (`0147`).
- **`as_of`** is fixed when the run is requested (API: `now()`). A record is a candidate when its age column is not NULL and is older than `as_of − period_days` of its class.
- **Exactly once per run.** The pg-boss job's singleton key is the run id; the job moves `queued → running` once (a redelivered job finds the run `running` or terminal and stops); `retention_run_action` is unique on `(run, table, record key, action)`; `retention_archived_record` is unique on `(table, record key)`, so a record is archived once, ever.

### 5. Archive: the set, the marker, read-only

- **The archive set** is written **before** any marker, under `retention/<runId>/` in the EvidenceStore: `manifest.json` (`schemaVersion` `mth-retention-archive/1`) and `tables/<table>.ndjson`. The table files and the manifest's table entries use exactly the ADR-0064 §2.3 row encoding and §2.1 table entry (`name`, `rowCount`, `fileSha256`, `contentDigest`, `columns`), so any reader of a migration package reads them. The manifest adds `runId`, `asOf`, and per table the class code and the period applied. `retention_run.archive_set_key`, `archive_set_sha256` and `archive_set_bytes` record it (CHECK: the key is `retention/<runId>/manifest.json`).
- **The record key** of a row is its primary key columns as a text-valued JSON object, for example `{"consumer":"…","idempotency_key":"…"}` (`retention_record_key()`). It never holds other row content.
- **The marker** (`retention_archived_record`) is inserted in the job's transaction. Its trigger re-checks **in the database** that the run is a running `run`, that the table's class is enabled, that the key is exactly the primary key, and that the live row's age is older than `as_of − period`, **equal to the `record_age_at` given**. So a record that is not past retention can never be marked archived, whatever the job computes. The job reads `record_age_at` as text from SQL (a JavaScript `Date` drops microseconds; the probe uses whole seconds).
- **Read-only.** While a marker has no `purged_at`, `retention_archived_row_guard()` refuses an UPDATE of the live row (on the two archivable tables the runtime may update; `job_run`, `webhook_receipt` and `processed_message` cannot be updated by `mth_app` at all).
- **Restoring an archived record into the live table** is not built in P7 (Residual 2). The set is readable NDJSON.

### 6. Purge and the per-action log

- **The only delete path** is `retention_purge_record(run, table, key)`, `SECURITY DEFINER`, owned by `mth_owner`. `mth_app` has no DELETE on any table this ADR covers. The function refuses unless: the run is a running `run`; the table is purge-eligible and its class is operational and `archive_then_purge`; the table has no append-only trigger; a marker exists without `purged_at`; and the row is still past retention. A row still referenced by a foreign key (an inbox item with a delivery record) is not deleted: the function returns `false` and the job logs `skipped_referenced`. The row stays archived and read-only.
- **Business, audit and snapshot records can never be purged:** their classes can never be `archive_then_purge` (CHECK), no table of theirs is purge-eligible, and the function re-checks both.
- **One audit event per action.** Every `archived`, `purged` and `skipped_referenced` row of `retention_run_action` needs an `audit_event` with `record_type` `retention_run_action` and its id in the same transaction (deferred trigger). Action codes: `retention.archived`, `retention.purged`, `retention.skipped`. A dry run writes its `would_*` rows without per-row events and is audited once, on the run (`retention_run.requested`, `.started`, `.succeeded`/`.failed`).
- `listRetentionRunActions` returns the log (key values, class, period, age, action) and never row content. Order of work per batch (≤ 500 rows, one transaction): marker → `archived` action + event → purge → `purged` or `skipped_referenced` action + event.

### 7. API, screen and permissions (seam 6; seeded by 0146)

- **10 operations** (tag `retention`): `listRetentionClasses`, `getRetentionClass`, `updateRetentionClass` (If-Match), `listRetentionRuns`, `createRetentionRun`, `createRetentionDryRun`, `getRetentionRun`, `listRetentionRunActions`, `listRetentionArchivedRecords`, `listBackupSets` (ADR-0066 §6). All are pending for BE-G in `apps/api/test/support/p7-pending-be-g.ts` until routed.
- **422 codes:** `retention.class_retain_only`, `retention.class_not_archivable`, `retention.class_period_required`, `retention.class_reference_required`, `retention.run_in_progress`. The API checks first; the database refuses the same cases (§2).
- **Permissions** (REQ-S16-024 "configure:ADM(IT-approved); view:AUD,ADM"): `retention.read` (ADM_TECH, ADM_ACCESS, AUD), `retention.configure` and `retention.run` (ADM_TECH only), `backup.read` (ADM_TECH, AUD). No code is a business-approval or Finance code. `backup.read` is a fourth code beside the plan's three, because backup status is not retention (handback O2).
- **Screen** Administration > Retention (FE-C): the class table with "Not set (IT to agree)", the IT reference field labelled as a reference and never as an approval, the dry-run and run buttons, run history with the action log, archived records, and the backup sets.

### 8. Who builds it, and how it is tested

| Task | Builds | Tests (each proves; §E.4 numbers) |
| --- | --- | --- |
| BE-G | `apps/api/src/modules/retention/**` (10 routes), `apps/worker/src/handlers/retention/**` (job, archive set writer through the EvidenceStore), migration `0147` (service identity `job:retention.archive`, disabled schedule, the `retention_table_class` rows of any table BE-G adds) | T-E10…T-E22: a run on test data with test periods archives only records past retention and logs each action; dry run writes nothing; exactly once under redelivery; one audit event per action; purge refused for business, audit and snapshot tables; referenced inbox items skipped; 403 matrix incl. AUD write denial; 422 codes; If-Match |
| FE-C | `apps/web/src/pages/admin/retention/**` | T-E23…T-E25: "Not set (IT to agree)" (never 0); the reference label; EN/AR, RTL |
| DOC-C | `docs/handover/automation-operations.md` retention section | the job, its identity, its disabled schedule and the operator's enabling steps |
| solution-architect (this task) | 0143–0146, the probe, the catalogue tests | `p7-retention-guards.test.ts` (15 tests) and the three `catalogue.test.ts` tests, run on PostgreSQL 16.15 |

## Consequences

- Positive: "the configuration lists every record class" is true by construction and stays true: a new table without a class fails the build.
- Positive: the guarantees that matter (nothing purged outside operational classes; only records past retention; one audit event per action) hold in the database, whatever the job does.
- Negative: generated classification puts every new table in `business_record` unless its migration says otherwise; reclassifying an existing table needs a migration with a documented reason (the map is append-only).
- Negative: archive sets accumulate in the EvidenceStore; their own retention is IT's (they are backed up, ADR-0066 §1).

## Residuals (honest)

1. **Periods are placeholders.** Every class ships "not set (IT to agree)". No period is agreed with Mobily IT, and the platform never claims one is.
2. **No restore of archived rows into live tables** in P7; the set is readable NDJSON in the manifest format.
3. **Archiving business records** (for example closed transformations) is not possible in P7. It needs read-only archive markers on business tables and an analysis of every report and total that reads them (seam 5); a later stage decides.
4. **The pg-boss schema** keeps its own completed-job retention (pg-boss settings, ADR-0008); it is not a retention class. The guide says so.
5. **Scale** of a run is unproven beyond test data; batches of 500 are a design value, not a measured one.

## Alternatives considered

1. **Soft-delete flags.** Rejected by M0329: "soft deletion is not a substitute for an approved retention policy".
2. **A hand-written class list without the catalogue.** Rejected: it would drift from the schema; the generated map plus the coverage test cannot.
3. **Granting DELETE to `mth_app` on operational tables.** Rejected: the purge rules would live only in application code. The definer function keeps them in the database.
4. **One audit event per run instead of per action.** Rejected: the acceptance text says "logs each action".
5. **`archive_then_purge` for append-only history** (`job_run`). Rejected: it would need the append-only trigger disabled, which no runtime path may do.

## Version evidence (M0314)

No new dependency. `SECURITY DEFINER` functions, deferred constraint triggers, `jsonb_object_agg`, `make_interval` and `format('%I')` dynamic SQL are PostgreSQL features in the SQL floor (16); the probe ran on PostgreSQL 16.15 (handback §3). The archive set uses the ADR-0064 encoder (Node built-ins and the existing `pg`/Kysely stack, ADR-0001).

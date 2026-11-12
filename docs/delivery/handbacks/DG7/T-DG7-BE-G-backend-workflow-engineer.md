# Handback T-DG7-BE-G: retention module, job and backup status route (backend-workflow-engineer)

- **Stage:** P7 / DG7 (BUILDING). Task §E.1 of `docs/architecture/p7-work-split.md`. Requirement REQ-S16-024 (and the backup-status read of REQ-S19-012).
- **Invocation:** `DG7-T-DG7-BE-G-backend-workflow-engineer-20261112T221306Z-d308ce8a` (session `d308ce8a-97f3-45ef-9f4c-ee82f47c0f9c`).
- **Base:** `bceacc0b33f241979203a8de3d5044ef1e70a71a` on `claude/mobily-transformation-platform-dg6-regate`. The working tree was clean apart from this run's own `docs/delivery/runs/` directory. Nothing is committed: the orchestrator integrates.
- **Time:** 22:13:14Z to about 23:00Z.
- **Two gate systems.** A retention class, its IT reference text, a run and an archive marker are engineering and operations records. Nothing here grants a business, Finance or IT approval. Nothing reads or writes DG0–DG7. Every test IT reference begins with `TEST-ONLY`. All test data is synthetic.

## 1. Files changed

**Migration**

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0148_p7_retention_job.sql` | Service identity `job:retention.archive` (platform scope, declared and granted `retention.read` only), with its audit event. The `job_schedule` row `retention.archive` (`0 2 * * 1`, `Asia/Riyadh`, **enabled = false**), with its audit event. No table is added, so there is no `retention_table_class` row. The id is **0148**: BE-C had already shipped 0147 (D-245 O9). |

**API (module `retention`)**

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/retention/classes/service.ts` | Shared module code: authorization (`requireRetentionRight`: the slice E code at organization scope), the `retentionRun` lock helper (key `retention`), the exact E.5 texts and 422 refusals, and the zod contract mirrors. Also `classRefusal` (E.5 order) and the `updateClass` transaction: re-checked rights, lock, 404, 409, 422 `run_in_progress`, the E.5 codes, the update, and the audit event `retention_class.updated` (before/after of action, period and reference, plus the reason). |
| `apps/api/src/modules/retention/classes/routes.ts` | `listRetentionClasses` (keyset by code, with tables), `getRetentionClass` (ETag), `updateRetentionClass` (PUT, If-Match). |
| `apps/api/src/modules/retention/runs/service.ts` | The run request in one transaction: rights re-checked, lock, 422 `retention.run_in_progress`, the run row (`as_of = now()` from the database clock), the audit event `retention_run.requested` with the reason, and the outbox event `retention_run.requested` whose idempotency key (the relay's singleton key) is the run id. Also the contract mirrors. |
| `apps/api/src/modules/retention/runs/routes.ts` | `listRetentionRuns`, `createRetentionRun`, `createRetentionDryRun` (Idempotency-Key replay answers 200 with the current state), `getRetentionRun`, `listRetentionRunActions`, `listRetentionArchivedRecords` (filters `table` and `retentionRunId`). Responses carry primary key values only, never row content. |
| `apps/api/src/modules/retention/backups/routes.ts` | `listBackupSets` (`backup.read`), newest first by `finished_at`; contract fields only, with bigint values as decimal strings. |
| `apps/api/src/modules/retention/retention.test.ts` | Updated for the routed module: status `active`, every guard is a registered route, and the E.5 refusal order. |

**Worker**

| File | Purpose |
| --- | --- |
| `apps/worker/src/handlers/retention/archive.ts` | The job `retention.archive`; behaviour is described in §2. |
| `apps/worker/src/handlers/retention/index.ts` | Registers the handler. |
| `apps/worker/src/queues/retention.ts` | Queue `retention.archive` and the event mapping `retention_run.requested` → `retention.archive`. |
| `apps/worker/src/kit.ts` | `declare("retention.archive", ["retention.read"], …)`: one line plus a comment. The header count is now 51. |
| `apps/worker/src/service-identities.test.ts` | Adds 0148 to the seeded-identity parity check; the count goes from 50 to 51. |

**Shared and registries**

| File | Purpose |
| --- | --- |
| `packages/shared/src/schemas/events.ts` | `retentionRunRequestedV1 = { retentionRunId }` and its registry entry. |
| `apps/api/src/modules/automation/outbox-registry.test.ts`, `samples.test.ts` | The new event's enqueue site, and its listing as "not a catalogue trigger" (the BE-C precedent). |
| `apps/web/src/i18n/{en,ar}/problems.json` | The five E.5 problem codes with the exact EN and provisional AR texts. E.5 assigns these to FE-A, but `problems-all.test.ts` fails as soon as the API emits a code with no text, so I added them (the BE-C and BE-F precedent). FE-A should confirm them and must not add them twice. |
| `packages/db/src/seed.test.ts` | Numbering example moved to `0149`, with a comment. |

**Tests**

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/retention/classes.test.ts` | T-E10, T-E11, T-E12 (8 tests). |
| `apps/api/test/integration/retention/runs.test.ts` | T-E13, the run routes and their 403 matrix (7 tests). |
| `apps/api/test/integration/retention/backups.test.ts` | T-E20 (2 tests). |
| `apps/worker/test/integration/retention-archive.test.ts` | T-E14 to T-E19 and T-E22 (8 tests). |
| `apps/api/test/integration/contract/p7-exercises-be-g.ts` + `contract.test.ts` | T-E21: all 10 operations exercised and checked against the contract and the mirrors. Also the request-body pin: 432/430 → 435/433, for the three new JSON-body operations. |
| `apps/api/test/support/p7-pending-be-g.ts` | Now empty. |

Not changed: `packages/db/src/schema.ts` and `catalogue.test.ts`, because 0148 adds no table or column. `catalogue.test.ts` still passes with 0148 applied.

## 2. Behaviour per requirement

**REQ-S16-024 "the retention configuration lists every record class"**

- `listRetentionClasses` returns the 12 classes, ordered by code, each with its tables.
- T-E10 proves that the union of the class tables equals the set of public base tables in `pg_class`, each listed exactly once.
- A NULL period is returned as `periodDays: null`, never 0.

**REQ-S16-024 "an archival job run on test data archives only records past retention"**

The job runs in this order:

1. **Claim.** One transaction under lock `retentionRun` (key `retention`) moves the run from `queued` to `running` once. A run that is running, terminal or missing is skipped.
2. **Select.** One REPEATABLE READ, READ ONLY transaction with the ADR-0064 encoder settings. It reads every enabled class and every table of that class that has an age column. A row is selected when its age is older than `as_of − period` and the row has no marker yet.
   - The age is read as **text**, so microseconds survive (T-E14 checks `record_age_at = processed_at` exactly).
   - The key comes from `retention_record_key()`.
   - The row line comes from BE-C's `columnExpression` and `encodeLine`, which are imported, not copied.
3. **Write the archive set.** In run mode, with no transaction open: `tables/<t>.ndjson` and then `manifest.json` (`mth-retention-archive/1`, with `runId`, `asOf`, and per table the class code, period, `rowCount`, `fileSha256`, `contentDigest` and `columns`). These go under `retention/<runId>/` in the evidence store root, before any marker.
4. **Batches.** At most 500 rows per transaction, in this order: marker → `archived` action + `retention.archived` audit → `retention_purge_record()` → `purged` or `skipped_referenced` action + `retention.purged` or `retention.skipped` audit.
5. **Finish.** `succeeded` with the counts, the set key, the manifest SHA-256 and the total bytes; or `failed` with the reason. Either way there is an audit event.

Proven by:

- **T-E14:** rows 40 and 31 days old are archived; a row 29 days old (one day younger than the 30-day period) stays unmarked and live.
- **T-E19:** only operational classes with an action other than `retain` appear in actions or markers; `job_run`, `webhook_receipt`, `worker_heartbeat`, `audit_event` and `report_snapshot` never appear.
- **T-E22:** a fresh installation (every class `retain`) archives nothing; a scheduled delivery creates a run with `requested_via` = `schedule`.

**REQ-S16-024 "and logs each action"**

- T-E14 and T-E18 prove one action row and one audit event per action, and the run's audit sequence: requested, then started, then succeeded or failed.
- T-E15: a dry run writes `would_archive` and `would_purge` rows with no per-row audit, no archive set, no marker and no delete.

**REQ-S16-024 "periods agreed with IT / Approver" (T-E11)**

- `updateRetentionClass` returns 422 `class_period_required` and 422 `class_reference_required`.
- The reference is stored as text and audited before/after. Saving it approves nothing.

**D-243 Q3 (nothing purged in business, audit or snapshot classes) (T-E11, T-E19)**

- 422 `class_retain_only` for `business_record`, `audit_trail`, `report_snapshot` and `expiring_credential`.
- 422 `class_not_archivable` for `job_history` with `archive_then_purge`.
- The database guards still back all of these (probe: 15/15 pass).

**Purge and referenced rows (T-E18)**

- `processed_message` with `archive_then_purge`: archived, then deleted.
- An inbox item that a `notification_delivery` row references: `skipped_referenced`, kept, and an UPDATE is refused ("archived record is read-only").
- An unreferenced old inbox item is purged. A 10-day-old item is not touched.

**Exactly once (T-E16)**

- A redelivery of a finished run is skipped.
- Two concurrent deliveries of one run: one succeeds, the other is skipped.
- A later run never re-selects a marked record.

**Archive set (T-E17)**

- `manifest.json` SHA-256 equals `archive_set_sha256`, and `archive_set_bytes` equals the manifest plus NDJSON bytes.
- The NDJSON keys are in column order, rows are in primary-key order, and timestamps are UTC text with microseconds.
- A store failure produces a `failed` run with its reason, no marker, no action and no deleted row.

**Concurrency and API checks (T-E11, T-E13)**

- 422 `retention.run_in_progress` for a class update while a run is queued; for a run or dry-run request while a run is queued or running.
- An Idempotency-Key replay returns 200 with the same run.
- 409 on a stale If-Match, 428 without one, 400 on a malformed body, cursor or id, and 404.

**Authorization (T-E12, T-E13, T-E20)**

- Configure and run: every role except ADM_TECH gets 403, AUD and ADM_ACCESS included, and nothing is written.
- `retention.read` routes: 200 for ADM_TECH, ADM_ACCESS and AUD only.
- `listBackupSets`: 200 for ADM_TECH and AUD only (ADM_ACCESS gets 403).
- Mutations re-check the right on grants reloaded inside the transaction.

**REQ-S19-012 backup status (T-E20)**

- Newest first, contract fields only, no content and no file path, bigint values as decimal strings. No route starts a backup.

**T-E22**

- The identity row is `job:retention.archive`: platform scope, `retention.read`, no sensitive access.
- The schedule ships disabled, with cron `0 2 * * 1` in `Asia/Riyadh`.

## 3. Checks run

Environment: Node 24.21.0, `MTH_PNPM_OFFLINE=1`, disposable PostgreSQL 16.15 through `tests/qa/support/with-pg.sh` (UTF8, C locale, port 24351). Logs are in `docs/delivery/handbacks/DG7/T-DG7-BE-G-evidence/`.

| Command | Result | Log |
| --- | --- | --- |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0: "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations" | `openapi-lint.log` |
| `pnpm test` | **exit 0**: 198 files / 2945 tests (unit-node); 125 / 2113 (web); 3 files, 259 passed and 2 skipped. The first run exited 1 with 3 failures, all fixed: lock number in comments, the module test's scaffold assertion, the missing problem texts. | `pnpm-test.log` (final run) |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/retention apps/worker/test/integration/retention-archive.test.ts apps/api/test/integration/contract/contract.test.ts packages/db/test/integration/p7-retention-guards.test.ts packages/db/test/integration/catalogue.test.ts` (final tree) | **exit 0**: 7 files, 195 tests | `integration-final.log` |
| The same harness on 19 related paths (list in `integration-files.txt`: transfer, jobs, schedules, relay/outbox, service identities, seeded-text scan, integrity sweep, `tests/qa/integration/a22-operational-readiness.test.ts`) | **exit 1**: 22/23 files, 342/343 tests. The single failure is described in §4.1. | `integration-related.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, before this handback was written. I re-ran it over the whole tree after writing this handback: exit 0 (`prettier-after-handback.log`). | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | exit 0: "PASS gate DG6 (historical)" | `validate-dg6.log` |

## 4. Known gaps / not done

1. **`tests/qa/integration/a22-operational-readiness.test.ts` fails (1 test) with the shipped disabled schedule.**
   - The test expects every `job_schedule` row to have `nextRunAt` as a string and `nextRunUnknownReason` as null. The disabled `retention.archive` row correctly returns `nextRunUnknownReason: "disabled"`.
   - The disabled schedule is required (work split §E.1, ADR-0067 §4, p7-plan seam 4). The test was written when every shipped schedule was enabled.
   - `tests/qa/**` is qa-verifier's area, so I did not edit it. Suggested change: for `!s.enabled`, expect `nextRunAt` null and the reason `disabled`.
   - **This must be reconciled before the freeze.**
2. **A worker crash mid-run leaves the run `running`.** As ADR-0067 §4 specifies, a redelivered job skips a run that is already running, so it does not resume. Until an operator ends that run, new runs and class updates are refused with 422 `run_in_progress`. No API operation fails a stuck run.
3. **Where the archive set is written.** It goes to the evidence store's **filesystem** root (`EVIDENCE_STORAGE_PATH/retention/<runId>/`) through a `PackageSink`, the same approach BE-C's `transfer.export` uses. An installation whose evidence driver is `s3` gets the set on the worker's filesystem path, not in S3. `EvidenceStore.delete` is never called.
4. **Rows that change between the snapshot and the marker.** If a candidate row changes or disappears, the marker trigger refuses it, the run ends `failed` with the database message, and batches already committed stay committed. This is honest, but not resumable.
5. **Re-purging earlier archives.** A record archived under `archive` stays archived and live if the class later moves to `archive_then_purge`. A marked record is never re-selected (ADR-0067 §4: "archived once, ever"), so it is not purged.
6. **Encoder coverage.** SecretRef column rewrites (ADR-0064 §4) are not applied, because none of the five aged tables has such a column. A `json`-typed column (rather than `jsonb`) fails the run, as it does in BE-C.
7. **Not run.** Scale beyond the test data. The pg-boss relay end to end: the job was invoked through its handler with the relay's envelope shape, and the relay's singleton key is the event's idempotency key (= run id) by the existing `relay.ts` code.

## 5. Open questions and merge instructions

- **Migration:** `0148_p7_retention_job.sql`, after 0147 (BE-C). If another W5 task also ships 0148, renumber this one, and update the URL in `apps/worker/src/service-identities.test.ts` and the example in `seed.test.ts` to match.
- **Expected conflicts** with other W5 tasks:
  - the request-body pin in `contract.test.ts` (this task adds +3 JSON bodies);
  - the identity count in `kit.ts` and `service-identities.test.ts` (51);
  - the tails of `problems.json` and the outbox registry lists.
- **API endpoints added (10, tag `retention`):**
  - `GET /api/v1/admin/retention/classes`
  - `GET` and `PUT /api/v1/admin/retention/classes/{retentionClassCode}`
  - `GET` and `POST /api/v1/admin/retention/runs`
  - `POST /api/v1/admin/retention/dry-runs`
  - `GET /api/v1/admin/retention/runs/{retentionRunId}`
  - `GET /api/v1/admin/retention/runs/{retentionRunId}/actions`
  - `GET /api/v1/admin/retention/archived`
  - `GET /api/v1/admin/backups`
- **Q1:** Should a stuck `running` run (gap 2) be closable? Options are a `running → running` resume on a pg-boss retry (BE-C allows this) or an operator CLI. This needs an ADR-0067 decision.
- **Q2:** The a22 QA test needs the change in gap 1. Who updates it: qa-verifier, or the orchestrator at merge?
- **Q3:** FE-A should confirm the five `retention.*` problem texts I added to `problems.json` and not add them twice.

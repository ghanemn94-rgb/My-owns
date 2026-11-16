# Handback T-DG7-BE-C: migration export (backend-workflow-engineer)

- **Stage / gate:** P7 "Independent transfer and release", DG7 (BUILDING). Task §C.1 of `docs/architecture/p7-work-split.md` (W5, after BE-A).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-C-backend-workflow-engineer-20261112T201949Z-deebfcd7","session_id":"deebfcd7-8d5f-49fc-b995-4318be10485e"}`.
- **Base:** `76a0b9556d49a376176076df0f0cbaeaf2a06135` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's directory. Nothing was committed.
- **Time:** started 2026-11-12T20:19:57Z, checks finished 21:12:28Z.
- **Requirements:** REQ-S19-014 and REQ-S19-016, the BE-C clauses of C.10 (T-C1–T-C7).
- **Two gate systems.** An export is an engineering artefact of an installation. It approves nothing (no G1–G6, Finance or IT approval). Nothing here reads or writes DG0–DG7 records. All test data is synthetic.

## 1. Files changed

### Created

| File | Purpose |
| --- | --- |
| `packages/db/src/transfer/plan.ts` | The catalogue-driven plan (ADR-0064 §2.2). Includes the SCC cycle breaking, `deferredColumns`, `deferrableForeignKeys`, `loadPhase`, `selfReferenceOrder` and `TransferPlanError`, which carries the C.5 line. |
| `packages/db/src/transfer/export.ts` | The encoder: pinned settings, text output, boolean `t`/`f`, jsonb embedded verbatim, and the SecretRef rewrite done in SQL. Also: the single `REPEATABLE READ READ ONLY` snapshot (`takeSnapshot`), `exportPackage`, `contentDigest`/`fileSha256`, the attachment verification, `directorySink`, `filesystemObjectSource`, `confinedPath`, `MIGRATION_EXPORT_PREFIX`/`migrationExportKey` and `transferSha256`. |
| `packages/db/src/transfer/manifest.ts` | The canonical writers and strict readers for `manifest.json` and `attachments.json`, plus `MANIFEST_SCHEMA_VERSION = "mth-migration/1"`, `readSourceEnvironment` (demo/production/unmarked), `demoChecksumFor` and `packageAppVersion`. |
| `packages/db/src/transfer/run.ts` | The `migration_export` state machine shared by the job and the CLI. Claim, run and finish happen under lock class 730402 with key `migration-export`, and every transition is audited. Also `requestCliExport` and `MIGRATION_EXPORT_LOCK_CLASS`. |
| `packages/db/src/transfer/cli.ts` | `runExportMigrationCommand`: the body of `mth-db export-migration`, with exit codes 0/1/2. |
| `packages/db/src/transfer/index.ts` | The package's exports. |
| `packages/db/src/transfer/{plan,export,manifest}.test.ts` | Unit tests, the pure parts of T-C1–T-C3 (20 tests). |
| `packages/db/test/integration/transfer-export.test.ts` | T-C1–T-C5 plus the CLI and wrapper on real PostgreSQL (11 tests). |
| `packages/db/migrations/0147_p7_transfer_export_job.sql` | The service identity `job:transfer.export`, with no permission code, and its audit event. It has no `job_schedule` row. |
| `apps/api/src/modules/transfer/export/service.ts` | Authorization (`migration.export` at organization scope), the request transaction (lock, 422, insert, audit, outbox), the contract mirrors, the C.5 problems and the manifest reads with SHA-256 checks. |
| `apps/worker/src/handlers/transfer/export.ts` | The job `transfer.export` (`defineJob`), a thin wrapper over `runRecordedExport` with a filesystem store sink. |
| `tools/migration/export.mjs` | The thin wrapper over `mth-db export-migration`. Exit codes follow §2 rule 4. |
| `apps/api/test/integration/transfer/export.test.ts` | T-C6 (10 tests). |
| `apps/api/test/integration/contract/p7-exercises-be-c.ts` | T-C7: the contract exercises for the 5 operations. |

### Modified

Rows marked † are outside the §C.1 file list (see §5 Q1).

| File | Exactly what |
| --- | --- |
| `apps/api/src/modules/transfer/export/routes.ts` | Fills the BE-A stub: registers the 5 routes. The guard table is unchanged. |
| `apps/worker/src/handlers/transfer/index.ts`, `apps/worker/src/queues/transfer.ts` | Fill the BE-A stubs: the handler, the queue `transfer.export`, and event → queue mapping. |
| `packages/db/src/cli.ts` | The one command `export-migration --out DIR --operator NAME` (usage line, dispatch and header line). |
| `apps/api/test/support/p7-pending-be-c.ts` | Now empty: all 5 operations are routed and exercised. |
| `packages/db/src/seed.test.ts` | Only the numbering example, which moves to `0148`. |
| † `packages/db/src/index.ts` | One line, `export * from "./transfer/index.ts"`, so the API and worker can reach the package. |
| † `packages/shared/src/schemas/events.ts` | The outbox event `migration_export.requested` v1 (`{migrationExportId}`). |
| † `apps/worker/src/kit.ts` | One `JOB_SERVICE_IDENTITIES` declaration, `transfer.export` with `[]` permissions. `defineJob` refuses an undeclared queue. |
| † `apps/worker/src/service-identities.test.ts` | Adds the 0147 entry to the seeded-migration list and moves the count from 49 to 50. |
| † `apps/api/src/modules/automation/outbox-registry.test.ts` | One `ENQUEUED` line for the new event. |
| † `apps/api/src/modules/automation/samples.test.ts` | `migration_export.requested` added to `NOT_TRIGGERS`, because it is not an automation trigger. |
| † `apps/api/src/modules/transfer/transfer.test.ts` | A BE-A latent bug: `printRoutes()` prints a radix tree, so the test now looks for `"api/v1/admin/"` without the leading slash. Before the fix it failed as soon as one route existed. |
| † `apps/api/test/integration/contract/contract.test.ts` | Imports and runs the exercise and the mirrors. The media-type pin moves from `[429, 427, 1]` to `[430, 428, 1]`; `createMigrationExport` is the one new JSON body. |
| † `apps/web/src/i18n/{en,ar}/problems.json` | The three C.5 problem codes, appended with the exact C.5 texts. The Arabic is **provisional** (D-243 Q7). The work split gives these files to FE-A, but `apps/web/src/i18n/problems-all.test.ts` fails without them, so `pnpm test` could not exit 0. FE-A should keep them as they are. |

### Merge instructions

- **Migration `0147_p7_transfer_export_job`.** The work split named `0136`. 0143–0146 already ship, and the runner refuses any id below the highest applied one (D-245 O9), so this task took the next id above 0146.
  - D-248 also says "BE-G starts at 0147". If BE-G merges first, rename this file to the next free id.
  - On a rename, update the file name in three places: `apps/worker/src/service-identities.test.ts` (`MIGRATIONS`), the comment in the migration header, and the numbering example in `seed.test.ts`.
  - The seeded row's id `01920007-0147-…-0001` is only an id and need not change.
- **Expected conflicts with the other W5 tasks** (BE-F, BE-G):
  - the `kit.ts` declaration list and the `service-identities.test.ts` count (if they add queues);
  - `OUTBOX_EVENT_SCHEMAS` in `events.ts`;
  - the `ENQUEUED`/`NOT_TRIGGERS` lists;
  - the `contract.test.ts` imports, mirrors and the media-type pin (add their JSON-body routes to 430/428);
  - `seed.test.ts`'s numbering example;
  - the end of `problems.json`.
- **Order.** None beyond the migration id. The CLI line in `cli.ts` comes before BE-D's three lines (p7-plan §5.3).

## 2. Behaviour delivered, per requirement

### REQ-S19-014 and REQ-S19-016, BE-C clauses (C.10)

**Versioned migration manifest (M0362, M0364).**
- `manifest.json` uses `schemaVersion` `mth-migration/1`, in canonical JSON with keys in ADR-0064 §2.1 order, compact, with one final newline.
- `sourceEnvironment` is `demo`, `production` or `unmarked`, taken from `deployment_environment`.
- `demoChecksum` equals `datasetChecksum()` for a demo source and is `null` otherwise.
- `migrationLevel` is the highest applied migration. `appVersion` is the `@mth/db` version.
- `tables[]` lists the tables in load order, each with `rowCount`, `fileSha256`, `contentDigest`, `columns` and `deferredColumns`.
- `excludedTables[]` and `rewrittenColumns[]` are copied from the rule tables.
- `attachmentManifest` and `totals` are included. Every count that can exceed 2^53 is a decimal string.

**Catalogue-driven order (T-C1).**
- The exported tables are every public base table minus `transfer_table_rule`. The table list is never written by hand.
- Cycles are broken by:
  1. nullable `created_by`/`updated_by` columns first;
  2. then other nullable foreign-key columns;
  3. finally, a `DEFERRABLE` key whose columns are all NOT NULL (see §5 Q2).
- A composite `MATCH SIMPLE` key is broken by nulling only its nullable columns.
- A cycle that none of these breaks fails with `migration plan: foreign-key cycle without a nullable edge: <tables>`.
- `selfReferenceOrder` orders rows by depth. A depth-3 case is tested.

**Exact values (T-C2, M0364 decimal integrity).**
- Every value is its PostgreSQL text output under pinned settings, written as a JSON string. Booleans are `t`/`f`.
- jsonb is embedded verbatim, so its numbers are never re-parsed or rounded. SQL NULL is `null`.
- Rows are sorted by primary-key text. No column value is ever a JSON number.
- Proven by the round trip through `jsonb_populate_recordset`: `EXCEPT ALL` is empty both ways, and re-encoding the copy gives the same digest. The test values are `numeric(20,4)` money, a 33-digit rate, bigint extremes, timestamptz with microseconds, ±infinity, an interval, arrays with NULL/quotes/Arabic, bytea and nested jsonb.

**Checksums (T-C4).**
- `fileSha256` equals `contentDigest` equals the SHA-256 of the stored bytes. The export fails otherwise.
- The SHA-256 values of both manifests are recorded on the row.

**No credentials (T-C5, D-243 Q16).**
- Every SecretRef is rewritten in SQL to `{"provider":"unbound", name}`. That covers the 15 rule columns, including each entry of `credential_refs`; the names are kept.
- Excluded tables (sessions, OIDC state, idempotency and so on) never become files.

**Attachments.**
- Every `storage_key` column is found from the catalogue. Today there are two, and the test pins them.
- Each object is read after the snapshot ends and checked against its row's SHA-256 and size. It is written once per distinct SHA-256 to `attachments/<sha256>`.
- A missing or mismatching object fails the export and names the object; it is never skipped.

**API (T-C6, T-C7).** The five operations are `listMigrationExports`, `createMigrationExport`, `getMigrationExport`, `downloadMigrationExportManifest` and `downloadMigrationExportAttachmentManifest`.
- **Authorization.** All five require `migration.export` at organization scope. Every other role, AUD included, gets 403, and so does a user with no grants. The create re-checks authorization on reloaded grants inside its transaction.
- **Create, in one transaction.** It takes lock 730402 with key `migration-export`, then:
  - returns 422 `migration.export_in_progress` if any export is queued or running;
  - otherwise inserts the row, writes the audit event `migration_export.requested` with the reason, and writes the outbox event.
- **Idempotency.** A repeat with the same `Idempotency-Key` returns 200 with the export's current state.
- **Downloads.**
  - Before the export finishes: 409 `migration.export_not_ready`.
  - Failed export: 422 `migration.export_failed`.
  - Succeeded export: 200 with the stored bytes, after checking their SHA-256 against the row. The response carries `Content-Disposition: attachment`, `ETag` set to the SHA-256, and `no-store`.
- No response contains a row value. The test asserts this over every body in the suite.

**Job.** `transfer.export` runs exactly once:
- **Claim.** It claims queued → running under 730402, or running → running for a retry after a crash. A terminal row is skipped, so a duplicate delivery does nothing.
- **Run.** It writes the package outside any transaction to `<evidence root>/transfer/migration-exports/<id>/`.
- **Finish.** It moves to succeeded with counts, checksums, marker, level and demo checksum, or to failed with the reason.
- **Audit.** Each transition writes its audit event: `.started`, `.succeeded` or `.failed`.
- **Proofs.**
  - It waits while another session holds 730402.
  - Lock constant = `ADVISORY_LOCK_CLASSES.migrationExport`.

**CLI.** `mth-db export-migration --out <dir> --operator <name>` writes the same package and records a `migration_export` row with `requested_via cli`. Its audit events are `requested`, `started` and `succeeded`, all with source `cli`. Exit codes:
- 0: package written.
- 1: `export-migration: failed: <reason>`.
- 2: usage error, or `--out` is not empty.

`tools/migration/export.mjs` adds exit 3 when no workspace is installed. It prefers the source CLI, because a checkout's `dist/` can be stale (observed: the stale dist printed the old usage).

## 3. Checks run (real exit codes)

Environment for all checks:
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`.
- Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh`: UTF8, C locale, port 24351.
- Logs are in `docs/delivery/handbacks/DG7/T-DG7-BE-C-evidence/`.

| Command | Result | Log |
| --- | --- | --- |
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| `pnpm test` | exit 0. unit-node 198 files / 2944 tests; unit-web 125 / 2113; unit-formula-nocodegen 3 files, 259 passed, 2 skipped | `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | exit 0: `PASS gate DG6 (historical)` | `validate-dg6.log` |
| `npx vitest run --project unit-node apps/worker/src/service-identities.test.ts packages/db/src/transfer packages/db/src/seed.test.ts` (final tree) | exit 0, 100 tests | `unit-final.log` |
| `tests/qa/support/with-pg.sh npx vitest run --project integration` on: `packages/db/test/integration/transfer-export.test.ts`, `apps/api/test/integration/transfer/export.test.ts`, `apps/api/test/integration/contract/contract.test.ts`, `apps/api/test/integration/text-scan/seeded-texts.test.ts`, `packages/db/test/integration/catalogue.test.ts`, `packages/db/test/integration/p7-transfer-guards.test.ts` (final tree) | exit 0: 6 files, 189 tests | `integration-final.log` |

Earlier per-file runs on the same tree, before the final rewording of 0147's seeded reason:
- `db-transfer-export.log`: exit 0, 11/11.
- `api-transfer-export.log`: exit 0, 10/10.
- `contract.log`: exit 0, 106/106.
- `related-integration.log`: exit 0, 62/62.

Failures seen and fixed during the run (all logged and rerun):
- Missing `name[]` parsing in node-pg.
- The planner cycle described in §5 Q2.
- The T-C4 claim described in §5 Q3.
- The contract media-type pin.
- Lock numbers written as literals in comments, caught by the registry scan.
- The samples and problems catalogues.
- The seeded-text scan, which caught ADR ids in 0147's seeded reason.
- The stale-dist wrapper.

## 4. Known gaps / not done

- **Attachments with real bytes were not exercised here.**
  - Neither the demo nor the P6 fixtures I used has any `evidence_content` or `export_job` row with bytes. The verify-and-copy code path is covered only by the type of check (missing object → failure with its name) inside `exportPackage`.
  - A package with real evidence objects is T-C16 (BE-E) and T-C8 (BE-D).
- **S3-stored evidence cannot be exported yet.**
  - The worker may not import the API's EvidenceStore (ADR-0002), and `@mth/db` has no S3 client. The job therefore reads evidence from the filesystem store root and writes the package there, following the P5 export-file precedent (`@mth/reporting` `createExportStore`).
  - An evidence row with `storage_driver = 's3'` fails the export, naming the object. It is never skipped.
  - The API's manifest download also reads the filesystem root (`filesystemPackageReader`), not the port.
- **Scale is unproven.** Each table is encoded in memory, in one snapshot, before anything is written (ADR-0064 Residual 1). No timing is claimed.
- **Real-bytes contract exercise.** The contract exercise simulates the job's two later transitions as the owner role, using synthetic canonical manifests. The suite shares one database with the other suites, so a real whole-database export would read their evidence. The real job is exercised in T-C6.
- **Not run.** The whole integration project (`pnpm test:integration`) was not run. Only the files listed in §3 were.
- **Not in BE-C scope** (BE-D, BE-E, FE-B, DOC-B): import, reconcile, rebind and the screens.

## 5. Open questions

- **Q1. Files edited outside the §C.1 list.** They are the rows marked † in §1, each minimal. Without them, the job cannot be declared (`defineJob` refuses an undeclared queue), the outbox event cannot be written (`enqueueOutboxEvent` validates the schema), and `pnpm test` cannot exit 0. Please accept them or redistribute them at merge.
- **Q2. ADR-0064 §2.2 step 4 does not hold literally for the current schema.**
  - `nullable` per foreign key: in many composite keys the leading column is NOT NULL and the other nullable, for example `decision (id, chosen_option_id?)`. Those cycles break by nulling the nullable column, because PostgreSQL does not check a `MATCH SIMPLE` key that has a null column. The planner does this; a `MATCH FULL` key would need every column nullable.
  - One cycle has no nullable edge: `connector.(id, config_version_no) → connector_config_version`, which is NOT NULL but `DEFERRABLE` (0104). The planner removes it from the order and lists it as `deferrableForeignKeys: ["connector_current_config_fkey"]`.
  - **Consequence for BE-D:** its load must run `SET CONSTRAINTS ALL DEFERRED` (or at least that constraint) inside the load transaction.
  - T-C1 pins that this is the only deferrable key the order relies on. The manifest format is unchanged; BE-D derives the same list from the catalogue at the same level.
  - Architect: please confirm, or amend the ADR wording.
- **Q3. T-C4's wording is too broad, and the test now pins the measured set.**
  - The ADR expects equal digests for "every table whose rows have no `now()` column". Two seedings of the demo also differ in `automation_rule_enablement`, `connector_change` and `service_identity_change`. Their ids come from `mth_uuid_v7()` in triggers or migrations, not from a clock. Row counts are equal, and the ADR-0050 `demoChecksum` is equal.
  - Proposal: ADR-0062 residual 2 and ADR-0064 §2.1 should say "no clock-defaulted column and no write-time generated id".
- **Q4. A jsonb `null` value cannot be told apart from SQL NULL in the ADR's encoding.**
  - Both encode as `null`, and `jsonb_populate_recordset` loads both as SQL NULL. Such a row would make the import's reconciliation mismatch (digest `"null"` vs `null`), so the problem is caught, never silent.
  - Architect: decide whether to (a) accept this, (b) fail the export when a jsonb column holds JSON `null`, or (c) encode jsonb as a JSON string in `mth-migration/2`.
- **Q5. `appVersion` is read from `@mth/db`'s `package.json`.** All workspace packages are `0.1.0` today. If the release version is meant to come from somewhere else (for example ADR-0069 `release.appVersion`, the API's version), BE-D's target check must use the same source.
- **Q6. The FE-A ownership of `problems.json`** (see §1). The three keys carry the exact C.5 texts. The Arabic is provisional until a qualified reviewer checks it (D-243 Q7).

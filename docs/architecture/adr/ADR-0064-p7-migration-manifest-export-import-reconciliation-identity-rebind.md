# ADR-0064: P7 data migration manifest: the package format and its schema version, the catalogue-driven table order, ids preserved, the attachment manifest, what is never exported, import into an empty database by the owner role, reconciliation, and the identity rebind under IT control

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-02), 2026-11-12. Base `9f161c651883bc2e482a2cf602024fbbacbf759c` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice C of `docs/architecture/p7-plan.md`):** REQ-S19-014, REQ-S19-016. Slice D (REQ-S19-008) is ADR-0065.
- **Sources (quoted where a design point has one):**
  - M0362 (§19 item 11): "Data migration tools with mapping, validation, reconciliation, attachment manifests and checksum/record-count checks."
  - M0364 (§19, master prompt l.562): "Exportability includes all business records, relationships, audit history, approvals, evidence files, configuration, formulas and report snapshots. A source ZIP or CSV-only export is insufficient by itself. Use a versioned migration manifest that preserves IDs and attachment links. Export portable business users/role mappings without improperly transferring corporate passwords; rebind corporate identity subjects under IT control."
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-S19-014: "A18: migrating the demo dataset into a clean installation reports equal record counts and matching attachment checksums".
    - REQ-S19-016: "A18: an export and import round-trip preserves IDs, links, audit history and evidence checksums; the package contains no password hashes". Its note: "A source ZIP or CSV-only export is insufficient on its own."
  - Playbook: no block concerns data migration between installations. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q4**: "verbatim audit import into an empty database only, with one `migration.imported` event";
  - D-243 **Q5**: "identity rebind by IT mapping file";
  - D-243 **Q16**: "all credential material excluded";
  - D-244 **O2**: the environment-marker field is named here (`sourceEnvironment`; `demo` for the demo export) and the ADR-0050 demo checksum is carried as `demoChecksum`;
  - p7-plan §3 seams 8 (audit), 10 (evidence storage), 11 (identity), 12 (module registry), 13 (contract); §6 R2, R3, R8; "No new runtime dependency is expected in P7".
- **Builds on:** ADR-0002 (modules), ADR-0003 (ids from the application, no hard delete), ADR-0004 (append-only audit), ADR-0005 (OIDC, no passwords), ADR-0010 (EvidenceStore; "the data-migration manifest carries the evidence keys and checksums"), ADR-0016 §6 (advisory-lock registry), ADR-0050 (demo marker and checksum), ADR-0052 §5 (SecretRef), ADR-0053 (service identities), ADR-0054 (identity and storage settings), ADR-0062 §2 (the `demo-data/` input of the archive is a package in this format).
- **Two gate systems.** A migration package, an import and a reconciliation report are engineering artefacts of an installation. None of them is a business, Finance or IT approval. The approvals inside a package (G1–G6 decisions, Finance validations) are copied as records of the source installation; the import approves nothing and re-decides nothing. Nothing here reads or writes DG0–DG7.

## Context

What exists at `9f161c65` (read from the tree):

1. **No migration tooling.** `tools/migration/` does not exist. P5 exports (`export_job`, ADR-0046) are reports, not a migration package. ADR-0010 l.34 anticipated "the data-migration manifest carries the evidence keys and checksums".
2. **Schema.** 0001–0130 (eight retired gaps) hold 329 `CREATE TABLE` statements outside the pg-boss schema (counted with `grep '^CREATE TABLE'`), plus the pg-boss schema. Every table has a primary key (catalogue test). Ids are application-generated UUIDv7 (ADR-0003); `audit_event.seq` is `GENERATED ALWAYS AS IDENTITY`.
3. **Foreign-key cycles exist.** `organization.created_by → app_user` and `app_user.organization_id → organization` (0001) are a cycle; many tables reference themselves (`created_by`, parent ids). The `created_by`/`updated_by` edges are nullable.
4. **Guards fire on insert.** `p2_row_guard` refuses a new row whose `version` is not 1, many tables have creation-only and state-machine triggers, and `p2_audit_required` needs an audit event per row at commit. A verbatim load of an installation's history through the normal path is therefore impossible by design.
5. **Audit.** `audit_event` (0003) has exactly two triggers, `audit_event_immutable` (UPDATE, DELETE) and `audit_event_immutable_truncate`. No trigger stamps `id`, `seq` or `occurred_at` on insert; `occurred_at` only has a `now()` default. `mth_app` has INSERT and SELECT.
6. **Credentials.** The hub stores no password (ADR-0005; `app_user` has no password column). It stores `session.token_hash` and `csrf_token_hash`, `oidc_login_state.state_hash`, `idempotency_record` (request replay cache), and 15 SecretRef columns (`{provider, name}`, never a secret value; ADR-0052 §5) in nine tables (`storage_setting`, `notification_channel`, `connector_config_version`, `webhook_endpoint`, `assistant_setting` and the `_change` histories of four of them).
7. **Evidence bytes.** Two columns name an EvidenceStore object: `evidence_content.storage_key` (0012) and `export_job.storage_key` (0081). The `EvidenceStore` port and its filesystem and S3 adapters live in `apps/api/src/modules/evidence/` (ADR-0010, ADR-0054). `packages/db` cannot import `apps/api` (ADR-0002 direction).
8. **Demo marker.** `deployment_environment` (0090) holds one row: `environment_kind` `production` or `demo`; no row means unmarked (reported as production, fail-safe). The ADR-0050 checksum (`packages/db/src/demo/checksum.ts`) leaves out every `now()`-defaulted column, because two seedings write different timestamps.
9. **Identity.** `user_identity (issuer, subject)` identifies a user (0001). `mth-db bootstrap` refuses on a database where an organization exists.

## Decision

### 1. The package (one directory, the same bytes from the API job and from the CLI)

```text
<package>/
  manifest.json            the migration manifest (§2)
  attachments.json         the attachment manifest (§5)
  tables/<table>.ndjson    one file per exported table (§2.3)
  attachments/<sha256>     one file per distinct evidence object, named by its SHA-256 (§5)
```

- **Written by** the worker job `transfer.export` into the EvidenceStore under the prefix `transfer/migration-exports/<exportId>/` (API path, §7), or by `mth-db export-migration --out <dir>` (CLI path). Both use the same encoder (`packages/db/src/transfer/export.ts`), so the files are byte-equal for the same database state.
- **Read by** `tools/migration/import.mjs` from a directory. IT copies the prefix (filesystem volume or bucket) to the target. The package never leaves through the API (§7).
- **The archive's `demo-data/`** (ADR-0062 §2) is a package of the synthetic demo installation in exactly this format.

### 2. The manifest (`schemaVersion` `mth-migration/1`)

#### 2.1 Fields

| Field | Meaning |
|---|---|
| `schemaVersion` | `mth-migration/1`. An importer refuses any other value (§6 step 1). A future incompatible format gets `mth-migration/2` and its own reader. |
| `exportId` | the source `migration_export.id`. |
| `sourceEnvironment` | **the environment-marker field (D-244 O2).** `demo` when the source's `deployment_environment.environment_kind` is `demo`, `production` when it is `production`, `unmarked` when the source has no marker row. ADR-0062's `build-archive` requires `demo`. |
| `demoChecksum` | **D-244 O2.** For a `demo` source: the ADR-0050 checksum (`datasetChecksum(db)` of `packages/db/src/demo/checksum.ts`) computed in the export's snapshot. `null` for every other source. Because the checksum leaves out `now()`-defaulted columns, two exports of the same demo state have the same `demoChecksum` even though their bytes differ (ADR-0062 residual 2). |
| `migrationLevel` | the name of the highest applied migration of the source (for example `0135_p7_transfer_permissions`). |
| `createdAt`, `appVersion` | when the snapshot was taken, and the release version that wrote it. |
| `tables[]` | every exported table in load order: `name`, `file`, `loadPhase`, `rowCount` (decimal string), `fileSha256`, `contentDigest`, `columns` (attribute order), `deferredColumns` (§2.2). |
| `excludedTables[]` | every table not carried, with its rule and reason (§3), copied from `transfer_table_rule`. |
| `rewrittenColumns[]` | every column whose values are rewritten (§4), copied from `transfer_column_rule`. |
| `attachmentManifest` | `file` (`attachments.json`), `sha256`, `count`, `bytes`. |
| `totals` | `tables` and `rows`. |

`manifest.json` is canonical JSON: keys in the order above, no insignificant whitespace, one final newline. The manifest's SHA-256 is recorded in `migration_export.manifest_sha256` and on the target in `migration_import.manifest_sha256`. The OpenAPI schema `MigrationManifest` is this format.

#### 2.2 Table order: catalogue-driven, from the foreign-key graph (p7-plan R2)

`packages/db/src/transfer/plan.ts` builds the plan at run time from the catalogue, never from a hand list:

1. The tables are every base table of schema `public`, minus `transfer_table_rule` (§3). The pg-boss schema is not exported (in-flight jobs are not transferred; recurring schedules are rebuilt from `job_schedule` when the target's worker starts).
2. The edges are every foreign key (`pg_constraint` `contype = 'f'`) between two exported tables. A self-reference is not an edge.
3. Strongly connected components are computed. Inside a component of more than one table, the planner picks the **nullable** foreign-key columns whose removal makes the component acyclic (it prefers `created_by`/`updated_by`). Those columns are the table's `deferredColumns`: loaded as `null`, then set in a second pass (§6 step 6).
4. A cycle that no nullable column breaks **fails the plan** with `migration plan: foreign-key cycle without a nullable edge: <tables>`. A test pins that the current schema has none.
5. `loadPhase` is the position in a topological order of the resulting graph; ties sort by table name (code point order).

Self-references (for example a parent id in the same table) load in one statement per table, so a row may reference a row inserted later in the same statement only if the constraint is deferrable; otherwise the rows are ordered by the self-reference depth first. The planner computes that order per table and the test covers one self-referencing table with depth 3.

#### 2.3 Row encoding: ids preserved, decimals as strings

- One NDJSON line per row: a JSON object whose keys are the table's columns in attribute order.
- **Every value is its PostgreSQL text output** as a JSON string, under pinned session settings (`TimeZone = 'UTC'`, `DateStyle = 'ISO, YMD'`, `IntervalStyle = 'postgres'`, `extra_float_digits = 3`, `bytea_output = 'hex'`). So `numeric` money and rates stay exact decimal strings (never JSON numbers), `uuid` ids are carried unchanged, `timestamptz` keeps microseconds, arrays use the PostgreSQL array literal, and `boolean` is `"t"`/`"f"`.
- **Exceptions:** `json` and `jsonb` columns are their JSON value (after §4's rewrite), and SQL `NULL` is JSON `null`.
- Rows are sorted by primary key (the key's text output, code point order).
- **`contentDigest`** is the SHA-256 over the table's lines, each ending in `\n`, in that order, computed by the encoder from the database. The export also hashes the bytes it wrote (`fileSha256`) and fails unless the two are equal; the importer re-checks `fileSha256` on read, and the reconciliation recomputes `contentDigest` from the target's live rows with the same encoder (§6 step 8).
- Every exported table is read inside **one** `REPEATABLE READ, READ ONLY` transaction, so the package is one consistent snapshot. `now()`-defaulted columns are exported as stored.

### 3. What the manifest never carries (D-243 Q16)

`transfer_table_rule` (0133) holds the excluded tables. Rows are written by migrations only; a later migration that adds a table that must not travel adds its row in the same migration.

| Table | Rule | Why |
|---|---|---|
| `session` | `exclude_credential` | cookie and CSRF token hashes |
| `oidc_login_state` | `exclude_credential` | single-use state, nonce and PKCE hashes |
| `idempotency_record` | `exclude_operational` | the source's request replay cache (24 hours) |
| `worker_heartbeat` | `exclude_operational` | the source's worker telemetry |
| `search_document`, `search_index_state` | `exclude_derived` | the search index; the target rebuilds it with `search.reindex` after the import |
| `schema_migration` | `compare_only` | the target must be the same release at the same level (§6 step 2); never loaded |
| `migration_export`, `migration_import`, `migration_reconciliation`, `migration_reconciliation_table`, `migration_reconciliation_attachment`, `identity_binding_hold`, `identity_rebind_event` | `exclude_transfer` | each installation's own transfer history |

- **No password hash exists to exclude.** The hub stores no password (ADR-0005). A test asserts that no column of the final schema is named like a password (`password`, `passwd`, `pass_hash`, `pwd`) outside the SecretRef columns of §4, which hold only a reference.
- **Every other table is exported**, including `audit_event`, every approval and decision record, every Finance validation, every configuration and formula version, every report snapshot, `demo_seed_record`, `deployment_environment` and `outbox_event`/`processed_message` (so the target never re-delivers a delivered event).
- **The package scan (REQ-S19-016 "no password hashes"; D-243 Q16).** The round-trip test greps every file of the package for: each excluded table's name as a file; every value of `session.token_hash`, `session.csrf_token_hash` and `oidc_login_state.state_hash` in the source (hex); every SecretRef `provider` other than `unbound`; and the canary secret value the test puts in the fake SecretProvider. Each must be absent.

### 4. SecretRef columns: the reference is unbound, never carried live

`transfer_column_rule` (0133) lists the 15 SecretRef columns. On export each reference `{provider, name}` becomes `{"provider": "unbound", "name": <name>}`, and each entry of a `credential_refs` object is rewritten the same way. The name stays so IT knows which secret to bind; it is a name, never a value (ADR-0052 §5). `unbound` is a valid provider token (`p6_secret_ref_valid`), and the SecretProvider has no `unbound` provider, so on the target every such reference fails as "secret not configured" until IT binds it through the existing Administration screens (storage, notification channels, connectors, webhooks, assistant). A catalogue test (`catalogue.test.ts`, "0133: every SecretRef column …") fails when a SecretRef column has no rule.

### 5. The attachment manifest and the bytes (seam 10)

- `attachments.json` (`schemaVersion` `mth-attachment-manifest/1`) lists one entry per row that names an EvidenceStore object: `objectName` (the storage key, unchanged), `sizeBytes`, `sha256`, `parentTable`, `parentId`, `file` (`attachments/<sha256>`). The columns that name an object are found from the catalogue: every column named `storage_key` (today `evidence_content.storage_key` and `export_job.storage_key`); a test pins the list.
- The export reads each object through the `EvidenceStore` port, verifies its SHA-256 and size against the row (`evidence_content.sha256`, `size_bytes`; `export_job` its own checksum), and writes it once per distinct SHA-256. A missing or mismatching object fails the export, naming the object; it is never skipped.
- The import writes each object under the **same object name** through the target's port (either adapter), reads it back and compares size and SHA-256 (§6 step 3).
- **Where the byte copy lives.** The port and both adapters are in `apps/api`, and `packages/db` cannot import `apps/api` (ADR-0002). The byte copy is therefore `apps/api/src/modules/transfer/attachments.ts` with a small entry `apps/api/src/cli/transfer-attachments.ts` (`copy-in`, `verify`). `tools/migration/import.mjs` runs it before and after `mth-db import-migration`. This moves BE-E's file from the plan's `packages/db/src/transfer/attachments.ts` to `apps/api` (handback §4).

### 6. The import: CLI only, owner role, empty target only (D-243 Q4; seam 8)

`node tools/migration/import.mjs --from <dir> --operator <name>` runs, in order:

1. **Package checks.** `schemaVersion` must be `mth-migration/1`, else exit 2 with `import-migration: refused: unsupported manifest schema version '<v>'`. Every `fileSha256`, the `attachments.json` SHA-256 and the `manifest.json` SHA-256 (against the value given with `--manifest-sha256` when IT supplies it) must match, else exit 2 naming the file.
2. **Target checks** (`mth-db import-migration`, as `mth_owner`, `DATABASE_ADMIN_URL`). The target must be migrated (`mth-db migrate` reports up to date), its highest migration must equal `migrationLevel`, and its `appVersion` must equal the package's. Else exit 2: `import-migration: refused: the target is at <level>, the package at <level>`.
3. **Attachments in.** The byte copy (§5) writes and verifies every object. A failure exits 2 before any database change; objects already written are identical bytes under their own names and are overwritten on the next attempt.
4. **Empty target.** Refused (exit 3, `import-migration: refused: the target database is not empty`) when any row exists in `organization`, `app_user`, `transformation`, `audit_event` or `deployment_environment`. A freshly migrated database passes. Nothing is ever merged into an installation that has its own records.
5. **Load, in one transaction, under the session lock 730403.** Pinned settings as in §2.3. For every exported table except `audit_event`: `ALTER TABLE … DISABLE TRIGGER USER` (the owner owns the tables; foreign keys and CHECK constraints stay enforced), then `DELETE` the rows the migrations seeded, in reverse load order (they are reloaded from the source, which ran the same migrations). `TRUNCATE` is not used: `audit_event` references `organization`, and PostgreSQL refuses to truncate a referenced table unless the referencing one is truncated with it. Then every table in `loadPhase` order: `INSERT INTO t SELECT * FROM jsonb_populate_recordset(NULL::t, $1)` in batches, with `OVERRIDING SYSTEM VALUE` for identity columns. **`audit_event` is never truncated and its two triggers are never disabled**: they refuse only UPDATE, DELETE and TRUNCATE, so its rows load by plain INSERT with their original `id`, `seq`, actors, `occurred_at` and `changes`.
6. **Second pass and sequences.** Set every `deferredColumns` value. Set every identity and serial sequence (including `audit_event_seq_seq`) to the column's maximum. Re-enable the user triggers (`ENABLE TRIGGER USER`).
7. **Holds.** Insert one `identity_binding_hold` (`unbound`) per `app_user` row (§8).
8. **Reconcile** (`packages/db/src/transfer/reconcile.ts`): per exported table, `count(*)` against `rowCount` and the live `contentDigest` (same encoder) against the manifest's; per attachment entry, the target object's size and SHA-256 (from step 3's verification output); and, for a `demo` source, the ADR-0050 checksum of the target against `demoChecksum`.
9. **Commit or roll back.** On any mismatch the transaction is rolled back, the database stays empty, the report is printed (and written to `--report <file>` when given) and the command exits 4. On a match it inserts `migration_import`, `migration_reconciliation` (`run_kind` `import`) with its `migration_reconciliation_table` rows, and **appends** the audit events `migration.imported` (record `migration_import`, with the manifest and attachment-manifest SHA-256, `sourceEnvironment`, `demoChecksum` and the counts in `changes`), `migration.reconciled` and one `identity.binding_held` per hold, as `actor_type` `system`, `source` `cli`, after the loaded history. Then it commits.

`mth-db reconcile-migration --operator <name>` re-runs step 8 at any time (lock 730403) and appends a `recheck` run with its audit event; it changes no business row.

**Seam 8 is not a reopen.** The import restores rows into an empty database; it never edits or deletes an existing audit row, and every application path keeps ADR-0004's rule "no ordinary user modification". The only new audit rows are appended after the history. `audit_event`'s triggers stay enabled throughout, so the database itself still refuses any UPDATE, DELETE or TRUNCATE of the trail during the import.

**Why disabling user triggers is safe here (p7-plan R3).** The rows were accepted by the same guards on the source, at the same migration level. Foreign keys and CHECK constraints stay enforced during the load. The reconciliation proves every table equals the source row for row. The P6 integrity sweep (`apps/api/test/integration/hardening/integrity-sweep.test.ts`) runs on the imported database in the round-trip test.

### 7. The export (API and CLI)

- `createMigrationExport` (`migration.export`, ADM_TECH) takes a reason, inserts `migration_export` (`queued`, `requested_via` `api`) with the audit event `migration_export.requested`, and enqueues `transfer.export`. A second request while one is `queued` or `running` is 422 `migration.export_in_progress` (lock 730402).
- The worker job takes lock 730402, moves the row to `running`, writes the package (§1–§5) into the EvidenceStore under `transfer/migration-exports/<exportId>/`, and moves the row to `succeeded` with the counts, both SHA-256 values, `sourceEnvironment`, `migrationLevel` and (demo only) `demoChecksum`; or to `failed` with a reason. Each transition writes its audit event (`migration_export.started`, `.succeeded`, `.failed`); 0133 refuses a succeeded row without its checksums and a `demo_checksum` on a non-demo export.
- **Service identity.** The job's identity `job:transfer.export` (added by BE-C's migration, ADR-0053 §1) declares **no** permission code. The job reads every table as the database role, like a backup; ADR-0053 scoping does not limit it, and this ADR does not pretend it does. The protections are the `migration.export` right (ADM_TECH only), the audit trail, and that the package stays in IT-controlled storage: no API operation returns row data or bytes.
- `downloadMigrationExportManifest` and `downloadMigrationExportAttachmentManifest` return the two manifests of a succeeded export (409 `migration.export_not_ready` before; 422 `migration.export_failed`). The manifest has no row data. The attachment manifest lists object names and parent ids; it is an installation-wide technical listing for ADM_TECH (§Residuals 4).
- `mth-db export-migration --out <dir> --operator <name>` writes the same package to a directory, recording a `migration_export` row with `requested_via` `cli`.

### 8. Identity rebind under IT control (D-243 Q5; seam 11)

- Users and role assignments travel as records (`app_user`, `user_identity`, `scoped_assignment`, `delegation`); they are the "portable business users/role mappings" of M0364. No password exists; sessions do not travel (§3).
- **Unbound users cannot sign in.** The import creates one `identity_binding_hold` per user in state `unbound`. BE-D adds one check to the user resolution of the sign-in path (`apps/api/src/modules/identity/oidc.ts`, beside the existing `account_disabled` result): a user with an `unbound` hold resolves to the new error `identity_unbound`, the callback redirects to `/login?error=identity_unbound` (the existing pattern of `identity/routes.ts`), no session is created, and the existing `session.login_failed` audit event records the error. The dev login (`AUTH_MODE=dev`) applies the same check. An installation with no hold row behaves exactly as before, so this is **additive** (seam 11); it applies even when the target uses the same issuer, because IT must confirm every carried subject.
- **The mapping file** (CSV, UTF-8, header `user_id,action,new_issuer,new_subject`): `action` is `rebind` (new issuer and subject) or `retain` (the carried issuer and subject are confirmed; `new_issuer` and `new_subject` must equal them).
- `mth-db rebind-identity --mapping <file> --operator <name>` (owner role, lock 730404) validates every line before writing any (the user has an `unbound` hold; the new (issuer, subject) is not bound to another user; no user twice), then in one transaction updates `user_identity`, moves each hold to `rebound` or `retained`, appends `identity_rebind_event`, and writes `identity.rebound` / `identity.retained` audit events with the old and new pair and the mapping file's SHA-256. Any invalid line refuses the whole file (exit 2, every problem listed). Users not in the file stay `unbound`.
- **Bootstrap is unchanged.** `mth-db bootstrap` refuses on an imported database (an organization exists). The deployment guide (DOC-B) states that the mapping file must include at least one administrator before first sign-in.
- `listIdentityRebinds` (`migration_import.read`) lists the holds read-only.

### 9. Permissions (seam 6; seeded by 0135)

| Code | Category | Roles | Grants |
|---|---|---|---|
| `migration.export` | configure | ADM_TECH | `createMigrationExport`, `listMigrationExports`, `getMigrationExport`, both manifest downloads |
| `migration_import.read` | read | ADM_TECH, ADM_ACCESS, AUD | `listMigrationImports`, `getMigrationImport`, `listMigrationReconciliations`, `getMigrationReconciliation`, `listIdentityRebinds` |

The plan named the read code `migration.import_status.read`. A permission code has exactly one dot (0001 `permission_code_check` `^[a-z_]+\.[a-z_]+$`), so it is `migration_import.read`. The import, the re-check and the rebind have **no** API permission: they are CLI-only, run by IT with the owner credentials (D-243 Q4, Q5).

### 10. Advisory locks (ADR-0016 §6)

730402 `migrationExport` (API and worker); 730403 `migrationImport` and 730404 `identityRebind` (CLI, session locks; spelled in `packages/db/src/transfer/` as `MIGRATION_IMPORT_LOCK_CLASS` and `IDENTITY_REBIND_LOCK_CLASS` and pinned to the registry by a test, the `demoReset` precedent). 730406–730409 stay reserved for this block. 730405 is ADR-0065's.

### 11. Schema (0133) and contract

- **0133** creates `transfer_table_rule`, `transfer_column_rule` (append-only, migration-written), `migration_export` (state machine `migration_export_guard`, audited, column grants), `migration_import`, `migration_reconciliation` (append-only, audited, CLI-written), `migration_reconciliation_table`, `migration_reconciliation_attachment` (append-only), `identity_binding_hold` (state machine, audited, CLI-written) and `identity_rebind_event` (append-only). `mth_app` reads every one and writes only `migration_export`. The guard probe is `packages/db/test/integration/p7-transfer-guards.test.ts`.
- **Contract:** 10 operations under the tag `transfer` (5 exports, 4 imports and reconciliations, 1 rebind list), pending in `p7-pending-be-c.ts` and `p7-pending-be-d.ts`.

### 12. Who builds it, and how it is tested

| Task | Builds | Tests (each proves) |
|---|---|---|
| BE-C | `packages/db/src/transfer/{plan,export,manifest}.ts`, `mth-db export-migration`, `transfer/export/**` (5 routes, job `transfer.export`, its service identity migration), `tools/migration/export.mjs` | plan: every public table is exported or in `transfer_table_rule`, no cycle without a nullable edge, load order respects every FK; encoder: decimals, bigints, timestamps with microseconds, arrays, bytea and jsonb survive text round-trip; manifest: canonical bytes, `fileSha256 = contentDigest`, `sourceEnvironment`/`demoChecksum` rule; routes: 403 for every non-ADM_TECH role incl. AUD, 422 in-progress, audit per transition, no operation returns row data |
| BE-D | `packages/db/src/transfer/{import,reconcile,rebind}.ts`, `mth-db import-migration`, `reconcile-migration`, `rebind-identity`, the sign-in check, `transfer/import/**` (5 read-only routes), `tools/migration/{import,reconcile}.mjs` | **round-trip** (demo + P6 fixtures → export → import into an empty database → equal ids, links, `audit_event` rows incl. `seq`, evidence SHA-256, `demoChecksum`; package scan of §3); refusals (schema version, level, non-empty target, checksum) change nothing; mismatch rolls back; `audit_event` triggers enabled throughout; unbound user refused at sign-in; rebind all-or-nothing |
| BE-E | `apps/api/src/modules/transfer/attachments.ts`, `apps/api/src/cli/transfer-attachments.ts` | copy and verify against the filesystem adapter and the fake S3 (both adapters, the P6 contract kit); missing and altered objects are reported, never skipped |
| KBE-A | `tests/integration/transfer/financial-parity.test.ts` | benefit totals, allocations, formula versions, KPI runs and Finance validations recompute identically after the round-trip (decimal strings exact; Unknown/Stale preserved, never 0) |
| DO-D | the A18 transfer drill | the demo package migrates into a clean installation with a different base URL and the report shows equal counts and matching attachment checksums |

## Consequences

- Positive: one format for the A18 drill, the archive's `demo-data/`, backup checks (ADR-0066 uses the attachment manifest) and real installations. The table order follows the schema automatically, and the catalogue tests fail the moment a new table or SecretRef column is not classified.
- Negative: an import needs the same release and migration level on both sides. Moving between releases is: upgrade the source, export, import (documented by DOC-B and ADR-0068).
- Negative: disabling user triggers during the load is a privileged operation; it is confined to the owner-role CLI, an empty target and one transaction that rolls back on any mismatch.

## Residuals (honest)

1. **Scale is unproven** beyond the demo, the P6 fixtures and, if time allows, the P6 load dataset (p7-plan R8). Batching is designed for it; no timing is claimed.
2. **Cross-release imports** are out of scope (§6 step 2).
3. **In-flight jobs** do not travel; queued pg-boss jobs on the source are lost unless the source is drained first. The operator guide says to stop the source's worker and wait for an empty queue before the export.
4. **The attachment manifest lists evidence object names and parent ids**, including those of sensitive records (ADR-0051), to ADM_TECH. It holds no content. The orchestrator may judge this listing under D-219's reasoning or restrict the download to the CLI (handback open question O3).
5. **Secrets must be re-bound by IT** before connectors, SMTP, S3 storage, webhooks or the assistant work on the target; until then they fail as "secret not configured", which the operational exceptions (ADR-0053) show.
6. **The identity hold applies to every imported user**, including those whose IdP did not change, by design (IT confirms each subject).

## Alternatives considered

1. **`pg_dump`/`pg_restore` as the migration format.** Rejected as the migration tool: it carries sessions and secret references verbatim, needs a version-compatible client, gives no per-table reconciliation or attachment manifest, and is not "a versioned migration manifest" (M0364). It remains the backup format (ADR-0066).
2. **Import through the API with new ids.** Rejected: it cannot preserve ids or audit history (REQ-S19-016) and would re-run every guard on historic rows.
3. **Import audit history into a separate archive table** (p7-plan Q4 alternative). Rejected by D-243 Q4; it would fail "preserves … audit history" for the in-app audit view.
4. **Drop SecretRef values entirely.** Rejected: several columns are `NOT NULL`, and IT needs the names to re-bind.
5. **`session_replication_role = replica`** instead of `DISABLE TRIGGER USER`. Rejected: it needs superuser (or a `GRANT SET` the owner role does not have) and would also disable foreign keys.

## Version evidence (M0314)

No new dependency. JSON, SHA-256 (`node:crypto`), file I/O and CSV parsing of the four-column mapping file use Node built-ins and the existing `pg`/Kysely stack (ADR-0001). `jsonb_populate_recordset`, `ALTER TABLE … DISABLE TRIGGER USER` and `OVERRIDING SYSTEM VALUE` are PostgreSQL features present in the SQL floor, PostgreSQL 16 (the guard probe ran on 16.15, handback §3).

## Amendment 1 (2026-11-13, T-DG7-ARCH-R2): the import load on a freshly migrated target (§6), the post-import recheck, and the attachment verify report

- **Author:** solution-architect (T-DG7-ARCH-R2). Base `9430663aa2681a2e776eb396ff8c46148edbf405` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.** This amendment repairs a design error recorded in D-258, item 1. It does not reopen anything. §6 above stated that "a freshly migrated database passes" step 4, and that `audit_event` "loads by plain INSERT with its original `id`, `seq`" while its triggers stay on. Both statements are false:
  - Migrations write `audit_event` rows themselves, for example `job_schedule.create` in 0028 and `service_identity.create` in 0147. These rows have uuid v7 ids and `seq` from 1. BE-D measured this on PostgreSQL 16.15 (handback T-DG7-BE-D, Q1, and the test "Q1 (BLOCKED …)" in `transfer-roundtrip.test.ts`).
  - So the literal step 4 refuses every target. Without step 4, the source rows collide on `audit_event_seq_key`. The target's own rows cannot be removed, because that needs the triggers off, which is a DG1 reopen.
- **What this amendment replaces.** It replaces §6 steps 4–9, the `reconcile-migration` paragraph after them, and the BE-E row of §12 wherever they differ from it. Everything else in this ADR stands unchanged: §1–§5, §6 steps 1–3, §7–§11, the Residuals and the Alternatives.
- **Hard constraints (D-258).**
  - `audit_event` stays append-only, and both of its triggers stay enabled. Nothing truncates, deletes from or updates it.
  - No source audit event is lost, altered or re-attributed.
  - The target's own migration-written events are kept.
  - The result can be verified by reconciliation.
- **Two gate systems.** Nothing in this amendment grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes DG0–DG7.

### A1.1 Options weighed

| Option | What it does | Verdict |
| --- | --- | --- |
| (a) Empty `audit_event` on the target before the load | needs `audit_event`'s triggers bypassed (or dropped) by the owner | **Rejected.** DG1 reopen (ADR-0004 §2, seam 8). Forbidden by D-258. |
| (b) Keep the target's rows, load the source's after them with `seq` shifted by a recorded offset | every source column is verbatim except `seq`, which becomes `seq + Δ` | **Rejected.** Every carried event's stored `seq` changes, so "rows equal including `seq`" (T-C8) and D-243 Q4's "verbatim audit import" no longer hold. A mapping can be verified, but it is weaker than equality. |
| (c) Carry only the source events with `source <> 'migration'` and renumber | as (b), and the source's own migration events are dropped | **Rejected.** It loses source events. |
| (d) A target path whose migrations write no audit row | needs edits to applied, forward-only migrations | **Rejected.** Migrations are never edited once merged, and 28 files write audit rows. |
| (e) Carry the source trail into a separate archive table | | **Rejected** already (D-243 Q4, Alternative 3). The in-app audit view would lose the history. |
| **(f) Reserve the target's audit sequence above the package before any audit row exists** | `mth-db migrate --reserve-audit-seq-for <package>` sets `audit_event_seq_seq` right after the migration that creates it, before any later migration writes an event. The target's migration events then get `seq` values above the package's highest `seq`, and the source rows load with their own `id` and `seq`, unchanged. | **Chosen** (A1.2). |

**Why (f).**

- **Every source audit row is loaded byte for byte**, including `id`, `seq`, `occurred_at`, the actors, `changes`, `request_id` and `source`. So the T-C8 clause "`audit_event` rows equal including `seq`" and D-243 Q4's "verbatim" hold as written.
- **The target's own migration events are kept as they are.** No trigger is touched and no audit row is updated or deleted.
- **One total order holds:** the carried history first, then the target's migration events, then the import's own events, then later use. That order matches what happened on the wall clock: the target was migrated after the source history and before the import.
- **The cost is one preparation step on the target.** A target migrated without the reservation is refused with a precise line telling IT how to recreate it (A1.3, check E3). Setting the identity sequence of an empty table is not an audit modification: no audit row exists yet when it runs.

### A1.2 Preparing the target: `mth-db migrate --reserve-audit-seq-for <dir>`

1. **Who and when.** It runs as `mth_owner` (`DATABASE_ADMIN_URL`), on a database with **no applied migration**. Otherwise it exits 2 with `migrate: refused: --reserve-audit-seq-for needs a database with no applied migration`.
2. **The package is checked first** (§6 step 1). The checks are the manifest's `schemaVersion`, that the manifest is canonical, and the `fileSha256` of `tables/audit_event.ndjson`. A failure exits 2 with `migrate: refused: the package at <dir> failed its checks: <the import-migration reason>`, and the command never connects to the database.
3. **The reserved start.** `R = M + 1`, where `M` is the highest `seq` in `tables/audit_event.ndjson`, read as an exact bigint by streaming the file. If the file has no row, `M = 0`. Nothing else in the package is read.
4. **The hook.** The migration runner (`packages/db/src/migrate.ts`, a new `MigrateOptions.reserveAuditSeqFrom?: bigint`) applies the migrations as usual. Inside the transaction of the **first file after which `to_regclass('public.audit_event_seq_seq')` is not null** (today `0003_audit_event.sql`), after that file's SQL and before its `schema_migration` row, it:
   - asserts `SELECT count(*) FROM audit_event` is 0;
   - runs `SELECT setval('audit_event_seq_seq', R, false)`.

   If the run ends without the hook having fired, the runner exits 2 with `migrate: refused: the migrations never created audit_event_seq_seq; nothing was reserved`. The transaction then rolls back that file, so in practice this line is reached only by a test with a fixture directory.
5. **Output.** On success it prints the usual `applying …` lines, then `migrate: the audit sequence of this target starts at <R> (the package's highest audit seq is <M>)`, and exits 0.
6. **No audit row is written by the reservation itself.** It happens before the first audit row of the installation exists. It is recorded later, on `migration_import` (A1.6) and in `migration.imported` (A1.7).
7. **Wrapper.** `tools/migration/prepare-target.mjs --from <dir>` is a thin wrapper over this command, with the exit codes of p7-work-split §2 rule 4.
8. **Without the option**, `mth-db migrate` behaves exactly as before. Every other installation is unaffected.

### A1.3 The empty-target rule (replaces §6 step 4)

The check runs **inside the load transaction** (A1.4 L1), after `LOCK TABLE audit_event IN EXCLUSIVE MODE`. That lock blocks every other writer until commit or rollback, so no application mutation can slip in between the check and the load. The lock does not disable or bypass any trigger.

| Check | Rule | Refusal |
| --- | --- | --- |
| **E1** no use | no row in `organization`, `app_user`, `user_identity`, `transformation`, `deployment_environment`, `evidence_content`, `export_job`, `migration_import`, `identity_binding_hold`, `session` or `worker_heartbeat` | exit 3: `import-migration: refused: the target database is not empty` (C.5, unchanged), then one line per table: `import-migration: <table> holds <n> rows` |
| **E2** baseline only | every `audit_event` row is a **baseline row**: `source = 'migration' AND actor_type = 'system' AND actor_user_id IS NULL AND on_behalf_of_user_id IS NULL AND organization_id IS NULL AND transformation_id IS NULL` | exit 3: the C.5 line, then `import-migration: audit_event holds <n> rows not written by migrations` |
| **E3** reserved | if any baseline row exists, `min(seq)` of the baseline is greater than `M`, the package's highest audit `seq` | exit 2: `import-migration: refused: the target's audit events start at seq <s>, at or below the package's highest audit seq <M>; recreate the target with mth-db migrate --reserve-audit-seq-for <dir>` |
| **E4** triggers on | `audit_event_immutable` and `audit_event_immutable_truncate` both have `tgenabled = 'O'` | exit 2: `import-migration: refused: audit_event trigger <name> is not enabled` |

**Why E1 and E2 together mean "only migration seeds".**

- ADR-0004 §3 makes every application, worker and CLI mutation write an audit event, and those events are never baseline rows: they carry an actor, an organization, or a source other than `migration`.
- `worker_heartbeat` and `session` catch a worker that has started and a sign-in. Neither writes a business audit event.
- So when E1 and E2 hold, every row in every other exported table was written by a migration of the same release at the same level (§6 step 2). Those rows are exactly what the source also holds, and step L4 replaces them with the source's own copy.

**BE-R1's T-R1 measures that a freshly migrated target satisfies E1, E2 and E4.** If a future migration writes a baseline row that E2 does not describe, that test fails. A new migration must not weaken E2. If one ever needs to, it stops and reports to the architect.

### A1.4 The load (replaces §6 steps 5–7 and 9)

Steps 1–3 of §6 are unchanged: package checks, target checks, then the attachment copy-in. After step 3, `tools/migration/import.mjs` also runs `transfer-attachments verify --from <dir> --out <report>` (A1.8). It then passes `--attachments-report <report>` to `mth-db import-migration`.

From L0 to L12 below is **one transaction**, under the session lock 730403. A refusal or failure at any point rolls the whole transaction back.

| Step | What | Rule |
| --- | --- | --- |
| L0 | open | `BEGIN`; the pinned encoder settings of §2.3 (`SET LOCAL`); `LOCK TABLE audit_event IN EXCLUSIVE MODE` |
| L1 | empty target | E1–E4 (A1.3) |
| L2 | record the baseline | Over the baseline rows: `rows`, `min(seq)`, `max(seq)`, and the **baseline digest**, which is the §2.3 encoder applied to `audit_event` with `WHERE seq > M` (sorted by primary key, as always). If there are no rows, the digest is that of the empty string. |
| L3 | user triggers off, except `audit_event` | `ALTER TABLE … DISABLE TRIGGER USER` on every exported table **except `audit_event`**. Foreign keys and CHECK constraints stay enforced. Re-assert E4 afterwards. |
| L4 | replace the migration seeds | `DELETE FROM t` on every exported table except `audit_event`, in **reverse** `loadPhase` order, counting the rows per table (`seedRowsReplaced`). `TRUNCATE` is never used (§6). `audit_event` is never a target of DELETE: its baseline rows stay. |
| L5 | load | Every exported table, in `loadPhase` order: `INSERT INTO t [OVERRIDING SYSTEM VALUE] SELECT * FROM jsonb_populate_recordset(NULL::t, $1)`, in batches, with `deferredColumns` loaded as `null`. **`audit_event` is loaded at its `loadPhase` the same way, with its own `id` and `seq`.** E3 guarantees that no carried `seq` and no carried `id` collides with a baseline row. A uuid v7 collision would be refused by the primary key and roll everything back. |
| L6 | second pass | Set every `deferredColumns` value (§2.2). If the plan gives `audit_event` a deferred column, the import refuses before L3 (exit 1, `import-migration: failed: the plan defers a column of audit_event, which can never be updated`). T-R2 pins that it has none today. |
| L7 | sequences | For every identity or serial column of an exported table: `setval(seq, greatest(max(col), <current last_value>), true)`. A sequence is **never lowered**. For `audit_event_seq_seq` this keeps the value above the baseline. |
| L8 | user triggers on | `ALTER TABLE … ENABLE TRIGGER USER` for exactly the tables of L3, then re-assert E4. Triggers that were disabled during an INSERT queue no deferred event, so `p2_audit_required` does not fire after the fact for loaded rows. They were audited on the source, and their audit rows are among the carried events. |
| L9 | reconcile (§6 step 8; A1.5) | Per exported table, live count and digest against the manifest. For `audit_event`, the **carried range** (`seq <= M`) is compared, and the baseline is recorded as an allowed delta. Attachments come from the A1.8 report. |
| L10 | mismatch → rollback | On any mismatch: `ROLLBACK`. The report goes to stdout and to `--report <file>`, and the command exits 4 with the C.5 line. The database is as it was before L0: still migrated, still with only its baseline. |
| L11 | records | `migration_import` with the A1.6 fields; one `identity_binding_hold` (`unbound`) per `app_user` row; then `migration_reconciliation` (`run_kind` `import`), its `migration_reconciliation_table` rows, its `migration_reconciliation_attachment` rows and its `migration_reconciliation_delta` rows (A1.6). |
| L12 | audit and commit | **Append** `migration.imported`, `migration.reconciled`, and one `identity.binding_held` per hold. Each is written as `actor_type` `system`, `source` `cli`, through the ordinary sequence, so after the baseline. Then `COMMIT`. |

**After L12, the import prints:**
- the C.5 success line, unchanged;
- then one more line: `import-migration: audit history: <c> carried events (seq <a>-<M>) and <b> target migration events (seq <x>-<y>) kept; nothing was renumbered`. `<b>` may be 0, and `(seq <x>-<y>)` is then omitted.

**The import still never edits or removes an audit row, and both triggers stay enabled throughout** (T-R4 checks this between every step). The import's own events are the only new audit rows beyond the carried ones. The trail's total order is:

| Range | Which events |
| --- | --- |
| `seq <= M` | carried history, verbatim |
| `M < seq <= y` | the target's migration baseline |
| `seq > y` | the import's own events, then later use |

### A1.5 How the audit chain and its order are verified

DG1 gives `audit_event` no hash chain (ADR-0004 §2 leaves that as a later option). "The chain" here therefore means four things: the set of events, their content, their order, and the boundaries between the three ranges. Each is proven by one check.

| Property | Check (at L9, and again by every recheck) |
| --- | --- |
| no source event lost or added | `count(*) WHERE seq <= M` equals the manifest's `rowCount` for `audit_event` |
| no source event altered or re-attributed | the §2.3 encoder over `audit_event WHERE seq <= M`, sorted by `id`, gives the manifest's `contentDigest`. Every column is covered, including `id`, `seq`, `occurred_at`, `actor_type`, `actor_user_id`, `on_behalf_of_user_id`, `organization_id`, `transformation_id`, `source`, `request_id` and `changes`. |
| source order unchanged | follows from the digest: `seq` is part of every encoded line |
| baseline kept and unchanged | rows, `min(seq)`, `max(seq)` and the digest of `M < seq <= audit_baseline_seq_max` equal the L2 values recorded on `migration_import` |
| ranges do not interleave | `max(seq) WHERE seq <= M` ≤ `M` < `audit_baseline_seq_min` ≤ `audit_baseline_seq_max` < `min(seq)` of the import's own events. Every event after the import has `seq > audit_baseline_seq_max`. |
| triggers on | E4 at L1, L3 and L8 (import), and at the start of every recheck |

### A1.6 Schema (migration `0149`, BE-R1; the next free id above `0148`, D-245 O9)

**`migration_import` gains seven columns.** All are NULL-able so the migration applies on any database at 0148. Every row written by the 0149 code fills all of them, and a CHECK enforces "all or none".

| Column | Type | Meaning |
| --- | --- | --- |
| `audit_carried_rows` | bigint ≥ 0 | the manifest's `audit_event` `rowCount` |
| `audit_carried_seq_max` | bigint ≥ 0 | `M` |
| `audit_baseline_rows` | bigint ≥ 0 | L2 rows |
| `audit_baseline_seq_min`, `audit_baseline_seq_max` | bigint, both NULL exactly when `audit_baseline_rows = 0` | L2 range |
| `audit_baseline_digest` | text `^[0-9a-f]{64}$` | L2 digest |
| `seed_rows_replaced` | bigint ≥ 0 | sum of L4's deletes |

**CHECK `migration_import_audit_ranges`:** all seven columns are NULL, or:
- `audit_carried_rows`, `audit_carried_seq_max`, `audit_baseline_rows`, `audit_baseline_digest` and `seed_rows_replaced` are all NOT NULL;
- `(audit_baseline_rows = 0) = (audit_baseline_seq_min IS NULL)`, and the same for `audit_baseline_seq_max`;
- `audit_baseline_seq_min > audit_carried_seq_max` and `audit_baseline_seq_max >= audit_baseline_seq_min`, when the baseline is not empty.

**`migration_reconciliation`:**
- `run_kind` gains the value `recheck_after_use`.
- The CHECK `migration_reconciliation_result` is replaced by: `(result = 'matched') = (tables_mismatched = 0 AND attachments_mismatched = 0 AND (run_kind = 'recheck_after_use' OR rows_expected = rows_actual))`.
- Both changes are drop-and-add of a CHECK. Existing rows still satisfy the looser rule. `tools/release/migration-catalogue.mjs` classifies 0149 as it finds it; BE-R1 regenerates the catalogue and adds no override that lowers the class.

**New table `migration_reconciliation_delta`.** It is append-only (`p2_attach_append_only`), `mth_app` has SELECT only, and it is written by the CLI (owner):

| Column | Type | Meaning |
| --- | --- | --- |
| `migration_reconciliation_id` | uuid, FK `migration_reconciliation` | the run |
| `table_name` | text, the identifier pattern of 0133 | the table |
| `basis` | text, one of `audit_baseline`, `audit_additions`, `rebind`, `exact_ids`, `operational`, `unexplained` | why the table may differ |
| `rows_added`, `rows_changed`, `rows_missing` | bigint ≥ 0 | against the package (or the carried range) |
| `allowed` | boolean | `false` only with basis `unexplained`, or when an `exact_ids` set does not match |
| primary key | `(migration_reconciliation_id, table_name, basis)` | |

**Rule (code and test, not a CHECK):** a run is `matched` only if every delta row of the run is `allowed`. `tables_mismatched` counts the tables that have a `matched = false` table row with no allowed delta, plus the tables with a disallowed delta.

**Also in BE-R1's scope:** `transfer_table_rule` gains exactly one row, `('migration_reconciliation_delta', 'exclude_transfer', 'Written by the import and the rechecks on the target')`, so the new table never travels (the T-C1 catalogue test requires it). The data dictionary, ERD, Kysely types, `SCHEMA_COLUMNS` and catalogue pins follow.

**Contract (additive only):**
- `MigrationImport` gains the seven fields, nullable, as decimal strings for bigint.
- `MigrationReconciliation` gains `runKind` value `recheck_after_use` and an array `deltas[]` of `{tableName, basis, rowsAdded, rowsChanged, rowsMissing, allowed}`.
- No operation is added or removed.

### A1.7 The `migration.imported` event (replaces the event part of §6 step 9)

The event is: `record_type` `migration_import`, `record_id` the import id, `new_version` 1, `actor_type` `system`, `source` `cli`, `reason` `null`, and `request_id` set to the operator name prefixed `cli:`.

`changes` follows the `{field: {from: null, to: …}}` shape (ADR-0004 §1). The fields are:
- `manifestSha256`, `attachmentManifestSha256`, `sourceEnvironment`, `demoChecksum`;
- `tableCount`, `rowCount`, `attachmentCount`;
- `auditCarried` `{rows, seqMax}`;
- `auditBaseline` `{rows, seqMin, seqMax, digest}`;
- `seedRowsReplaced` `{total, tables: {<table>: <n>}}`, listing only the tables with n > 0.

All counts are decimal strings. The event names no source user and no secret.

**What the replaced seeds mean for the baseline.** A baseline event (for example `job_schedule.create` for `01920004-0001-7000-8000-000000000001`) describes a migration seed that L4 replaced with the source's row of the same id. The `seedRowsReplaced` field is the record of that replacement. The baseline event is kept as written (D-258), so the trail shows the event twice: once in the carried history (the source's migration) and once in the baseline (the target's). The audit view shows both because both happened.

### A1.8 The attachment verify report that `reconcile` consumes (BE-D gap 2, BE-E §2)

`apps/api/src/cli/transfer-attachments.ts verify --from <dir> --out <file>` (BE-E) writes **`mth-attachment-verify/1`**. It is adopted here as the contract, exactly as BE-E built it. The file is canonical JSON, with keys in this order, no insignificant whitespace, and one final newline:

```json
{
  "schemaVersion": "mth-attachment-verify/1",
  "attachmentManifestSha256": "<64 hex: SHA-256 of the package's attachments.json>",
  "checked": 0,
  "result": "matched",
  "mismatches": [
    {
      "parentTable": "<table>",
      "objectName": "<storage key>",
      "problem": "missing",
      "expectedSize": "<decimal string>",
      "actualSize": null,
      "expectedSha256": "<64 hex>",
      "actualSha256": null
    }
  ]
}
```

(The example is pretty-printed for reading. The file itself is one line.)

| Field | Rule |
| --- | --- |
| `checked` | a JSON integer, equal to `attachments.json`'s entry count |
| `result` | `matched` exactly when `mismatches` is empty |
| `problem` | `missing`, `size_mismatch` or `sha256_mismatch` |
| `actualSize`, `actualSha256` | both `null` exactly for `missing` |
| sizes | decimal strings |
| `mismatches[]` order | the order of `attachments.json` |

**`mth-db import-migration` and `reconcile-migration` read it with `--attachments-report <file>`** and refuse (exit 2) when:

| Condition | Line |
| --- | --- |
| the package lists attachments (`attachmentManifest.count > 0`, or `migration_import.attachment_count > 0` for a recheck) and no report is given | `<cmd>: refused: the package lists <n> attachments; give --attachments-report <file> written by transfer-attachments verify` |
| the file is not strict UTF-8 canonical JSON, `schemaVersion` differs, a field is missing or extra, or a rule above is broken | `<cmd>: refused: invalid attachment report: <reason>` |
| `attachmentManifestSha256` differs from the package's (import) or from `migration_import.attachment_manifest_sha256` (recheck) | `<cmd>: refused: the attachment report belongs to another package (<a>, the import recorded <b>)` |
| `checked` differs from the count | `<cmd>: refused: the attachment report checked <c> of <n> attachments` |

`<cmd>` is `import-migration` or `reconcile-migration`. A package with no attachments needs no report, and `attachments_checked` is then 0, which is the truth. **A recheck never reports `attachments_checked = 0` for a package that has attachments.** The mismatches go one-to-one into `migration_reconciliation_attachment` (§6 step 8). `tools/migration/import.mjs` and `tools/migration/reconcile.mjs` run `verify` immediately before the database command, in the same wrapper run, and delete the report file afterwards unless `--keep-reports <dir>` is given.

### A1.9 The recheck (replaces the `reconcile-migration` paragraph of §6; BE-D Q2, DO-D Q2)

`mth-db reconcile-migration --operator <name> [--attachments-report <file>] [--after-use --from <dir> --allow <file>]` runs as `mth_owner` under lock 730403. It reads the latest `migration_import`; with none recorded it exits 2, as built. It changes no business row. It appends one `migration_reconciliation` with its child rows and one `migration.reconciled` audit event. Those writes are the expected `audit_event` additions of the next recheck.

#### Mode 1, before use (default; `run_kind` `recheck`)

This is the state right after the import and the identity rebind, before anyone has used the target. Exit 0 means `matched`; exit 4 means `mismatch`, with the C.5 lines.

| Table | Must hold |
| --- | --- |
| every exported table except `audit_event` and `user_identity` | live count and digest equal the import run's `migration_reconciliation_table` expectations, which are the manifest values |
| `audit_event` | the carried range and the baseline equal (A1.5). Rows with `seq > audit_baseline_seq_max` are **additions** and are always allowed (delta `audit_additions`). The report lists them by `action` with counts. |
| `user_identity` | the live rows, with each `identity_rebind_event` of action `rebound` **reversed** (issuer and subject set back to `old_issuer`, `old_subject` for that identity), equal the expectation. Delta `rebind`, `rows_changed` = the number of rebound identities. A rebound identity whose live pair differs from the event's `new_issuer`, `new_subject` is `unexplained`. |
| attachments | the A1.8 report: every mismatch counts |

Any other difference is a mismatch. Mode 1 is the D5 check and the T-R6 check.

#### Mode 2, after use (`--after-use`; `run_kind` `recheck_after_use`)

This is for a target that has been used, for example by the drill's D8. It needs the package directory (`--from`, re-checked as in §6 step 1) and an **allowance file**. It compares **row by row** by primary key: each live row against the package row, both encoded by §2.3. Each row is unchanged, added, changed, or missing.

The allowance file is `mth-recheck-allowance/1`: strict UTF-8 JSON (not necessarily canonical), validated before any database read.

```json
{
  "schemaVersion": "mth-recheck-allowance/1",
  "tables": [{ "name": "transformation", "added": [["<pk text>"]], "changed": [] }],
  "operational": ["job_run"]
}
```

- **`tables[]`:** `name` is an exported table. `added` and `changed` are arrays of primary-key tuples. A tuple holds the key columns' text output, in key order, as JSON strings.
- **`operational[]`:** table names from the code constant `RECHECK_OPERATIONAL_TABLES` (`packages/db/src/transfer/recheck.ts`).

**The rules:**

1. **`audit_event`:** as in mode 1. It may not appear in the file.
2. **`user_identity`:** the mode 1 reversal is applied first. Further changes (for example `last_login_at` after a sign-in) must be listed in `tables` with exact ids.
3. **A table in `tables`:** its set of added keys must **equal** `added` exactly, its set of changed keys must **equal** `changed`, and no row may be missing (ADR-0003: no hard delete). Delta basis `exact_ids`; `allowed` is false if any set differs, and the report prints the extra and the absent keys, at most 20 of each.
4. **A table in `operational`:** additions, changes and missing rows are allowed and counted (delta `operational`).
5. **Every other exported table:** must be row-for-row unchanged. Any difference gives delta `unexplained` and `allowed = false`.
6. **Never in `operational`** (the constant's test pins this):
   - `audit_event`, `app_user`, `user_identity`, `scoped_assignment`, `delegation`;
   - every approval and decision table (`gate_decision`, `approval`, `approval_decision`, and every table whose name starts with `decision`);
   - the 17 financial tables of T-C17.

   Rows these tables gain through use must be named, key by key, in `tables`.
7. **The allowance file itself is refused** (exit 2, `reconcile-migration: refused: invalid allowance file: <reason>`) for:
   - an unknown, excluded or duplicated table;
   - a table both in `tables` and in `operational`;
   - an `operational` name outside the constant;
   - a malformed key tuple.

**Output:**
- Exit 0 prints `reconcile-migration: matched after use: <t> tables unchanged, <d> tables with allowed differences, <e> audit events added since the import`.
- Exit 4 prints the C.5 mismatch line, then one line per disallowed table: `  <table>: <a> added, <c> changed, <m> missing (<basis>)`.

**What the drill's D9 asserts with mode 2.** The drill passes the keys its journey received from API responses: the records D8 created or changed, the rows the worker derived from them that the journey reads back through the API, and the identities that signed in. Those are exactly D8's additions. Everything else is operational, or must be unchanged.

**The initial `RECHECK_OPERATIONAL_TABLES`:** `job_schedule`, `job_run`, `outbox_event`, `processed_message`, `operational_failure`, `operational_exception`, `operational_exception_event`, `inbox_notification`, `notification_delivery`, `notification_digest`, `export_job`, `export_job_progress`.
- BE-R1 may remove a name that it measures is never written.
- Adding a name needs the architect: it is a new place where a recheck stops seeing changes.

### A1.10 DG1 audit guarantees: how each is preserved

| Guarantee (ADR-0004, 0003) | How |
| --- | --- |
| `audit_event_immutable` refuses UPDATE and DELETE, even for the owner | Never disabled. E4 is checked at L1, L3 and L8 and at every recheck. T-R4 checks `tgenabled = 'O'` between steps. The import issues no UPDATE or DELETE on `audit_event`; L4 excludes it by name. |
| `audit_event_immutable_truncate` refuses TRUNCATE | Never disabled. The import issues no TRUNCATE at all (§6). |
| `mth_app` has INSERT and SELECT only | Unchanged. The import, the reservation and the rechecks run as `mth_owner` through the CLI only (C.11), and no grant changes. |
| one total order (`seq` unique, `GENERATED ALWAYS`) | Kept. The carried rows keep their `seq`. The reservation places every target event above them, and the sequence is never lowered (L7). `audit_event_seq_key` is never violated. A collision is impossible after E3, and would roll back the transaction if it happened. |
| events are written in the transaction of the mutation | The import's own events are written in the import's transaction (L12). The loaded rows were written in the source's transactions and are carried as history. |
| no ordinary user modification | No route, job or permission reaches any of this (C.11). The only new rows are appended. |
| owner credentials are IT-held (residual of ADR-0004) | Unchanged. The amendment adds no way for the owner to alter the trail. Setting the sequence of an empty `audit_event` (A1.2) runs before the installation's first event. |

### A1.11 Residuals of this amendment

1. **The target must be prepared with the reservation.** A plainly migrated target is refused (E3), with the remedy in the message. For an operator this is one more documented step. DOC-B adds it to the deployment and operator guides (C.12, B.6 DO-D2).
2. **The trail shows each seed's creation twice** (A1.7): once for the source and once for the target's baseline. Both are true events. The baseline events have no organization, so transformation-scoped audit views never show them.
3. **Mode 2 depends on the allowance the operator gives.** It proves "exactly these keys changed, and nothing else outside the operational list". It cannot judge whether those were the right changes. The drill's keys come from API responses, and a reviewer can read the file.
4. **`RECHECK_OPERATIONAL_TABLES` is a judgment.** A difference in those tables is counted, not explained. The list excludes every identity, approval, decision and financial table by test.
5. **E1/E2 rely on ADR-0004's coverage rule** (every mutation writes a non-baseline audit event), plus the heartbeat and session rows. A writer that broke that rule would also break DG1's own tests.

## Amendment 2 (2026-11-13, T-DG7-ARCH-R3): carried audit events already present in the target's baseline, the mode 2 allowance, and the register snapshot under the asset scan

- **Author:** solution-architect (T-DG7-ARCH-R3). Base `ecd65f96b732e272780a82272164af6a760f6586` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.** D-259 records three open items after repair round 1. This amendment decides them. It does not reopen anything:
  1. **R1.** Migrations `0068` (l.372), `0069` (l.212) and `0095` (l.40, l.85, l.92) insert `audit_event` rows with **deterministic ids** (literal uuids, or uuids derived from `md5('p5-procedures-v2:audit:' || id)`). A source and a target therefore both hold these rows under the same `id`. A1.4 L5 claimed that "E3 guarantees that no carried `seq` and no carried `id` collides with a baseline row". That holds for `seq` but **not for `id`**. BE-R1 measured the load failing on `audit_event_pkey` and stopped it at L1 (BE-R1 handback §0).
  2. **DO-D2 Q2.** Under A1.9 rule 5, mode 2 would call correct writes `unexplained` when no API response returns their keys: gate instance updates, work items, decision child rows, and the role assignment and lifecycle rows a new transformation creates.
  3. **DO-D2 gap 1.** `apps/api` `build` writes the register into `dist/release/register-snapshot.json` (ADR-0071 §2). Two register rows quote build-host paths, and ADR-0062 §8 rule R2 refuses the runtime tree. As a result, every archive built from `HEAD` fails `build-from-archive`.
- **What this amendment replaces.** It replaces:
  - A1.4 L1, L5, L9 and the "after L12" lines, where they differ from A2.2;
  - A1.5's first, second and fourth rows, as given in A2.3;
  - A1.6, by adding the 0150 schema (A2.4);
  - A1.7, by adding one field;
  - A1.9 mode 2: the allowance format and rules 3–7 are extended by A2.6, and nothing in them is loosened.

  Everything else in this ADR and in Amendment 1 stands unchanged.
- **Hard constraints (D-258, D-259).** They are unchanged:
  - `audit_event` stays append-only, and both of its triggers stay enabled;
  - nothing truncates, deletes from or updates it;
  - no source audit event is lost, altered or re-attributed;
  - the target's own migration events are kept;
  - the result is verified by reconciliation;
  - nothing is skipped silently, renumbered or archived.
- **Two gate systems.** Nothing in this amendment grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes DG0–DG7.

### A2.1 R1: options weighed

The facts that decide it:

- The colliding rows are migration seeds, written with `source = 'migration'`, `actor_type = 'system'` and no actor, organization or transformation.
- Two of their columns are assigned by the database at insert time, and these necessarily differ between the source's copy and the target's:
  - `seq` (`GENERATED ALWAYS AS IDENTITY`). The A1.2 reservation puts the target's value above `M`, the source's below it.
  - `occurred_at` (`DEFAULT now()`). It is the wall-clock time of each installation's own `mth-db migrate`.
- The other 13 columns are written as literals or derived deterministically by the migration: `id`, `organization_id`, `transformation_id`, `actor_type`, `actor_user_id`, `on_behalf_of_user_id`, `action`, `record_type`, `record_id`, `prior_version`, `new_version`, `reason`, `request_id`, `source` and `changes`. That makes 15 columns in total.

| Option | What it does | Verdict |
| --- | --- | --- |
| (a) D-259 as worded: accept a shared id only if **every** column is byte-identical | | **Improved, not adopted literally.** `seq` and `occurred_at` differ by construction (BE-R1 measured both). The literal rule would refuse every import, so it is the same as no decision. |
| (b) Insert the carried copy under a new id, or with a suffix | | **Rejected.** That renumbers an event, which D-259 forbids. |
| (c) Skip the carried copy and say nothing | | **Rejected.** That skips silently and loses the source's `seq` and `occurred_at`. |
| (d) Load the carried trail before the deterministic-id migrations run (migrate to `0003`, load, then continue) | | **Rejected.** `0068` then fails on its own `INSERT` (`audit_event_pkey`). Migrations are never edited (A1.1 (d)). |
| (e) Delete or replace the target's baseline copy | | **Rejected.** That is a DG1 reopen (ADR-0004 §2). |
| **(f) Accept the shared id only when the event's content is identical** | All 13 non-database-assigned columns must be identical under the §2.3 encoder, and both copies must be migration baseline rows. The carried copy is then counted `already_present`. It is never inserted. Its source `seq` and `occurred_at` are recorded **in the trail itself**, in `migration.imported`. Reconciliation rebuilds the source's `audit_event` file exactly from the live rows plus that record, and requires the manifest's `contentDigest`. Any other difference refuses the import. | **Chosen** (A2.2). |

**Why (f) keeps D-259's direction and improves it:**

- The test is "the same event from the same migration". That means the same id, the same action, the same record, the same version step, the same reason, the same (absent) actor and scope, and the same `changes`. The two columns the database stamps at insert time describe *where and when* each installation ran the migration, not *what* happened. Requiring them to be equal is impossible. Ignoring them would lose source data. So they are **recorded, not compared**.
- **Nothing is lost.** The record sits in an `audit_event` row, the `migration.imported` event. The DG1 triggers protect that row against UPDATE, DELETE and TRUNCATE exactly as they protect the rest of the trail. Being part of the trail, it also travels in a later export (a second hop), where a side table classified `exclude_transfer` would not.
- **Nothing is silent.** The count is printed and stored (`migration_import.audit_already_present_rows`) and carried as a delta row (`audit_already_present`). The ids are listed in the event, and every recheck re-proves them.
- **Proof, not trust.** The manifest's `contentDigest` covers every column of every carried row, including `seq` and `occurred_at`. Reconciliation must reproduce that digest bit for bit from the target, so a single wrong recorded value fails it.

### A2.2 R1: the rule in the load

These changes are made to A1.4. Every step not named here is unchanged.

| Step | Change |
| --- | --- |
| L1 | After E1–E4, **E5 shared ids**. Stream `tables/audit_event.ndjson` and collect the carried ids. `P` is the set of carried rows whose `id` exists on the target (`SELECT id FROM audit_event WHERE id = ANY($1)`, in batches). For each row in `P`, compare the package line with the live row encoded by the §2.3 encoder under the L0 settings, **column by column** over the 13 columns of A2.1, by the exact JSON text of each value. Also check that both copies satisfy the E2 baseline predicate (`source = 'migration'`, `actor_type = 'system'`, and null `actor_user_id`, `on_behalf_of_user_id`, `organization_id`, `transformation_id`). Any row that fails refuses the import with exit 1 (the A2.7 lines), and the transaction rolls back before L2. The source `seq` must be `<= M`, which is true by definition of `M`. |
| L2 | Unchanged. The baseline digest covers every baseline row, including those in `P`. |
| L5 | `audit_event` is loaded as before, except that rows in `P` are **not** inserted. No other row is ever left out. The number inserted must equal `rowCount − \|P\|`, else exit 1 `import-migration: failed: audit_event loaded <n> rows, expected <rowCount − \|P\|>`. |
| L9 | `audit_event` is reconciled by **reconstruction** (A2.3). The table row records `rows_expected = rowCount`, `rows_actual` = live `count(*) WHERE seq <= M` plus `\|P\|`, and the reconstructed digest. A delta row `audit_already_present` is written with `rows_added 0`, `rows_changed \|P\|` and `rows_missing 0`, `allowed = true`. "Changed" here means that these carried rows are present with the target's `seq` and `occurred_at`. |
| L11 | `migration_import.audit_already_present_rows = \|P\|` (A2.4). |
| L12 | `migration.imported` gains the field `auditAlreadyPresent` (A2.5). |

**After L12**, when `|P| > 0`, the import prints one more line after the A1.4 audit-history line. That line keeps its form, and its `<c>` counts the rows inserted:

`import-migration: audit history: <p> carried events were already present as identical target migration events (same id and content); their source seq and time are recorded in migration.imported, and none was inserted twice`

### A2.3 R1: how the trail is verified (A1.5, rows 1, 2 and 4 replaced)

Let `P` be the entries of `migration.imported`'s `auditAlreadyPresent`. The **reconstructed carried trail** is the union of two sets:

- the live rows with `seq <= M`;
- for each entry of `P`, the live row with that `id`, with `seq` and `occurred_at` replaced by the entry's `sourceSeq` and `sourceOccurredAt` (the exact §2.3 text from the package line).

It is encoded with the §2.3 encoder, sorted by `id`, using the column order and line format of `encodeTable`.

| Property | Check (at L9, and again by every recheck in either mode) |
| --- | --- |
| no source event lost or added | `count(*) WHERE seq <= M` + `\|P\|` = the manifest's `rowCount`, and `\|P\|` = `migration_import.audit_already_present_rows` |
| no source event altered or re-attributed | the reconstructed trail's digest = the manifest's `contentDigest`. Because every column of every carried line is covered, this also proves each recorded `sourceSeq` and `sourceOccurredAt`. |
| every `P` entry names a baseline row | each entry's `id` exists with `seq` between `audit_baseline_seq_min` and `audit_baseline_seq_max` and satisfies the E2 predicate. The entries are sorted by `id` and unique. |
| baseline kept and unchanged | as in A1.5 (`P` rows are baseline rows, so the L2 digest covers them) |

Rows 3, 5 and 6 of A1.5 (order, non-interleaving ranges, triggers on) stand. The source order of the `P` events is part of the reconstruction, because their `sourceSeq` is in the digest.

**Implementation note.** `reconcile.ts` gets `encodeCarriedAudit(tx, M, present)`. It uses the same line encoder and column order as `encodeTable`, through a `UNION ALL` of the two sets that overlays `seq` and `occurred_at` from `jsonb_to_recordset($1)`. With `present = []` it must give exactly `encodeTable(…, { where: 'seq <= M' })`, and a unit case pins that.

### A2.4 Schema: migration `0150` (BE-R2; the next free id above `0149`, D-245 O9)

- `migration_import` gains `audit_already_present_rows bigint NULL`, with CHECK `migration_import_audit_present`: `audit_already_present_rows IS NULL OR (audit_already_present_rows >= 0 AND audit_carried_rows IS NOT NULL AND audit_already_present_rows <= audit_carried_rows AND audit_already_present_rows <= audit_baseline_rows)`. Every row written by the 0150 code fills it, with 0 when nothing is shared.
- `migration_reconciliation_delta.basis`: the column CHECK of 0149 is dropped and re-added. The allowed values become `audit_baseline`, `audit_additions`, `audit_already_present`, `rebind`, `exact_ids`, `audit_explained`, `child_of`, `operational` and `unexplained`. The CHECK `migration_reconciliation_delta_unexplained` is unchanged.
- Nothing in 0150 touches `audit_event`, its triggers or its grants, and its header says so. `tools/release/migration-catalogue.mjs` classifies 0150 as it finds it, with no override.
- **Contract (additive only):** `MigrationImport.auditAlreadyPresentRows` (nullable decimal string), and the three new `basis` values. No operation is added or removed.

### A2.5 The `migration.imported` field (adds to A1.7)

`auditAlreadyPresent`: `{from: null, to: {rows: "<p>", entries: [{id, sourceSeq, sourceOccurredAt}]}}`. The entries are sorted by `id`. `sourceSeq` is a decimal string. `sourceOccurredAt` is the package line's exact §2.3 text. When `|P| = 0`, it is `{rows: "0", entries: []}`, never absent.

The size is bounded by the release: only migrations write deterministic audit ids. Reading the three migrations BE-R1 measured gives 44 such rows today: one in `0068`, one in `0069`, and 42 in `0095` (one version event, 10 definition events and 31 step events). BE-R2 measures the exact number on a real import and records it. The event names no user and no secret.

The trail now shows each such event **once**, at the target's position, and `migration.imported` records where it stood in the source's history. This narrows A1.11 residual 2 for these rows: they are no longer shown twice.

### A2.6 The mode 2 allowance (DO-D2 Q2; extends A1.9)

**Options weighed:**

| Option | Verdict |
| --- | --- |
| Put the tables in `operational` | **Rejected.** That is "ignore the table", and A1.9 rule 6 forbids it for approval, decision, identity and financial tables. |
| Per-table expected deltas (counts only) derived from the action list | **Rejected as the only rule.** A count cannot tell D8's row from a stray one of the same table. |
| Read "whatever is new" from the target into the allowance | **Rejected** (B.6: it would make D9 prove nothing) |
| **Keys explained by the database-enforced audit trail of the drill's own actors, plus FK children of explained rows** | **Chosen.** It is key by key and strict. It rests on a guarantee the database enforces (`p2_audit_required`), not on the drill's opinion. |

**Why the audit trail can explain keys.** Every table with a deferred constraint trigger `<t>_audit_required` (`p2_audit_required`, 0010 and 0120) refuses at COMMIT any inserted or updated row that has no `audit_event` with `record_type = '<t>'`, `record_id = NEW.id` and (when the table has `version`) `new_version = NEW.version`. After the import, L8 re-enables these triggers. So on a target in use, every added or changed row of such a table has its audit event, and that event names the actor. Rows that **no** journalled actor caused remain unexplained.

**Format `mth-recheck-allowance/2`.** `/1` is refused, because it was never built (BE-R1 gap 2).

```json
{
  "schemaVersion": "mth-recheck-allowance/2",
  "actors": ["<app_user id>"],
  "tables": [{ "name": "transformation", "added": [["<pk text>"]], "changed": [] }],
  "audited": [{ "name": "gate_instance", "mustInclude": { "added": [], "changed": [["<pk text>"]] } }],
  "children": [{ "name": "<child table>", "parent": "<parent table>", "fkey": "<constraint name>" }],
  "operational": ["job_run"]
}
```

All six keys are required. Arrays may be empty. The rules are:

1. **`tables`**, `operational`, `audit_event` and `user_identity`: as A1.9 rules 1–5, unchanged.
2. **`actors`:** the `app_user` ids of the users who acted in the drill. The drill resolves them on T from its journalled sign-ins by (issuer, subject), never from "new rows". Each id must exist on T, else exit 2. `actors` must be non-empty when `audited` is non-empty.
3. **`audited` entry `t`** (delta basis `audit_explained`):
   - Validation (exit 2 on failure): `t` has an enabled trigger `<t>_audit_required`; its primary key is exactly `(id uuid)`; it is not `audit_event` or `user_identity`; and it does not appear in `tables`, `children` or `operational`.
   - **Explaining events.** `E` is the set of `audit_event` rows with:
     - `seq > audit_baseline_seq_max` of the latest `migration_import`;
     - `source IN ('api', 'worker')`;
     - `actor_user_id = ANY(actors) OR on_behalf_of_user_id = ANY(actors)`.
   - **Each added or changed row** `r` of `t`, compared row by row against the package as in A1.9, must have an event in `E` with `record_type = 't'` and `record_id = r.id`. When `t` has a `version` column, the event's `new_version` must equal `r.version`. Otherwise `r` is **unexplained**.
   - **No row may be missing** (ADR-0003).
   - **`mustInclude`:** the journalled keys returned by the API for `t` must be a subset of the explained added or changed keys, respectively. Missing ones are listed as `expected but not`.
   - `allowed` is true only if nothing is unexplained, missing or absent from `mustInclude`.
4. **`children` entry `c`** (basis `child_of`):
   - Validation (exit 2): `fkey` is a foreign key constraint from `c` to `parent`; `c` has **no** `_audit_required` trigger (an audited table belongs in `audited`); `parent` appears in `tables`, `audited` or `children` of the same file; the `children` graph has no cycle; and `c` is not in `operational` or `tables`.
   - **Each added or changed row** of `c` must reference, through the columns of `fkey`, a key of `parent` that is in this run's **explained** added or changed set of `parent`. Parents are resolved first, in topological order. A NULL reference, or a reference to an unchanged or unexplained parent row, is unexplained.
   - No row may be missing.
5. **Never in `operational`** stays as A1.9 rule 6. Tables named there **may** appear in `tables`, `audited` or `children`, because all three are key-by-key.
6. **Additional allowance refusals** (exit 2, `reconcile-migration: refused: invalid allowance file: <reason>`):
   - `unsupported schema version '<v>'`;
   - `missing key '<k>'`;
   - `unknown actor <id>`;
   - `audited table <t> has no enabled <t>_audit_required trigger`;
   - `audited table <t> has a primary key other than (id)`;
   - `child table <c> has an _audit_required trigger; list it under audited`;
   - `<fkey> is not a foreign key from <c> to <parent>`;
   - `parent <p> of <c> is not listed in tables, audited or children`;
   - `children form a cycle at <c>`;
   - `<t> is listed more than once`;
   - `actors is empty but audited is not`.

**Output** (adds to C.12). For a disallowed `audited` or `children` table, the per-table line `  <table>: <a> added, <c> changed, <m> missing (<basis>)` is followed by at most 20 lines `    unexplained <added|changed> <key>` and at most 20 lines `    expected but not <added|changed> <key>`. Each delta row stores its counts. The JSON report also gives, per `audited` table, the number of explaining events.

**What this proves, and what it does not.** Mode 2 now proves the following for every changed table:

- each changed row is either named by an API response, caused by an audited mutation of a journalled actor, or a foreign-key child of such a row;
- nothing else changed outside the fixed operational list.

It does not prove that the drill's actors made only the intended changes. A1.11 residual 3 stands. A reviewer reads the actors and the allowance.

### A2.7 Exact texts (add to C.12; existing lines stay)

| Command | Exit | Line |
| --- | --- | --- |
| `import-migration` | 1 | `import-migration: failed: <n> carried audit events share their id with a target audit event but are not the same event; nothing was imported` then, for at most 20 of them, `import-migration: <id>: differs in <col>[, <col>…]` or `import-migration: <id>: not a migration baseline event on the <source\|target>` |
| `import-migration` | 1 | `import-migration: failed: audit_event loaded <n> rows, expected <e>` |
| `import-migration` | 0 | the A2.2 `already present` line, after the audit-history line, when `\|P\| > 0` |
| `reconcile-migration` | 4 | the C.5 mismatch line, then `  audit_event: the reconstructed carried trail does not match the manifest (<n> rows, digest <d>)` when A2.3 fails |

These replace BE-R1's provisional exit-1 line (`… ADR-0064 Amendment 1 does not provide for this …`). `<col>` names are database column names in attribute order.

### A2.8 DO-D2 gap 1: the register snapshot and rule R2

**Measured** (`docs/delivery/handbacks/DG7/T-DG7-ARCH-R3-evidence/register-t1-scan.log`): `scanLine` with target T1 over every field of the 412 register rows finds exactly two hits, both R2:

- REQ-DLV-006, column `procedure`: `the runner creates /var/tmp/mth-run.XXXXXX (mode 700)`;
- REQ-DLV-023, column `notes`: `the agent-writable $TMPDIR (/tmp/claude-0)`.

| Option | Verdict |
| --- | --- |
| (a) The snapshot builder neutralises absolute paths | **Rejected.** ADR-0071 §2.2 and T-I1 require every field verbatim, and `getRequirement` returns "every column verbatim". A silent rewrite would make the in-app register differ from the file. It would also hide from the scanner exactly what the scanner is for. |
| (b) An R2 allow-list entry (T1, `file` + `sha256`) | **Rejected.** ADR-0062 §8 permits it, because R2 is not in the never-allow set. But the snapshot's SHA-256 changes with every register edit, so the entry goes stale (and fails the scan) at every edit until someone recomputes it, right up to the freeze. A host- or path-wide entry would weaken R2 for all first-party output. |
| **(c) Reword the two fields at the source, and fail early on any recurrence** | **Chosen.** |

**Decision:**

1. **The register text.** The requirements-analyst (the register's owner; an orchestrator assignment) replaces exactly:
   - in REQ-DLV-006, `the runner creates /var/tmp/mth-run.XXXXXX (mode 700)` with `the runner creates mth-run.XXXXXX under /var/tmp (mode 700)`;
   - in REQ-DLV-023, `the agent-writable $TMPDIR (/tmp/claude-0)` with `the agent-writable $TMPDIR (claude-0 under /tmp)`.

   The meaning is unchanged. Measured in memory: after these two replacements, T1 hits = 0 (`register-t1-scan-reworded.log`). No other byte of the register changes.
2. **The early guard (BE-R2, T-R16).** `apps/api/scripts/register-snapshot.test.mjs` builds the snapshot from the tree's register and runs `scanLine` (imported read-only from `tools/release/scan-assets.mjs`) with target T1 over every field:
   - zero R1, R2, R3, R5 and R6 hits are allowed;
   - every R4 hit must match a T1 `host` entry of `tools/release/asset-scan-allowlist.json`.

   A register edit that reintroduces a build-host path then fails `pnpm test` with the row id, the column and the rule, long before an archive build. `register-snapshot.mjs` itself stays verbatim and unchanged.
3. ADR-0062 §8 and ADR-0071 §2 are unchanged.

### A2.9 DG1 audit guarantees (A1.10 re-checked for this amendment)

| Guarantee | How it holds |
| --- | --- |
| `audit_event_immutable` and `_truncate` stay enabled | E4 at L1, L3 and L8 and at every recheck, as before. E5 reads `audit_event` and never writes it. |
| no UPDATE, DELETE or TRUNCATE of the trail | E5 and the reconstruction are SELECTs. The `P` rows are **not inserted**, so nothing is overwritten. L4 still excludes `audit_event` by name. |
| append-only, events in the mutation's transaction | The only new rows are the import's own L12 events, in the import transaction. `auditAlreadyPresent` is inside one of them. |
| one total order (`seq` unique) | Unchanged. No `seq` is reassigned. The source position of each `P` event is preserved as data and proven by the digest. |
| `mth_app` INSERT and SELECT only | Unchanged. 0150 changes no `audit_event` grant. The recheck and the import stay owner CLI only. |
| no ordinary user modification | Unchanged. The allowance only reads the trail. |

D-259's escalation condition ("Amendment 2 cannot keep the DG1 audit guarantees") is **not** met.

### A2.10 Residuals of this amendment

1. **T-C8's "including `seq`" holds for the `rowCount − |P|` inserted rows.** For the `|P|` shared migration events, the target row carries the target's `seq` and `occurred_at`. The source values are recorded in `migration.imported` and proven by the digest. This is a real narrowing of D-243 Q4's "verbatim", disclosed here. The orchestrator records it.
2. **E5's identity test is content equality of 13 columns.** A source whose shared-id migration event was written with different content (for example a different `reason`) is refused, not merged. That is intended: such a source did not run the same migration.
3. **`audit_explained` trusts the drill's actor list.** A journalled actor's unrelated edit in an audited table would be accepted. The JSON report lists every explaining event's action for review.
4. **`child_of` accepts any number of children under an explained parent.** It cannot see whether they were written in the same transaction, because the database stores no transaction id per row.
5. **The register rewording needs an analyst assignment** before BE-R2's T-R16 can pass. Until then T-R16 fails, by design, and names the two rows.

## Amendment 3 (2026-11-13, T-DG7-ARCH-R4): mode 2 explanations for worker automation rows and for code counters, the D8 gate chain, and the A2.1 column counts

- **Author:** solution-architect (T-DG7-ARCH-R4). Base `cbf26ddb40a402f2ea1873eb665b5d8d32f7ec42` on `claude/mobily-transformation-platform-dg6-regate`.
- **Why.** D-260 records three open items after repair round 2. DO-D3 measured them in T-B17 (`docs/delivery/handbacks/DG7/T-DG7-DO-D3-evidence/t-b17-measurement-mode2.txt`). BE-R2 raised one arithmetic question. This amendment decides all four:
  1. **DO-D3 Q2a, automation rows.** `createTransformation` makes the worker write one `automation_execution` row and one `automation_action_result` row. Their audit events have `actor_type = 'service'`, `actor_user_id` NULL and `on_behalf_of_user_id` NULL (`apps/worker/src/kit.ts` `jobActor`). So A2.6's explaining set `E` contains none of them, and mode 2 calls both rows `unexplained`.
  2. **DO-D3 Q2b, counters.** `record_code_counter` `(transformation_id, prefix)` moved for the carried transformation when D8 created a RAID issue. The row has no `id` and no audit trigger. Its only foreign key points at the unchanged carried `transformation`. So no A2.6 basis can explain it.
  3. **DO-D3 Q3, D8 gate chain.** On the demo transformation, G1–G4 are `approved`. G5 is `draft`, and `submitGate` refuses it: `422 gate_criteria_incomplete: "Mandatory required outputs are incomplete: Performance evidence, Adoption, Decision log."`.
  4. **BE-R2 Q1.** `audit_event` has 17 columns. A2.1 lists the right 15 compared names but calls them "13", and it calls the total "15".
- **What this amendment replaces.** It replaces:
  - A2.6's definition of the explaining set `E`, which is extended (A3.2);
  - A2.6's format `mth-recheck-allowance/2`, which becomes `/3` with one more key (A3.4);
  - the counts in A2.1, A2.2 L1, A2.10 residual 2 and C.13, which are corrected (A3.7);
  - B.7 DO-D3's D8 step (b), which becomes the A3.6 chain.

  Everything else in this ADR and in Amendments 1 and 2 stands unchanged. Nothing is loosened: every rule of A1.9 and A2.6 still applies, and each new explanation is key by key and rooted in a journalled actor's audited mutation.
- **Hard constraints (D-258, D-259, D-260).** They are unchanged:
  - `audit_event` stays append-only, and both of its triggers stay enabled;
  - nothing truncates, deletes from or updates it;
  - no source audit event is lost, altered or re-attributed;
  - mode 2 never explains a row by "whatever is new" and never by putting a table in `operational`.

  D-260's escalation condition is "Amendment 3 needs to loosen the allowance beyond what the drill's journal explains". A3.8 shows that it is **not** met. A3.9 names the one case that would meet it (scheduled automation) and keeps that case unexplained.
- **Two gate systems.** Nothing in this amendment grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes DG0–DG7. Every D8 write, including the G5 submission and its decision, is SYNTHETIC drill data on a disposable target. It approves nothing real.

### A3.1 Automation rows: the facts that decide it

The facts below were read in the code at the base revision.

- **The measured row comes from a seeded starter.** It is not an ADMIN rule. `starter.transformation_created` (0075) has `run_as = 'service'`. The starter wrapper (`apps/worker/src/automation/starters.ts`, l.212) writes `initiating_user_id: null`. CHECK `automation_execution_identity` makes `initiating_user_id` non-NULL only for `run_as = 'initiating_user'`. **So for the row DO-D3 measured, `initiating_user_id` is NULL.** A rule over `initiating_user_id` alone, as D-260 worded it, would not explain it. The G5 chain (A3.6) adds `gate.submitted` and `gate.decided` starters, whose catalogue `initiating_user_field` is NULL as well.
- **The trigger link is recorded, immutably.**
  - `automation_execution.trigger_key` is the envelope's `idempotencyKey`, and `trigger_code` is its `eventType` (`starters.ts` l.126–138, `engine.ts`).
  - The relay copies `idempotencyKey` from `outbox_event.idempotency_key` (`apps/worker/src/relay.ts` l.78).
  - `automation_execution_guard` (0074) refuses any later change of `trigger_code`, `trigger_key`, `trigger_payload`, `run_as` and `initiating_user_id`.
- **The outbox row is written in the transaction of the mutation that raised it.** Examples:
  - `createTransformation` writes aggregate `transformation` (`routes.ts` l.298);
  - `submitGate` and `decideGate` write aggregate `gate_instance` (`gates.ts` `enqueueGateEvent`).

  `outbox_event.created_at` and `audit_event.occurred_at` both default to `now()`, PostgreSQL's transaction timestamp. Neither insert path sets them (`packages/db/src/audit.ts`, `apps/api/src/modules/jobs/outbox.ts`, `gates.ts`). So the mutation's audit event and its outbox row carry the **same** timestamp.
- **The worker's own writes carry the job.** Every worker audit event has `request_id = 'job:<pg-boss job id>'` (`jobActor`). A starter wrapper and the handler it wraps run in the same job, so they write under the same `request_id`. The engine (queue `automation.evaluate`) writes its executions and their actions' effects in its own job, again under one `request_id`. That includes the execution, the action result and the handler's outputs, such as a gate routing's approval rows.
- **`outbox_event` is exported and listed as operational.** Mode 2 still reads its live rows. Being operational only means its own differences are counted rather than explained (A1.9 rule 4). Nothing stops a rule from reading it as evidence.

### A3.2 Automation rows: options weighed and the rule

| Option | Verdict |
| --- | --- |
| (a) D-260 literally: explain a service row when `automation_execution.initiating_user_id` is a journalled actor | **Improved, not adopted alone.** It is correct where it applies, and it is kept as a cross-check. But it is NULL for every seeded starter (A3.1), which covers every measured row. |
| (b) Write `on_behalf_of_user_id` on the worker's events (DO-D3 Q2a option 1) | **Rejected.** It changes product attribution to fit a test. Starters run as the service identity by design (D-142 Q3; ADR-0044 §1). Saying "on behalf of" a user who did not ask for it would misstate the trail. It would also change 0074-era behaviour that DG5/DG6 approved. |
| (c) Put `automation_execution` and `automation_action_result` in `operational` | **Rejected.** That is "ignore the table" (A2.6), and the handler's outputs (for example approval rows) would still be unexplained. |
| (d) Accept any `source = 'worker'` event after the import | **Rejected.** That is "whatever is new": a scheduled job would explain itself. |
| **(e) Chained explanation through recorded links** | **Chosen.** An automation execution is explained only when its trigger is an outbox event written **in the same transaction** as an already explained audit event. Its job's service events then join the explaining set. This repeats until nothing changes. Every link is a recorded column. |

**The rule (extends A2.6 rule 3).**

Let `B` be `audit_baseline_seq_max` of the latest `migration_import`, and `A` the allowance's `actors`.

1. **Start.** `E*` is `E` of A2.6, unchanged: events with `seq > B`, `source IN ('api', 'worker')`, and `actor_user_id` or `on_behalf_of_user_id` in `A`.
2. **Explained trigger.** An `outbox_event` row `o` is *explained by `E*`* when all of the following hold:
   - `o` is added (its key is not in the package);
   - `E*` has an event `e` with `e.record_type = o.aggregate_type`, `e.record_id = o.aggregate_id`, `e.organization_id = o.organization_id` and `e.occurred_at = o.created_at`.

   The equal timestamp places `e` in the transaction that wrote `o`. The equal record places it on the aggregate the event is about. Both must hold.
3. **Explained execution.** A row `x` of `automation_execution` (added, or changed by a retry) is *chain-explained* when all of the following hold:
   - `automation_trigger.trigger_kind` of `x.trigger_code` is `event`;
   - exactly one explained `o` has `o.idempotency_key = x.trigger_key` and `o.event_type = x.trigger_code`;
   - the execution's recorded user, if it has one, is in `A`. The recorded user is `x.initiating_user_id` when it is non-NULL. Otherwise it is `x.trigger_payload ->> f`, where `f` is `automation_trigger.initiating_user_field` of `x.trigger_code`, when `f` is non-NULL. For `transformation.created`, `f` is `createdBy`. This is option (a) as a cross-check: a journalled link with a foreign recorded user is **not** explained.

   A schedule or request trigger is never chain-explained by this rule (A3.9). Request starters are written in the API transaction by the user, so A2.6 already explains them.
4. **The job's events join `E*`.** `R(x)` is the set of `request_id` values of the events with all of the following:
   - `seq > B`;
   - `source = 'worker'` and `actor_type = 'service'`;
   - `record_type = 'automation_execution'` and `record_id = x.id`.

   Every value must match `^job:.+$`, else `x` is not chain-explained. Then every event with `seq > B`, `source = 'worker'`, `actor_type = 'service'` and `request_id ∈ R(x)` joins `E*`, provided that its `on_behalf_of_user_id` is NULL or in `A`.
5. **Fixed point.** Steps 2–4 repeat until `E*` stops growing. This covers chains where a worker job writes an outbox row (in its own transaction, with its own service event on the aggregate) that triggers the next execution. Every step adds at least one execution, so the number of rounds is at most the number of added executions.
6. **Use.** A2.6 rule 3 is evaluated with `E*` in place of `E`, for every `audited` table, with no other change. Rows of `automation_execution` and `automation_action_result` are then explained like any other audited row: by an event in `E*` on their own `id`, and at their `version` where the table has one. No new basis value is written; such rows count under `audit_explained`.

**What the allowance file says.** Nothing new. `automation_execution` and `automation_action_result` are listed in `audited`, as DO-D3 already does. No schema change and no new allowance key are needed for automation.

**Report (adds to A2.6 "Output").** The JSON report gives, per `audited` table, `explainingEventsByActor` (from `E`) and `explainingEventsByAutomation` (from `E* \ E`). It also gives a list `automationChain` of `{executionId, triggerCode, triggerKey, outboxEventId, linkEventId, linkRecordType, linkRecordId, requestIds[]}`, sorted by `executionId`. Here `linkEventId` is the `e` of step 2. No console line changes, and an unexplained row keeps its `    unexplained added <key>` line.

### A3.3 Counters: options weighed and the rule

`record_code_counter (transformation_id, prefix, last_value)` is written only by `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING last_value`, inside the transaction that inserts the coded row. The format is `<prefix>-<n padded to 2>`. Examples are `apps/api/src/modules/workflows/codes.ts`, `raid/register.ts` `nextRaidCode` and `apps/worker/src/handlers/escalations.ts` `nextDecisionCode`. The coded tables hold `(transformation_id, code)` unique (for example `raid_entry_code_key`, `decision_code_key`).

| Option | Verdict |
| --- | --- |
| (a) `operational` (DO-D3 Q2b option 1) | **Rejected.** That is "ignore the table". A counter moved with no new coded row would pass. |
| (b) `children` of `transformation` | **Rejected.** A2.6 rule 4 needs an explained parent, and the carried transformation is unchanged. Loosening rule 4 would loosen it for every child. |
| (c) An `exact_ids` entry for the counter key | **Rejected as the only rule.** It names the key but cannot check the value: a counter moved by 5 for one new row would pass. |
| **(d) A "counter" basis: the counter may move only by exactly the new coded rows explained in its scope** | **Chosen** |

**The rule (new A2.6 rule 4a, basis `counter`).**

1. **The constant.** `RECHECK_COUNTER_TABLES` in `packages/db/src/transfer/recheck.ts` maps each counter table to its scope:

   ```ts
   { name: "record_code_counter", scope: "transformation_id", prefixColumn: "prefix", valueColumn: "last_value",
     prefixes: { R: { table: "raid_entry", code: "code" }, A: …, I: …, D: { table: "decision", code: "code" }, GD: …, DEC: …, DEP: { table: "dependency", code: "code" }, … } }
   ```

   - BE-R3 fills `prefixes` by reading each call site of the counter (A3.10 lists them). An entry exists only for a prefix whose coded table and column BE-R3 verified at the call site.
   - Under the 0055 CHECK, every prefix is either mapped or listed in `unmapped`. A test pins that the two sets together equal the CHECK's 24 prefixes, so a new prefix fails the test.
   - Any change to a counter row of an unmapped prefix is unexplained.
   - Adding a counter table or a prefix mapping needs the architect, as for `RECHECK_OPERATIONAL_TABLES`.
2. **The allowance.** The allowance names counter tables in the new key `counters` (A3.4). A counter table may not appear in `tables`, `audited`, `children` or `operational`.
3. **Order.** Counters are checked **after** `tables`, `audited` (with `E*`) and `children` are resolved, because they count rows those sets explained.
4. **Each counter row.** For each counter row `c` that is added or changed, with prefix `p`:
   - Let `old` be the package's `last_value` (0 when `c` is added), and `new` the live value.
   - Let `N` be the set of rows of the mapped table that are **explained added** in this run (explained under `tables`, `audited` or `children`), with `scope = c.transformation_id` and the code column matching `^<p>-([0-9]{2,6})$`. The prefix is matched exactly, so `D-` never matches `DEC-` or `DEP-`.
   - `c` is explained only if `new > old` **and** the multiset of numbers parsed from `N`'s codes equals exactly `{old + 1, …, new}`. Each number appears once, with none missing and none extra.
   - Otherwise `c` is unexplained, and the report line gives `counter <key>: moved <old> -> <new>, <|N|> new coded rows (<numbers>)`.
5. **The inverse check.** For each mapped prefix and scope where `N` is non-empty but the counter row is unchanged, the counter row is reported unexplained with the same line. New coded rows that did not move the counter are inconsistent.
6. **No row may be missing** (ADR-0003). A counter row present in the package and absent live is unexplained.
7. **Delta row.** Basis `counter`, with `rows_added` and `rows_changed` the counts of added and changed counter rows. `allowed` is false if any row is unexplained.

**Why this is strict.** The value is checked, not only the key. Each step of the counter must match one explained coded row, in its own transformation, with its exact number. A stray increment, a skipped number, a counter moved by an unexplained row, or a coded row without its increment all fail.

### A3.4 Format `mth-recheck-allowance/3`

`/3` is `/2` with one more required key, `counters`. It is an array of names from `RECHECK_COUNTER_TABLES`, and it may be empty. `ALLOWANCE_SCHEMA_VERSION` becomes `"mth-recheck-allowance/3"`. `/2` and `/1` are refused with `unsupported schema version '<v>'`: `/2` does not carry `counters`, and only the drill writes allowance files.

```json
{
  "schemaVersion": "mth-recheck-allowance/3",
  "actors": ["<app_user id>"],
  "tables": [],
  "audited": [{ "name": "automation_execution", "mustInclude": { "added": [], "changed": [] } }],
  "children": [],
  "counters": ["record_code_counter"],
  "operational": ["job_run", "outbox_event"]
}
```

All seven keys are required. The additional refusals (exit 2, `reconcile-migration: refused: invalid allowance file: <reason>`) are:

- `counter table <t> is not in RECHECK_COUNTER_TABLES`;
- `<t> is listed more than once` (as before; it now also covers `counters`).

### A3.5 Schema and contract

The `counter` basis needs schema and contract changes. Automation needs none.

- **Migration `0151`** (BE-R3; the next free id above `0150`, D-245 O9) drops `migration_reconciliation_delta_basis_check` and re-adds it with ten values: the nine of A2.4 plus `counter`. The CHECK `migration_reconciliation_delta_unexplained` is unchanged. Nothing in 0151 touches `audit_event`, its triggers or its grants, and its header says so. `tools/release/migration-catalogue.mjs` classifies it as it finds it, with no override.
- **Contract (additive only).** `MigrationReconciliation.deltas[].basis` gains `counter`. No operation is added or removed, and `info.version` and the operation count are unchanged.

### A3.6 The D8 gate chain (DO-D3 Q3; replaces B.7 DO-D3's D8 step (b))

**Options weighed:**

| Option | Verdict |
| --- | --- |
| Change `seed-demo` so that a gate is submittable | **Rejected** (D-260). Shipped demo data stays as it is (ADR-0050 checksum). |
| Cover the missing criteria with a gate exception (`createGateException` + `decideGateException`) | **Rejected.** It waives outputs instead of completing them, and it adds a second business approval to the drill. |
| Submit a gate of a new transformation created in D8 | **Rejected.** G1 needs the whole Case for Change set, which is far more writes and still data-shaped. |
| **D8 completes the chosen gate's missing required outputs through the public API, then submits, and a different rebound approver decides** | **Chosen** |

**The actors.** These are rebound users chosen by `pick-actors.sql` from roles and grants, never from "new rows". Each signs in through the drill IdP, is journalled, and is listed in `actors`.

| Actor | Must hold | Must differ from |
| --- | --- | --- |
| `S` (submitter) | `gate.submit` on the transformation | `P` |
| `K` (KPI user) | `kpi_actual.submit`, and owner or steward of the KPI | `V` |
| `V` (KPI reviewer) | `kpi_actual.accept`, configured reviewer | `K` |
| `W` (evidence reviewer) | `evidence.review` | the evidence's creator (`S`) |
| `O` (decision owner) | `executive_decision.decide` on the T16 decision (its owner or an active delegate) | — |
| `P` (gate approver) | the gate's configured approver (user, or holder of its approver role with `gate.decide`) | `S` |
| `L` (only if a training remedy is needed) | `proficiency.record` | — |
| `X` (only if a risk remedy is needed) | `raid.edit` on the transformation | — |

One user may fill several rows when the "must differ" column allows it. A role that `pick-actors.sql` cannot fill from rebound users stops D8 before C0, with `D8 FAIL: no rebound user holds <permission>`. The table is only for the remedies the gate actually needs, so a role that no remedy needs is not required.

The gate is the lowest gate in `draft`, `changes_requested` or `deferred`, as `pick-actors.sql` already chooses. On the demo this is G5.

**The steps.** Every call goes through the public API with a session cookie and CSRF token, and sends `If-Match` where the operation requires it. Every request and response is journalled. Every key a response returns goes into the journal for `tables` and `mustInclude`.

| Step | Operation id(s) | Rule |
| --- | --- | --- |
| C0 | `getGate` (as `S`) | Read `criteria[]` and the ETag. If `canSubmit` is true, go to C3. |
| C1 | per missing item, the remedy below | For each mandatory criterion with `completeness = incomplete`, take each `missing[]` item by `code` and `pointer`, in order. A code without a row below stops D8: `D8 FAIL: no API remedy for <code> at <pointer>`. D8 never guesses and never writes outside this table. |
| C2 | `getGate` (as `S`) | Poll every 2 s, for at most 120 s, until `canSubmit` is true. Otherwise: `D8 FAIL: <gate> still incomplete: <criterion key>: <codes>`. |
| C3 | `submitGate` (as `S`, `If-Match` = the gate ETag) | Body `{"submissionNote": "SYNTHETIC transfer drill submission; approves nothing real"}`. Expect 201. Journal the submission id and `submissionNo`. |
| C4 | `getGate` (as `P`) | Poll every 2 s, for at most 120 s, until `canDecide` is true. The `gate.submitted` routing runs in the worker. |
| C5 | `decideGate` (as `P`) | Body `{"submissionNo": <n>, "outcome": "deferred", "rationale": "SYNTHETIC transfer drill decision; approves nothing real"}`. Expect 201. Journal the decision id. `deferred` is kept from DO-D3: it exercises `gate.decided` and its starter without enabling a next phase. |
| C6 | `getGateSubmission` (as `P`) | Read back the decision. Then wait for the worker as B.7 does, and longer (A3.10 DO-D4). |

**The remedies (C1).** Each is applied once per item. A refusal (any 4xx) stops D8 with `D8 FAIL: <operation id> HTTP <status> <code>`.

| Missing code (pointer) | Operation ids, in order | Notes |
| --- | --- | --- |
| `g5.performance_no_accepted_actual` (`/kpiDefinitions/{k}`) | `listTransformationReportingPeriods` → `listKpiActuals` → `submitKpiActual` **or** `addKpiActualValue` (+ `submitKpiActualDraft` when the actual is a draft) as `K` → `acceptKpiActual` as `V` | The latest open period. A ratio KPI sends `numerator` and `denominator` as decimal strings (DO-D3 finding 4). The worker's evaluation is awaited by C2's `getGate` poll, which is the gate's own judgement. When that poll times out on this KPI, D8 reads `getKpiStatus` once and puts its body in the failure line. D8 never edits KPI configuration. |
| `g5.performance_kpi_not_known` (`/kpiDefinitions/{k}`) | as the row above when the KPI has no accepted actual in the latest open period; otherwise nothing (C2 waits for the evaluation) | Stale or Unknown is never treated as met (ADR-0035 §10) |
| `g5.performance_pilot_evidence_missing` | `createEvidence` (as `S`; `kind: "note"`, `title` and `noteBody` start with `SYNTHETIC`) → `reviewEvidence` (as `W`; verified, accessible) → `listPhaseSteps` → `linkPhaseStepEvidence` (step key `transform.deliver_pilots`) | A note is accessible content, so it can be verified. No file bytes and no external URL. |
| `g5.adoption_indicator_unknown` (`/adoptionMetricLinks/{l}`) | `getAdoptionMetricLink`. If its `kpiDefinitionId` is set, the KPI remedy above for that KPI. If its source is `training_records`, `createTrainingRecord` (as `L`). | A source of `assessment_records` stops D8 with no remedy (see A3.9) |
| `g5.decision_log_empty` | `createExecutiveDecision` (as `O`; decision date = the business date + 14 days) | |
| `g5.decision_date_missing`, `g5.decision_overdue` (`/decisions/{d}`) | `getExecutiveDecision` → `recordExecutiveDecisionOutcome` (as `O`, `If-Match`; `{"outcome": "deferred", "deferUntil": <business date + 14 days>}`) | A deferral with a new date is the product's own remedy for an overdue ask. It decides nothing. |
| `g5.risk_open` (`/raidEntries/{r}`) | `getRaidEntry` → `closeRaidEntry` (as `X`, `If-Match`; closure note starts with `SYNTHETIC`) | Not measured on the demo. Listed so that the table is complete for G5. |
| `g5.performance_no_kpi`, `g5.adoption_none`, any `*_not_loaded` | — | Stops D8. These need configuration (outcomes, KPI definitions, metric links), which D8 does not create. |

A gate other than G5 is not expected on the demo. If `pick-actors.sql` chooses one, its codes are not in this table, and D8 stops at C1 with the exact code. A new remedy row needs the architect.

**What this changes in mode 2.** D8 now writes into more audited tables, for example `kpi_actual`, `evidence`, `phase_step_evidence`, `decision` and its executive rows, `gate_submission`, `gate_decision`, and the routing's approval rows (written by the worker). Each is explained by `E*`. `D8_TOUCHED_AUDITED`, `D8_TOUCHED_CHILDREN` and the new `D8_TOUCHED_COUNTERS` are **remeasured** by T-B17 on the full chain (C.14 / B.8). They are never copied from this list.

### A3.7 BE-R2 Q1: the column counts (corrections by amendment)

The catalogue gives 17 `audit_event` columns (0003 l.7–28, and BE-R2's catalogue pin). The rule of A2.1 is unchanged: compare every column except `seq` and `occurred_at`. Only the numbers were wrong. The text above stays as written, and these readings replace it:

| Where | Reads | Read as |
| --- | --- | --- |
| A2.1, third fact | "The other 13 columns … That makes 15 columns in total." | "The other **15** columns … That makes **17** columns in total." The list of 15 names is unchanged and complete. |
| A2.1, option (f) | "All 13 non-database-assigned columns" | "All **15**" |
| A2.2 L1 | "over the 13 columns of A2.1" | "over the **15** columns of A2.1" |
| A2.10 residual 2 | "content equality of 13 columns" | "content equality of **15** columns" |
| C.13 `import.ts` row | "the 13 columns of A2.1" | "the **15** columns of A2.1" |
| C.13 "What BE-R2 must know" | "The 13 compared columns … exactly 15 `audit_event` columns" | "The **15** compared columns … exactly **17** `audit_event` columns" |

BE-R2's code and test already do this. E5 compares the catalogue minus `seq` and `occurred_at`, and the pin is 15 + 2 = 17. Nothing is rebuilt.

**The measured shared-baseline count (A2.5, A2.10 residual 1).** BE-R2 measured `|P| = 45` on a real import of this release (`docs/delivery/handbacks/DG7/T-DG7-BE-R2-evidence/integration-be-r2.log`: `T-R13 measured |P| = 45`). A2.5's reading of the migrations gave 44. **45 is the recorded figure.** For 45 shared migration events, the target row carries the target's `seq` and `occurred_at`. The source values are in `migration.imported` and proven by the digest. This is the narrowing of C8's "including `seq`" that D-260 records. The difference of one between the reading and the measurement does not change any rule: E5 finds `P` by id and never uses a constant. It is not investigated further here.

### A3.8 DG1 audit guarantees and D-260's escalation condition

| Guarantee | How it holds |
| --- | --- |
| `audit_event_immutable` and `_truncate` stay enabled | Unchanged. A3.2 and A3.3 only SELECT. 0151 does not touch `audit_event`. |
| no UPDATE, DELETE or TRUNCATE of the trail | Unchanged. No write path is added. |
| no re-attribution | The worker's events keep `actor_type = 'service'`. Option (b), which would have re-attributed them, is rejected. |
| `mth_app` INSERT and SELECT only | Unchanged. The recheck stays owner CLI only. |

**Escalation test (D-260: "loosen the allowance beyond what the drill's journal explains").** Every row that A3.2 or A3.3 explains rests on a chain of recorded links that ends at an event in `E`, which is an audited mutation by a journalled actor:

- an execution: `trigger_key` → the outbox row → the same-transaction event on the same aggregate;
- a worker row: its event → its `request_id` → the job of an explained execution;
- a counter: the explained coded rows whose numbers it issued.

No table moves to `operational`, no key is taken from "what is new", and every A1.9 and A2.6 rule still holds. The condition is **not met**, and the orchestrator need not escalate.

### A3.9 Residuals of this amendment

1. **Scheduled automation stays unexplained.** An execution with a `schedule` trigger (for example `kpi.reporting_period_open`, the `*_scan` starters, the engine ticks) has no journalled cause. If one runs on T between the import and D9, its rows, and the rows its job writes, are `unexplained`, and mode 2 exits 4. Explaining them would mean explaining rows by the scheduler, not by the drill's journal, which is D-260's escalation case. So:
   - DO-D4 reports any such row as a FAIL with its key and trigger code;
   - DO-D4 never pauses, disables or reschedules a job to avoid it, because that would also change `job_schedule`, which B.6 job-check pins;
   - the orchestrator decides.

   T-B17 measured none in its window (DO-D3 handback finding 3).
2. **The same-transaction link is a timestamp equality.** PostgreSQL stores no transaction id per row. Two transactions that start in the same microsecond, write an outbox row and an explained event on the **same aggregate**, would be indistinguishable. Both events would still be on that record, so the record touched is right either way.
3. **`E*` trusts the actors' causes.** A journalled actor's mutation that triggers a starter makes the starter's outputs explained, whatever they are. That is the product's designed behaviour. The JSON report's `automationChain` lets a reviewer read every chain.
4. **The counter rule depends on the call-site map.** An unmapped prefix is always unexplained, so the map can only be too strict, never too loose.
5. **Assessment-fed adoption indicators have no D8 remedy.** If the demo's G5 needs one, D8 stops with the code. The demo measured only "Adoption"; DO-D4 records which item.
6. **G5 completion depends on the worker's KPI evaluation.** A KPI that evaluates to anything other than `ok` with a fresh accepted actual (for example `not_computable` for a missing trajectory) stops D8. D8 does not change configuration to force it.

### A3.10 Who builds it

- **BE-R3 (C.14):**
  - A3.2, A3.3, A3.4 and A3.5 in `recheck.ts` and `reconcile.ts`;
  - migration 0151 and the contract;
  - the `mth-db` stdout drain (DO-D3 Q1);
  - the tests.
  - The call sites to map are those of `record_code_counter` in `apps/api/src/modules/**` and `apps/worker/src/handlers/{adoption,escalations}.ts`, found by `grep -rn record_code_counter`.
- **DO-D4 (B.8):**
  - the A3.6 chain in `journey.mjs` and `pick-actors.sql`;
  - allowance `/3` with `counters`;
  - the remeasured `D8_TOUCHED_*` lists;
  - T-B17 and T-B11 to the end.

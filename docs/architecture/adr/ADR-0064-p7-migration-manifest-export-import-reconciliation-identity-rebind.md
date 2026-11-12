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

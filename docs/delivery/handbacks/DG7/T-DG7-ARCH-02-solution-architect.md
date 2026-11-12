# Handback T-DG7-ARCH-02: slices C + D (solution-architect)

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** I read `eff0733d548a21141ad85669bd54cfa2b30d1513` with `git rev-parse HEAD` at the start. During the run, HEAD became `9f161c651883bc2e482a2cf602024fbbacbf759c`: the orchestrator's commit "record the interrupted T-DG7-ARCH-02 run". It changes no file I read or wrote. My work sits on `9f161c65`, uncommitted.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-02-solution-architect-20261112T132647Z-51682921","session_id":"51682921-6542-4396-8e8c-45e1913a4498"}`. The assignment file's SHA-256 was `a7c2a95b…44a`, as given.
- **Time:** start `date -u` 13:26:57 UTC, end 14:56:08 UTC (89 minutes). The full integration suite ran in the background from 14:15 to 14:51.
- **`--historical` (start):** `node tools/gates/validate.mjs --historical --stage DG6` printed `PASS gate DG6 (historical)` and exited 0 (checked with `echo EXIT=$?` on a plain run). The re-run at the end is in §3.9.

## 0. Summary

**ADR-0064 (migration manifest):**

- **The package:** `manifest.json` (`schemaVersion` `mth-migration/1`), `attachments.json`, `tables/<t>.ndjson` and content-addressed `attachments/<sha256>`.
- **D-244 O2 is settled with DO-A's names, so no repair is needed:**
  - the environment marker is `sourceEnvironment`, with values `demo`, `production` or `unmarked`, read from `deployment_environment`;
  - `demoChecksum` carries the ADR-0050 `datasetChecksum()` for a demo source only. 0133 enforces this rule on `migration_export`.
- **Table order is catalogue-driven** from the FK graph. A cycle is broken only on a nullable column (`deferredColumns`), and the plan fails otherwise.
- **Every value is its PostgreSQL text output.** Decimals are exact strings, never JSON numbers.
- **What is excluded (14 tables), in `transfer_table_rule`:**
  - sessions, OIDC state, the replay cache, telemetry and the derived search index;
  - `schema_migration` (compared, not loaded);
  - the installation's own transfer tables.
- **SecretRef columns (15), in `transfer_column_rule`:** each is rewritten to provider `unbound` and must be re-bound by IT.
- **Import (D-243 Q4):** CLI-only, owner role, into an empty target at the same release and migration level.
  - It disables user triggers on every table **except** `audit_event`, which is never truncated and whose triggers stay enabled.
  - `audit_event` loads verbatim, including `seq`.
  - Per-table counts and content digests, attachment SHA-256 and the demo checksum are reconciled. Any mismatch rolls the whole import back.
  - One `migration.imported` event is appended.
- **Identity rebind (D-243 Q5):**
  - every imported user gets an `unbound` hold and cannot sign in;
  - `mth-db rebind-identity` applies an IT mapping file all-or-nothing and audits it.

**ADR-0065 (configuration bundle):**

- 12 kinds and `bundleSchemaVersion` `mth-config-bundle/1`. Unknown versions are rejected with 422 `config_bundle.schema_version_unsupported` and nothing is stored.
- The import runs as upload, then validate (plan), then commit:
  - the 7 kinds with drafts land as drafts and go through the existing review and publish pipeline;
  - the 5 kinds without a draft stage are applied through their own write path. Job schedules always arrive disabled.
- "Behaves identically" is proven by content hashes plus the A06 replay.

**Also delivered:**

- **Migrations** 0133–0135, written from the low end of my range.
- **Kysely types and catalogue pins.**
- **A guard probe** on real PostgreSQL 16.15: 11 tests.
- **Permissions:** `P7_PERMISSIONS`, with 4 codes.
- **Contract:** 19 OpenAPI operations, with `p7-pending` lists for BE-C, BE-D and BE-F.
- **Advisory locks** 730402–730405, with 730406–730409 reserved.
- **ERD, data-dictionary and permissions-matrix sections.**
- **`p7-work-split.md` §C and §D.**

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | **new.** Slice C ADR (REQ-S19-014, S19-016) |
| `docs/architecture/adr/ADR-0065-p7-configuration-transfer-bundle-schema-version-drafts-publish-pipeline.md` | **new.** Slice D ADR (REQ-S19-008) |
| `packages/db/migrations/0133_p7_transfer_migration_manifest.sql` | **new.** Rule catalogues (14 table rules, 15 column rules), `migration_export`, `migration_import`, `migration_reconciliation` (+ `_table`, `_attachment`), `identity_binding_hold`, `identity_rebind_event`; guards and grants |
| `packages/db/migrations/0134_p7_config_bundles.sql` | **new.** `config_bundle_export`, `config_bundle_import`, `config_bundle_import_item`, `config_bundle_import_commit`; guards and grants |
| `packages/db/migrations/0135_p7_transfer_permissions.sql` | **new.** 4 permission codes, 8 role links |
| `packages/db/test/integration/p7-transfer-guards.test.ts` | **new.** Guard probe (11 tests): state machines, column grants, CLI-only writes, the audit rule, the D-244 O2 checksum rule, unknown bundle version |
| `packages/db/src/schema.ts` | 13 table interfaces, `Database` entries, `*Row` types, `SCHEMA_COLUMNS` entries (additive only; `git diff` shows 0 deleted lines) |
| `packages/db/test/integration/catalogue.test.ts` | the 0133–0134 trigger pin; the "every SecretRef column has a rule / exclusions are ADR-0064 §3's" test; 3 mutable tables; 13 privilege pins |
| `packages/db/src/seed.test.ts` | the 0135 parity block (3 tests); the P7 migration ceiling 0163 and the free-id example 0136 |
| `packages/shared/src/permissions.ts` | `P7_TRANSFER_PERMISSIONS`, `P7_PERMISSIONS`, `P7_TRANSFER_ROLE_PERMISSIONS`; `PERMISSIONS` and `ROLES` (AUD, ADM_TECH, ADM_ACCESS, ADM_METHOD) extended |
| `docs/api/openapi.yaml` | `info.version` 1.6.0-p7; tag `transfer`; 19 operations; 5 path parameters; 25 schemas; 4 `PermissionCode` values |
| `apps/api/test/support/p7-operations.ts`, `p7-pending.ts`, `p7-pending-arch-02.ts`, `p7-pending-be-c.ts`, `p7-pending-be-d.ts`, `p7-pending-be-f.ts` | **new.** The P7 operation set and the pending lists (5 + 5 + 9) |
| `apps/api/test/support/p2-pending.ts` | includes `P7_PENDING_OPERATIONS` |
| `apps/api/test/integration/aud-write-deny.test.ts`, `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts` | exclude `P7_OPERATION_IDS` from the P2-scoped sweeps (as for P3–P6) |
| `apps/api/test/integration/contract/contract.test.ts` | operation count pin 932 → 951 |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | +4 lines: the sweep skips operations in `P2_PENDING_OPERATIONS`. This is the rule every `pN-pending.ts` states ("excludes ONLY these from … the live sweeps"); the sweep was written after the P6 lists were empty, so it never needed it before (§3.7) |
| `apps/api/test/support/sensitive-reference-inventory.ts` | 2 rows: `migration_import.source_export_reference`, `config_bundle_import_commit.target_record_id` (both `cannot-name`) |
| `apps/api/src/modules/platform/advisory-locks.ts` (+ `.test.ts`) | 730402–730405 registered; the test's "no spelled number" regex covers 730400–730439 |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry rows 730402–730409 and the P7 allocation sentence |
| `docs/architecture/p7-work-split.md` | **§C and §D appended**. §1, §2, §A and §G untouched |
| `docs/architecture/erd.md` | §1ac (diagram and entity register) |
| `docs/architecture/data-dictionary.md` | "P7 tables, slices C and D", generated from a migrated catalogue, plus the 4 P7 functions |
| `docs/analysis/permissions-matrix.md` | §30 |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-02-evidence/*` | logs, the dictionary generator and its output, migration SHA-256 |

## 2. Behaviour delivered, per requirement

These are architecture deliverables only. No route, job, CLI command or screen exists yet, and every row stays SPECIFIED until the implementers land. The pending lists make every unrouted operation visible to the contract test.

- **REQ-S19-014:** what is delivered:
  - the manifest and attachment-manifest format;
  - the reconciliation design: per-table counts and digests, attachment size and SHA-256, the demo checksum, and rollback on mismatch;
  - the report tables (0133) and the read-only report operations;
  - §C tests T-C8, T-C11, T-C14, T-C16, and the clause map C.10.
- **REQ-S19-016:** what is delivered:
  - ids, links, audit history and evidence checksums are preserved (ADR-0064 §2, §5, §6);
  - the credential exclusion and its package scan (§3, §4; T-C5, T-C9);
  - the identity rebind (§8; T-C15);
  - the export operations;
  - the catalogue test that fails on any unclassified SecretRef column.
- **REQ-S19-008:** what is delivered:
  - the bundle format and kinds;
  - the unknown-version rejection, which the contract shape and the DB `CHECK` both enforce (the probe proves the DB half);
  - drafts through the pipeline;
  - the 9 operations and the D.6 clause map.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm via `pnpm`, offline. PostgreSQL 16.15 disposable clusters through `tests/qa/support/with-pg.sh` (ports 24721 and 24801). The locale was unset (`LC_ALL= LANG=`) for the unit and integration runs.

### 3.1 Historical validator (start)

```text
$ node tools/gates/validate.mjs --historical --stage DG6
PASS gate DG6 (historical)
EXIT=0
```

### 3.2 Migrations apply

- **First run: exit 1.** I ran `with-pg.sh npx vitest run --project integration packages/db/test/integration/migrate.test.ts`, and it failed in global setup: `migration 0135_p7_transfer_permissions.sql failed: … violates check constraint "permission_code_check"`.
  - Cause: the plan's code `migration.import_status.read` has two dots.
  - Fix: I renamed the code to `migration_import.read` (O1).
- **Re-run: exit 0.** "applied 125 migrations to a fresh database", 9/9 passed.

### 3.3 DB integration: guard probe, catalogue, protection, migrate

- **Run 1: 7 failed.** The probe's audit action `test.p7_probe` broke `audit_event_action_check`, because the action pattern allows no digit. I changed it to `test.transfer_probe`.
- **Run 2: 1 failed.** My expected exclusion list was mis-sorted.
- **Run 3: 1 failed** with `collations are not supported by type integer`. My `ORDER BY 1 COLLATE "C"` was wrong, and I changed it to `ORDER BY table_name COLLATE "C"`.
- **Run 4: exit 0,** 4 files and 81 tests passed.

### 3.4 Typecheck, lint, OpenAPI lint, Prettier

| Command | Exit | Tail |
|---|---|---|
| `pnpm -r typecheck` (final; log `typecheck.log`) | 0 | `apps/api typecheck: Done` |
| `pnpm lint` (log `lint.log`) | 0 | `eslint . --max-warnings=0` (no findings) |
| `pnpm openapi:lint` (log `openapi-lint.log`) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 951 operations` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (log `format.log`) | 0 | 22 × "All matched files use Prettier code style!" |

- **First Prettier check: not clean.** It flagged `schema.ts` and `catalogue.test.ts`.
- **Fix:** I ran `prettier --write` on my changed files only. `git diff` still shows 0 deleted lines in those two files.
- **Re-run:** exit 0, as in the table.

### 3.5 Unit tests

- **Targeted run: exit 0.** `npx vitest run --project unit-node packages/db/src/seed.test.ts apps/api/src/modules/platform/advisory-locks.test.ts packages/db/src/migrate.test.ts` passed 3 files and 77 tests (`unit-targeted.log`).
- **Full run: exit 0.** `pnpm test` (`unit-full.log`) ran the three projects:
  - 191 files, 2,909 tests passed;
  - 125 files, 2,113 tests passed;
  - 3 files, 259 tests passed and 2 skipped. These two skips are pre-existing, not mine.

### 3.6 Integration, targeted (migrations and contract)

`with-pg.sh npx vitest run --project integration` over the following files (`integration-targeted.log`):

- `packages/db/test/integration` (all);
- `apps/api/test/integration/contract` (`contract.test.ts`, `response-validation.test.ts`, `benefit-register-mirror.test.ts`);
- `aud-write-deny.test.ts`, `kpi/kpi-aud-write-deny.test.ts`;
- `access/sensitive-reference-inventory.test.ts`;
- `text-scan/seeded-texts.test.ts`;
- `identity.test.ts`;
- `hardening/route-inventory.test.ts`, `hardening/integrity-sweep.test.ts`.

**Result: exit 0, 25 files and 681 tests passed,** including `contract.test.ts` (105), `p7-transfer-guards.test.ts` (11) and `catalogue.test.ts` (44).

### 3.7 Integration, full suite

- **Command:** `LC_ALL= LANG= QA_PG_PORT=24801 MTH_PORT_POOL=24802-24849 tests/qa/support/with-pg.sh pnpm test:integration`, run 14:15 → 14:51 UTC (`integration-full.log`).
- **Result: exit 1.** 443 files: 441 passed, **2 failed**. 4,385 tests: 4,381 passed, 2 failed, 1 skipped, 1 todo.

**Failure 1: `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` (caused by this task, now repaired).**

- The sweep reads every GET of the contract, and it failed with "refused to the admitted readers: listMigrationExports 404 …, listMigrationImports 404 …, listIdentityRebinds 404 …".
- These are my unrouted, pending operations. The sweep had no pending exclusion.
- **Repair:** I added the 4-line exclusion of `P2_PENDING_OPERATIONS` (§1).
- **Re-run:** `with-pg.sh npx vitest run --project integration apps/api/test/integration/access/sensitive-reach-sweep.test.ts` exited **0**, 2/2 passed (`integration-sweep-rerun.log`).
- On the changed file, `eslint --max-warnings=0` and `prettier --check` each exited 0, and so did `tsc -p apps/api/tsconfig.json --noEmit`.

**Failure 2: `tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts` (failing; I judge it not caused by this task, but I could not prove that at base).**

- The error is `a13c-child-api.ts exited (0) before READY: READY RESPONSE 200 {… "status":"committed" …}`.
- It fails at line 153, the **restarted** child. That step has no fault injection.
- The child printed `READY`, committed and exited before the poll ran. `tests/qa/support/a13c.ts` l.51 checks `exitCode` before `out.includes("READY")`, so a child that finishes within one poll interval fails. That is an ordering race in the harness.
- None of my files is on that path (import commit, KPI actuals).
- **Re-run alone: exit 1 again** (`integration-a13-rerun.log`).
- **Comparison at base: BLOCKED.** I created a disposable clone of `9f161c65` under `$TMPDIR` to run it there, and the clone filled the disk ("0 MB free"). I deleted it at once, and 3.8 GB were free again.
- The test belongs to qa-verifier (`tests/qa/**`), so I did not edit it. Open question O11.

### 3.8 Data dictionary generation

`with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG7/T-DG7-ARCH-02-evidence/gen-dictionary.ts` exited 0 and printed 13 table sections (`dictionary-section.md`). That output, minus the first line (the cluster banner), is appended verbatim to `data-dictionary.md`.

### 3.9 End of run

```text
$ node tools/gates/validate.mjs --historical --stage DG6      (validate-historical-DG6-end.log)
PASS gate DG6 (historical)
EXIT=0
$ date -u   → 14:56:08 UTC
```

The final `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` is in §6.

### Not run

- **Live CI:** not run (D-058).
- **Container drills:** none in this task.
- **Implementer tests T-C1…T-C17 and T-D1…T-D9:** none exist yet. They are specified in §C/§D, not run.

## 4. Known gaps, deviations and open questions (each quotes its source)

- **O1. Permission code renamed.**
  - p7-plan §3 seam 6 lists "`migration.import_status.read`".
  - 0001 says: "code text PRIMARY KEY CHECK (code ~ '^[a-z_]+\.[a-z_]+$')".
  - The code is therefore `migration_import.read`, recorded in ADR-0064 §9, `permissions.ts` and matrix §30. Please confirm.
- **O2. No `approval_route` kind.**
  - The plan's ARCH-02 row lists "approval routes" among the bundle kinds.
  - The contract's `listApprovalRoutes` says "Routes are edited in Studio as approver_route elements", so routes travel inside the `methodology` kind (ADR-0065 Context 3). There are 12 kinds, not 13.
- **O3. The attachment manifest download.**
  - ADR-0064 Residual 4: the download lists evidence object names and parent ids, including those of ADR-0051 sensitive records, to ADM_TECH. It holds no content.
  - Should it stay an API download (the plan's "download attachment manifest"), or be CLI-only?
- **O4. The export job's service identity.**
  - ADR-0053 scopes job identities. ADR-0064 §7 declares `job:transfer.export` with **no** permission code, and says plainly that the job reads every table "like a backup".
  - The protections are `migration.export` (ADM_TECH), audit, and the fact that no operation returns row data. Please confirm this is acceptable.
- **O5. BE-E's file moves to `apps/api`.**
  - p7-plan §5.1 BE-E: "`packages/db/src/transfer/attachments.ts` (… byte copy through `EvidenceStore`, both adapters …)".
  - The port is `apps/api/src/modules/evidence/store.ts`, and `packages/db` must not import `apps/api` (ADR-0002). So the copy is `apps/api/src/modules/transfer/attachments.ts` plus `apps/api/src/cli/transfer-attachments.ts` (§C.3).
- **O6. BE-D touches the sign-in path.**
  - p7-plan §3 seam 11 says "login semantics unchanged".
  - The rebind needs "Users not mapped cannot sign in" (D-243 Q5, plan Q5). ADR-0064 §8 adds an `identity_unbound` result beside `account_disabled` in `identity/oidc.ts`, and it is inert without a hold row.
  - BE-D's plan boundary does not list `identity/**`, so §C.2 assigns `identity/oidc.ts` and the `auth.json` key to BE-D. Please confirm the ownership and the "additive" classification.
- **O7. Non-draft kinds become live at commit.**
  - Seam 2 allows "its own import path through that kind's existing write API". ADR-0065 §1 lists five such kinds: branding, notification policy, job schedules (always disabled), review policies and upload policy.
  - By default `config_review_policy.configure` is TO's, so review-policy items are `refused` for both bundle roles (ADR-0065 Residual 4).
- **O8. SecretRef names travel.**
  - D-243 Q16: "all credential material excluded".
  - ADR-0064 §4 keeps each reference's **name**, with provider `unbound`, so IT knows what to bind. A name is not a secret value (ADR-0052 §5). If the orchestrator reads Q16 as "no name either", the rewrite becomes `{"provider":"unbound","name":"<table>.<column>"}`. That is a change to one rule, and some `NOT NULL` columns still need a value.
- **O9. Migration ids.**
  - `0131`–`0132` are now permanently unused (T-DG7-ARCH-01 needed none). I did not add them to a pinned "retired" list like F-DG5-100's; the orchestrator may want one.
  - Implementer migrations `0136`–`0142` must be applied before ARCH-03's `0143`+ on any long-lived database. The runner refuses an id below the highest applied (`migrate.ts` `outOfOrderPending`), so the P6 practice of renumbering at merge applies.
- **O11. A13 kill-restart test (§3.7 failure 2).**
  - `tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts` fails twice here, at the restart step.
  - The cause is the order of checks in `tests/qa/support/a13c.ts` l.51 (`exitCode` before `READY`).
  - I could not run it at base (disk). It is qa-verifier's file, so I did not change it. Please have it confirmed at base, and repaired by its owner if it fails there too.
- **O10. `response-validation.test.ts`.** The plan reserves its pins for the orchestrator. It passed unchanged, so no pin needed changing.
- **Arabic texts** in §C.5, §C.8 and §D.2 are marked provisional (D-243 Q7).
- **Not done by design (implementers' work):** every route, job, CLI command, adapter, screen and test T-C*/T-D*. The pending lists hold the 19 operations, so the DG7 freeze fails until they are empty.

## 5. Merge instructions

1. Apply migrations `0133`, `0134`, `0135` in order (`mth-db migrate`). They are additive: new tables and seed rows only, and no existing table changes.
2. **Shared files** I edited: `openapi.yaml`, `erd.md`, `data-dictionary.md`, `p7-work-split.md`, `permissions-matrix.md`, `permissions.ts`, `schema.ts`, `seed.test.ts`, `catalogue.test.ts`, `contract.test.ts` (count pin), `p2-pending.ts`, both AUD sweeps, `advisory-locks.ts`, ADR-0016 and `sensitive-reference-inventory.ts`. Every edit is append-only, except:
   - the contract count pin;
   - the seed numbering ceiling (0133 → 0163);
   - `info.version` 1.5.0-p6 → 1.6.0-p7.

   No conflict is expected with DO-A or DO-B (W2). They edit `tools/release/**`, `licenses/**` and the CI files.
3. **Later ARCH tasks** append their own `P7_*_PERMISSIONS` block to `P7_PERMISSIONS`, their `p7-pending-arch-0N.ts` import line to `p7-pending.ts`, and their block to `p7-operations.ts`. They also move the seed test's free-id example.
4. **After merge,** run: `pnpm test`, `pnpm test:integration` (full), `pnpm openapi:lint`, and `node tools/gates/validate.mjs --historical --stage DG6`.

## 6. Final formatting check

See the line below, appended after the last edit.

`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, run after the last edit except this paragraph, exited **0**: 22 batches, each printing "All matched files use Prettier code style!" (`format-final.log`).

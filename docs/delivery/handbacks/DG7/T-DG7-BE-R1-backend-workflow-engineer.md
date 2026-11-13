# Handback T-DG7-BE-R1 (backend-workflow-engineer): the import load (ADR-0064 Amendment 1), repair after ARCH-R2

- **Stage:** P7, gate DG7 (BUILDING). This is the repair task of p7-plan §5.3 (D-258), §C.12 of `docs/architecture/p7-work-split.md`.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-R1-backend-workflow-engineer-20261113T130203Z-28cf7473","session_id":"28cf7473-1f46-4457-82df-095a55954636"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R1.md`. I verified its sha256 as `691fe828ef54e1a5be139dfc1d4e68b739e8c00ffe726a16c0e7d003bb382afb`.
- **Base:** `1d72268d17dfb0f460c1e3e0b315033bcd5f1e7f` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own directory. Nothing was committed.
- **Time (`date -u`):** start 13:02:13Z; last stamp before this handback 13:33:18Z. As earlier handbacks noted, the sandbox clock runs slow. The real elapsed time was beyond the 70-minute mark, so I stopped after the current file. What remains is listed in §4.
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.

## 0. Headline: the load is BLOCKED by a design fact (open question R1)

I measured this on PostgreSQL 16.15. On a target prepared with the A1.2 reservation, **carried audit ids collide with the target's migration baseline**:

- Migrations `0068_p5_form_schemas_framework.sql` (l.372), `0069_p5_procedures.sql` (l.212) and `0095_p5_procedures_v2_baseline_assignee.sql` (l.40, l.85, l.92) insert `audit_event` rows with **deterministic ids**. These are literal uuids, or uuids derived from `md5('p5-procedures-v2:audit:' || id)`.
- A source and a target therefore both hold these rows, with the same `id`.
- A1.4 L5 says "E3 guarantees that no carried `seq` and no carried `id` collides with a baseline row". That holds for `seq`, but **not for `id`**. The load fails at L5 with `duplicate key value violates unique constraint "audit_event_pkey"`. I observed this before I added the check below.

The C.12 hard rules forbid skipping, renumbering or archiving audit rows. The ARCH-R2 handback says a failing measurement "is a design question for me, not a reason for a workaround". So I did **not** work around it. What I did instead:

- **The import detects the collision inside the load transaction, at L1, before anything changes.** It exits **1** with `import-migration: failed: <n> carried audit events share their id with the target's migration baseline (first <id>); ADR-0064 Amendment 1 does not provide for this, and no audit row is skipped or renumbered`. This line is **mine, not from the work split**. The architect should replace it.
- **The test "R1 (BLOCKED …)" in `transfer-load.test.ts` pins the measured fact:**
  - more than 0 shared ids, all with `source = 'migration'`;
  - exit 1 with that line;
  - the only step reached is L0;
  - on `audit_event`, `n_tup_upd = n_tup_del = 0`;
  - every table count, the trail's content and both trigger states are unchanged.
- **Consequence:** T-R3, T-R4 (from L2 on), T-R5, T-R6, T-R7 (database part), T-R8 (database part) and T-R11 cannot pass until the architect decides. Every one of them needs a loaded target.

In the same work I found and fixed two load problems that are **not** design questions. Both are in `import.ts`:

- **L4.** `automation_rule` ↔ `automation_rule_version` is a cycle with `ON DELETE RESTRICT` on both sides. A per-table reverse-order `DELETE` fails, and nulling the deferred column first is refused by the CHECK `automation_rule_enabled_needs_version`. L4 therefore deletes every exported table except `audit_event` in **one statement** of data-modifying CTEs, with the count per table. The RESTRICT checks then run at the statement's end. `TRUNCATE` is never used, and `audit_event` is never a target.
- **L5.** A deferred column whose foreign keys are **all** `DEFERRABLE` loads with its value, because L0 runs `SET CONSTRAINTS ALL DEFERRED`. Without that, the same CHECK refuses the null. L6 then sets only the columns that still need setting.

Both fixes are past L4 and L5 in the code, but neither is proven end to end yet, because the R1 check stops every real run at L1.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0149_p7_transfer_import_load.sql` (new) | A1.6: seven NULL-able `migration_import` columns plus CHECK `migration_import_audit_ranges`; `run_kind` `recheck_after_use`; the replaced `migration_reconciliation_result`; the new append-only `migration_reconciliation_delta` (`mth_app` SELECT; CHECK `…_unexplained`); the `transfer_table_rule` row; one `retention_table_class` row (ADR-0067 §3 requires one per table; class `…143001`, like the other reconciliation tables). The header states that nothing touches `audit_event`. |
| `packages/db/src/migrate.ts` | `MigrateOptions.reserveAuditSeqFrom?: bigint` plus `onReserved` (test hook). Refuses unless no migration is applied. Inside the first file's transaction after which `audit_event_seq_seq` exists, it asserts `audit_event` is empty and runs `setval(…, R, false)`. Refuses if the hook never fired. Adds `MigrationReserveError` and the C.12 lines. Nothing else changes. |
| `packages/db/src/cli.ts` | `migrate --reserve-audit-seq-for DIR`: package checks and `M` by streaming, **before any connection**, then the C.12 output line. `import-migration` gains `--attachments-report FILE` and `--report FILE`. Usage and header updated. |
| `packages/db/src/transfer/import.ts` | Removed `LOAD_BLOCKED_REASON`, `EMPTY_TARGET_TABLES` and the exit-1 stop. Adds `packageAuditRange` (streams M, rows, min and ids), `reservedAuditStart`, E1–E4 (`checkEmptyTarget` with detail lines), `checkAuditIdCollisions` (§0), and L0–L12 in one transaction under lock 730403 with the `onStep` test hook. Also the `migration_import` record with the seven fields, holds, the reconciliation with an `audit_baseline` delta, the A1.7 `migration.imported` event, `migration.reconciled`, `identity.binding_held`, and the success line plus the audit-history line. The header is updated. |
| `packages/db/src/transfer/attachment-report.ts` (new) | A1.8: `parseAttachmentReport(bytes, expected, cmd)` and `requireAttachmentReport`, with the four refusal lines. Strict UTF-8, exact keys and order, canonical bytes. |
| `packages/db/src/transfer/attachment-report.test.ts` (new) | T-R8 unit part |
| `packages/db/src/transfer/reconcile.ts` | `reconcileTables(…, { auditCarriedSeqMax })` compares `audit_event` over `seq <= M`. Adds `ReconciliationDelta`/`DeltaBasis`/`RunKind` and the delta-aware `buildReport` (A1.6 rule). `recordReconciliation` writes the delta rows and accepts `recheck_after_use` and `skipAudit`. Adds `auditReconciliation`. The recheck command itself is **unchanged** (§4). |
| `packages/db/src/transfer/export.ts` | only `encodeTable(…, opts?: { where?: string })`. The export never passes it, so T-C4 bytes are unchanged; `transfer-export.test.ts` passes. |
| `packages/db/src/transfer/index.ts` | export lines |
| `packages/db/src/schema.ts` | Kysely types and `SCHEMA_COLUMNS` for 0149 |
| `packages/db/src/seed.test.ts` | the next free id is now 0150 |
| `packages/db/test/integration/catalogue.test.ts` | 0149 trigger pins, the `transfer_table_rule` list, `mth_app` SELECT on the delta table |
| `packages/db/test/integration/p7-transfer-guards.test.ts` | T-R9 (4 cases) |
| `packages/db/test/integration/transfer-load.test.ts` (new) | T-R1, T-R2, and R1 (BLOCKED) |
| `packages/db/test/integration/transfer-roundtrip.fixture.ts` | `RoundtripWorkspace.reserved(prefix, dir)`; `migrated(prefix, options)`; `importInto` passes `attachmentsReport` and `onStep` |
| `packages/db/test/integration/transfer-roundtrip.test.ts` | The Q1 pin is replaced by an E3 pin: a plainly migrated target gives exit 2 with the remedy. The non-empty refusal accepts the E1/E2 detail lines. The header names R1. |
| `packages/config/src/load.ts`, `packages/config/src/index.ts` | D-258 item 2: `secureIssuerAllowed(issuerUrl, nodeEnv)` and the C.12 refusal line |
| `packages/config/src/load.test.ts` | T-R10 (loopback issuers load; `http://idp.example.test`, a private IP and `localhost.evil.example` are refused with the exact line; https and non-production are unchanged). The old exact-line assertion now uses the new line. |
| `apps/api/src/modules/identity/oidc.ts` | `allowHttp = issuerUrl.protocol === "http:" && secureIssuerAllowed(issuerUrl, nodeEnv)`; nothing else |
| `apps/api/src/modules/identity/oidc-allow-http.test.ts` (new) | T-R10 constructor case |
| `vitest.config.ts` | `tests/integration/**/*.test.ts` added to the `integration` project's `include` (KBE-A Q2) |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md` | the 0149 columns, table, constraints and ERD edge |
| `docs/handover/data/coverage.json` | regenerated by `tools/release/dictionary-coverage.mjs` |
| `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md` | regenerated by `node tools/release/migration-catalogue.mjs`; no override |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R1-evidence/*.log` | logs of §3 |

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| REQ-S19-014 "clean installation" (preparation) | T-R2 | **PASS.** The first baseline `seq` is `M + 1`. The hook fires once, in `0003_audit_event.sql`. The plan defers no `audit_event` column. Refused (exit 2) on a database with an applied migration. A bad package is refused with the exact line against an unreachable URL, so no connection is made. The CLI prints the C.12 line. |
| REQ-S19-014 M0362 "validation" | T-R1 | **PASS.** Measured with and without the reservation: E1 tables 0, E2 non-baseline 0, E4 `O`. A plainly migrated target gets E3, exit 2, exact line, unchanged. One `organization` gets exit 3 plus `organization holds 1 rows`, unchanged. One `api` row written as `mth_app` gets exit 3 plus the E2 line, unchanged. |
| REQ-S19-016 "audit history" (append-only, triggers on) | T-R4 | **Partial.** L0 is checked (triggers `O`, no upd/del). L1–L12 are not reached (§0). |
| REQ-S19-014/016 the round trip | T-R3, T-R5, T-R6, T-R7 (db), T-R8 (db), T-R11 | **BLOCKED** by R1 (§0) |
| REQ-S19-014/016 "evidence checksums" | T-R8 unit | **PASS:** every A1.8 refusal and the three-mismatch mapping |
| 0149 schema | T-R9 | **PASS:** ranges all or none; baseline above M; `recheck_after_use` with unequal rows (refused with a disallowed table); delta append-only (owner UPDATE/DELETE refused); `mth_app` cannot insert; `unexplained` never allowed; the `transfer_table_rule` row |
| REQ-S19-017 / REQ-S01-006 drill IdP | T-R10 | **PASS** (loader and `OidcService` constructor) |
| contract | T-R12 | **Not done** (§4) |

The refusal paths are tested with "state unchanged": counts per table, an md5 over every `audit_event` row, and both trigger states.

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, offline, PostgreSQL 16.15 disposable via `tests/qa/support/with-pg.sh`)

| Command | Exit | Log / tail |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (before implementing) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-before.log`) |
| `with-pg.sh npx vitest run --project integration` on `transfer-load`, `transfer-roundtrip`, `transfer-export`, `catalogue`, `p7-transfer-guards`, `contract`, `unbound-signin`, `import-routes`, `oidc`, `tests/integration/transfer/financial-parity`, `attachments` | **0** | `Test Files 11 passed (11)`, `Tests 271 passed \| 1 todo (272)`. The todo is T-R11's loaded-target case, left as `it.todo` (BLOCKED). See `integration-be-r1.log`. |
| `node tools/release/dictionary-coverage.mjs --database-url <fresh migrated db> --out docs/handover/data/coverage.json` | **0** | `PASS: 365 tables and 5775 columns documented (2 schemas)` (`dictionary-coverage.log`) |
| `node tools/release/migration-catalogue.mjs`, then `--check` | **0**, **0** | `PASS: migration catalogue up to date: 132 migrations (73 additive, 38 data_rewrite, 21 destructive)` |
| `pnpm -r typecheck` | **0** (first run **2**: a `string \| undefined` narrowing in `load.ts`, fixed, then re-run) | `typecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `pnpm test` | **0** | unit-node 204 files / 3006 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped) (`pnpm-test.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!` (`prettier.log`; run after this handback was written) |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |

Not run: the full `pnpm test:integration` suite. I ran the 11 files that C.12 names or that I touched, not every integration file.

## 4. Known gaps (not done)

1. **R1 (design):** the load cannot complete (§0). This blocks T-R3, T-R4 (L1–L12), T-R5, T-R6, T-R7 (db), T-R8 (db) and T-R11.
2. **`packages/db/src/transfer/recheck.ts` is not written.** Missing: `RECHECK_OPERATIONAL_TABLES`, `RECHECK_NEVER_OPERATIONAL`, `parseAllowance`, `compareRows`, the rebind reversal, the ranges check, and mode 1 and mode 2 of `reconcile-migration`. Also missing are its CLI flags `--attachments-report` / `--after-use --from --allow --report` and `transfer-recheck.test.ts`. `reconcile-migration` still runs the BE-D recheck, which has no audit-range handling and `attachments_checked = 0`. **That violates A1.8's "never 0 for a package with attachments"** once a real import exists. No real import can exist until R1 is resolved.
3. **`tools/migration/prepare-target.mjs` is not written.** `tools/migration/import.mjs` (copy-in → verify → `--attachments-report`) and `tools/migration/reconcile.mjs` are not updated.
4. **T-R12 is not done.** Missing: the `docs/api/openapi.yaml` additive fields (seven `MigrationImport` fields, `runKind` `recheck_after_use`, `deltas[]`), `apps/api/src/modules/transfer/import/service.ts` presenters, and the `p7-exercises-be-d.ts` delta row and `seedSyntheticImport` filling the seven columns. The contract test still passes on the unchanged contract.
5. **`tests/integration/transfer/financial-parity.test.ts`:** the loaded-target `it.todo` is not switched on (BLOCKED by R1). The `vitest.config.ts` include is done, and the file is collected and runs (10 passed, 1 todo).
6. **The R1 exit-1 line is not a work-split text** (§0).
7. **Measured but not yet exercised end to end:** the L4 single-statement delete and the L5 direct deferrable load (§0). The `pg_stat_xact_user_tables` measurement works at L0, which answers the ARCH-R2 handback's question "that `pg_stat_xact_user_tables` shows the transaction's own counters" for the first step only.
8. **`p7-pending*.ts`:** no BE-R1 entries exist there, so none were removed.

## 5. Open questions and merge instructions

- **R1 (architect):** how should the carried and the baseline rows with the same deterministic `id` coexist, given that `audit_event` rows can never be updated or deleted and the C.12 hard rules? Facts for the decision:
  - the colliding rows are `source = 'migration'` seeds;
  - the source's copy and the target's copy differ in `seq` and `occurred_at`;
  - 0068, 0069 and 0095 are applied, forward-only migrations.
- **Migration:** `0149_p7_transfer_import_load.sql`, the next id above 0148. Renumber at merge if another task took 0149, and update `seed.test.ts` and the catalogue with it.
- **Endpoints added:** none. No API operation was added or removed.
- **Conflicts to expect:**
  - `docs/handover/migration-catalogue.json`, `upgrades.md` and `coverage.json` are generated: regenerate after merge;
  - `vitest.config.ts` has a one-line include.

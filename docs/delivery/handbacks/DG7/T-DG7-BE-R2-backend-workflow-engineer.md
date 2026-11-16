# Handback T-DG7-BE-R2 (backend-workflow-engineer): finish the load and the recheck (ADR-0064 Amendment 2), repair after ARCH-R3

- **Stage:** P7, gate DG7 (BUILDING). This is the second import repair task of p7-plan §5.3 (D-259), §C.13 of `docs/architecture/p7-work-split.md`.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-R2-backend-workflow-engineer-20261113T143159Z-04ffb451","session_id":"04ffb451-53bb-40b4-9de8-7d4e28a10ee6"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R2.md`. I verified its sha256 as `4d0482243ef5a14c5f0141139bbe1032fda70ce54c5d695e0a650dd4e9321c64`.
- **Base:** `ab3124ddd26f4369d916573b08571a48f6ae1dcf` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own directory. Nothing was committed.
- **Time (`date -u`):** start 14:32:08Z; last stamp before this handback 15:13:37Z. Earlier handbacks note that the sandbox clock runs slow.
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record. Every dataset is synthetic.

## 0. Headline

**The import load now completes end to end on a reserved target.** Three things were needed:

1. **E5 at L1 (A2.2), as designed.** Measured |P| = **45** shared migration audit events on this release. The ADR's reading gave 44.
2. **One load fix not covered by A1.4 (see §5, Q2).** `gate_instance.current_submission_id` is a deferred column of the cycle `gate_instance` ↔ `gate_submission`. Both foreign keys are `NOT DEFERRABLE`. CHECK `gate_instance_draft_unsubmitted` refuses the NULL that A1.4 L5 loads for every submitted gate.
   - When a table with such a column fails its batch load with a CHECK or NOT NULL violation (detected through a `SAVEPOINT`), the load falls back to one statement.
   - That statement covers the contiguous plan tables from that table up to its last non-deferrable parent, as data-modifying CTEs. The RESTRICT keys are then checked at the statement's end, the counterpart of BE-R1's L4 single DELETE.
   - Nothing is disabled, changed or left out. Only `gate_instance` triggers this on the demo.
3. **`SET CONSTRAINTS ALL IMMEDIATE` before L8, then `DEFERRED` again.** The DEFERRABLE keys deferred at L0 left pending trigger events, and `ALTER TABLE … ENABLE TRIGGER USER` refuses a table with pending events. PostgreSQL checks them retroactively at that point, over every loaded row.

`audit_event` is never updated, deleted or truncated, and its triggers stay `O` at every step (T-R4, measured through `onStep`).

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0150_p7_transfer_import_shared_audit.sql` (new) | A2.4: `migration_import.audit_already_present_rows` with CHECK `migration_import_audit_present`; `migration_reconciliation_delta_basis_check` dropped and re-added with nine values. The header states that nothing touches `audit_event`. |
| `packages/db/src/transfer/table-digest.ts` (new) | `encodedRows` (encodeTable's encoder, row by row, with the key tuple from the encoded key values), `digestOfLines`, `tableDigest`, and `runTableDigestCommand` (`mth-table-digest/1`; exit 2 `table-digest: refused: <t> is not an exported table`) |
| `packages/db/src/transfer/recheck.ts` (new) | `RECHECK_OPERATIONAL_TABLES`, `RECHECK_NEVER_OPERATIONAL` (with the 17 financial tables), `ALLOWANCE_SCHEMA_VERSION` `/2`, `parseAllowance`, `childrenOrder`, `validateAllowance`, `compareRows`, `reverseRebinds`, `presentFromTrail`, `checkAuditTrail` (A1.5 with A2.3), `explainAudited`, `explainChildren` |
| `packages/db/src/transfer/recheck.test.ts` (new) | unit parts of T-R7/T-R15: the constants (disjoint; the 17 financial tables read from T-C17's file), the structural refusals, the cycle |
| `packages/db/src/transfer/import.ts` | Removed `checkAuditIdCollisions` and BE-R1's provisional line. Added E5 (`checkSharedAuditIds`, A2.2/A2.7 lines), L5 skipping `P` with the inserted-count check, the non-deferrable cycle load (§0 item 2), `SET CONSTRAINTS ALL IMMEDIATE` before L8, the L9 reconstruction, the `audit_already_present` delta, L11 `audit_already_present_rows`, L12 `auditAlreadyPresent`, the audit-history line counting inserted rows, and the A2.2 line. Header updated. |
| `packages/db/src/transfer/reconcile.ts` | `encodeCarriedAudit` (A2.3) and the nine-value `DeltaBasis`. `reconcileTables` reconstructs `audit_event`. `runReconcileMigrationCommand` gains mode 1 (trail check, rebind reversal, attachment report) and mode 2 (`--after-use --from --allow`; `tables`/`audited`/`children`/`operational`), plus `--attachments-report` and `--report`. |
| `packages/db/src/cli.ts` | `reconcile-migration` flags; new `table-digest` command (as `mth_app` through `DATABASE_URL`, before `loadConfig`); usage and header |
| `packages/db/src/transfer/index.ts` | export lines |
| `packages/db/src/schema.ts`, `packages/db/src/seed.test.ts` | 0150 column; next free id 0151 |
| `packages/db/test/integration/p7-transfer-guards.test.ts` | T-R9 for 0150 (2 cases) |
| `packages/db/test/integration/transfer-load.test.ts` | "R1 (BLOCKED)" replaced by T-R13 (with T-R4 and T-R3 on the same load), the A2.1 column pin, T-R14 and T-R5 (b) |
| `packages/db/test/integration/transfer-recheck.test.ts` (new) | T-R17, T-R6 (3 cases), T-R7 + T-R15 (5 cases including 13 refusals) |
| `packages/db/test/integration/transfer-roundtrip.test.ts` | header only (T-R3 now runs in transfer-load) |
| `tests/integration/transfer/financial-parity.test.ts` | T-R11: the `it.todo` becomes its body (rows, `recompute`, and the `benefit_counting` and `benefit_value_line` views on a loaded target); header updated |
| `tools/migration/prepare-target.mjs` (new) | wrapper over `mth-db migrate --reserve-audit-seq-for` |
| `tools/migration/import.mjs`, `tools/migration/reconcile.mjs` | copy-in → verify → `--attachments-report`; `--report`, `--keep-reports`; reconcile `--from`, `--after-use --allow` |
| `tools/migration/tests/wrappers.test.mjs` (new) | T-R18 (fake child CLIs in a throwaway root) |
| `docs/api/openapi.yaml`, `apps/api/src/modules/transfer/import/service.ts`, `apps/api/test/integration/contract/p7-exercises-be-d.ts` | Additive only: the 8 nullable `MigrationImport` audit fields, `runKind` `recheck_after_use`, `MigrationReconciliation.deltas[]` (nine bases); presenters and zod mirrors; the exercise seeds the fields and one delta row (T-R12). `info.version` and the operation count (965) are unchanged. |
| `apps/api/scripts/register-snapshot.test.mjs` | T-R16 only; `register-snapshot.mjs` is unchanged |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md` | 0150 lines |
| `docs/handover/data/coverage.json`, `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md` | regenerated by their tools, with no override. The tool classifies 0150 as `destructive` (it drops a CHECK). |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R2-evidence/*` | the logs of §3 |

**Migration:** `0150_p7_transfer_import_shared_audit.sql`. **API endpoints added:** none (additive response fields only). **New CLI command:** `mth-db table-digest`. `p7-pending*.ts`: no entry names this work, so none were removed.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| REQ-S19-016 "audit history" | T-R13, T-R14, T-R3, T-R4 | **PASS.** \|P\| = 45 > 0, equal to the measured shared ids. One row per shared id (the baseline's). The A2.2 line is printed. `audit_already_present_rows = 45`. The delta `audit_already_present` has `rows_changed 45` and is allowed. `migration.imported` lists P sorted, with `sourceSeq`/`sourceOccurredAt` equal to the package lines. The reconstructed digest equals the manifest's. Triggers are `O` and upd/del = 0 at L0, L1, L3, L5, L8, L9 and L12. Every non-P carried row equals the source row by row, including `id` and `seq`. The baseline is unchanged and the ranges do not interleave. T-R14: `reason` and `source=api` cases exit 1 with both lines, and nothing changes. |
| REQ-S19-014 M0362 "reconciliation" | T-R13, T-R6, T-R7, T-R15, T-R5 (b) | **PASS** for the cases listed in §4 as covered |
| REQ-S19-016 M0364 decimal/status integrity | T-R11 | **PASS** (loaded target) |
| REQ-S19-017 (B.8) | T-R15 (mode 2), T-R17 | **PASS** for what runs (gaps in §4) |
| REQ-S19-019 | T-R16 | **FAILS by design** until the analyst rewording (A2.8 item 1, A2.10 residual 5). It names exactly `REQ-DLV-006 procedure R2` and `REQ-DLV-023 notes R2`. The planted-path negative case passes. |
| 0150 schema | T-R9 | **PASS** |
| contract | T-R12 | **PASS** |
| wrappers | T-R18 | **PASS** (6 cases) |

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`, offline, PostgreSQL via `tests/qa/support/with-pg.sh`)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**, before any edit) | **0** | `PASS gate DG6 (historical)` (`validate-dg6-historical.log`) |
| `pnpm -r typecheck` | **0** | `typecheck.log` |
| `pnpm lint` | **0** (first run **1**: three `import()` type annotations in `reconcile.ts`, fixed, then re-run) | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `pnpm test` | **0** | unit-node 205 files / 3011 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped) (`pnpm-test.log`) |
| `with-pg.sh npx vitest run --project integration` on transfer-load, transfer-recheck, transfer-roundtrip, transfer-export, catalogue, p7-transfer-guards, contract, unbound-signin, import-routes, attachments, financial-parity | **0** | `Test Files 11 passed (11)`, `Tests 253 passed (253)`; prints `T-R13 measured \|P\| = 45` (`integration-be-r2.log`) |
| `with-pg.sh npx vitest run --project integration apps/api/test/integration/oidc.test.ts` | **0** | 33 passed (`oidc.log`) |
| Earlier iterations of transfer-load / transfer-recheck / financial-parity | 1, then 0 | `transfer-load-{1..4}.log`, `transfer-recheck-{1..3}.log`, `financial-parity-1.log`: the failures that led to §0 items 2–3 and to the key fix in `encodedRows` |
| `node --test tools/migration/tests/wrappers.test.mjs` | **0** | pass 6 (`wrappers.log`) |
| `node --test apps/api/scripts/register-snapshot.test.mjs` | **1** | pass 22, fail 1: T-R16 tree case, by design (§2) (`register-snapshot.log`) |
| `npx vitest run packages/db/src/transfer/recheck.test.ts` | **0** | 5 passed (also in `pnpm test`) |
| `node tools/release/dictionary-coverage.mjs --database-url <fresh migrated scratch db> --out docs/handover/data/coverage.json` | **0** | `PASS: 365 tables and 5776 columns documented` (`dictionary-coverage.log`) |
| `node tools/release/migration-catalogue.mjs`, then `--check` | **0**, **0** | `PASS: migration catalogue up to date: 133 migrations (73 additive, 38 data_rewrite, 22 destructive)` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3a | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | see §3a | `validate-dg6-historical-end.log` |

Not run: the full `pnpm test:integration` suite (I ran the 12 files named above).

## 4. Known gaps (not done)

1. **T-R16 fails** until the requirements-analyst rewords REQ-DLV-006 and REQ-DLV-023 (A2.8 item 1). I did not edit the register. `pnpm test` does not run this file, so it stays green.
2. **T-R5 (a)** (a byte flipped between `copy-in` and `verify`, giving exit 4) is not written. The import-side report mapping is BE-R1's; the demo package carries no attachments, and I built no attachment fixture.
3. **T-R8, database part, for the recheck:** `reconcile-migration` enforces A1.8 (`requireAttachmentReport` and `parseAttachmentReport` with the recorded sha and count). But no integration case lands three mismatches through a recheck, and none refuses a missing report for a package with attachments.
4. **T-R15 is partial.** Not covered by a database test:
   - the `children` positive and negative cases (child of an explained parent, child of an unchanged parent);
   - the refusals `audited table <t> has no enabled … trigger`, `… primary key other than (id)`, `<fkey> is not a foreign key …` and `parent … is not listed …`.

   The cycle refusal is covered by a unit test only. The code paths exist.
5. **T-R4's TRUNCATE statement spy** is not built. The truncate trigger's `O` state is checked at every step, and the import code issues no TRUNCATE.
6. **The A2.3 unit pin** ("`encodeCarriedAudit` with `present = []` equals `encodeTable(…, { where: 'seq <= M' })`") is not a separate case. It is exercised indirectly: T-R13's reconstructed digest equals the manifest's.
7. **`table-digest` as `mth_app`:** T-R17 calls the function on the owner pool. The CLI path through `DATABASE_URL` and `mth_app`'s SELECT on every exported table is not exercised.
8. **`import.mjs` "package checks first":** the wrapper reads only the attachment count. The full package checks are done by `mth-db import-migration` (step 1) before it touches the target, but after `copy-in`.
9. **Mode 2's `rebind` delta** is written with `rows_changed` = the number of rebound identities. A1.9 does not fix its counts in mode 2.

## 5. Open questions and merge instructions

- **Q1 (architect): A2.1's column count.** The catalogue measures **17** `audit_event` columns, not 15. A2.1 enumerates 15 compared names (`id` … `changes`) and calls them "13". So the rule is unchanged, and E5 compares every column except `seq` and `occurred_at`, exactly A2.1's enumerated list. The test pins that list plus `seq` and `occurred_at` (17), so any new column fails it. I treated this as an arithmetic slip, not a contradiction of the rule. Please confirm, and correct "13"/"15" in A2.1 and C.13.
- **Q2 (architect): the load fixes in §0 items 2–3** go beyond A1.4 L5 ("`deferredColumns` loaded as null"). That rule cannot hold for `gate_instance` (a CHECK, with non-deferrable keys). Please review:
  - the grouped single-statement load (it holds the group's rows in one statement; a residual for very large tables);
  - the `SET CONSTRAINTS ALL IMMEDIATE` before L8.

  Both keep every constraint enforced and leave `audit_event` untouched.
- **Q3 (orchestrator):** record A2.10 residual 1 with the measured \|P\| = 45 (the ADR read 44).
- **Migration:** `0150_p7_transfer_import_shared_audit.sql`, the next id above 0149. Renumber at merge if it is taken, and update `seed.test.ts` (next free id 0151), the catalogue and the coverage file.
- **Conflicts to expect:** `docs/handover/{migration-catalogue.json,upgrades.md,data/coverage.json}` are generated, so regenerate them after the merge. `docs/api/openapi.yaml` (additive schema fields only). DO-D3 (B.7) consumes `mth-recheck-allowance/2`, `table-digest` and the wrappers' `--keep-reports`.

## 3a. Final check results

See `docs/delivery/handbacks/DG7/T-DG7-BE-R2-evidence/final-exits.log`. It holds the exit codes of the repository-wide prettier check and the closing validator run, both of which ran after this file was written. If that log shows anything other than 0, it is authoritative over this section.

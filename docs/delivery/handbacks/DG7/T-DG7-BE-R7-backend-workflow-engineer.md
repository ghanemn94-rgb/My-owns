# Handback T-DG7-BE-R7 (backend-workflow-engineer): integration order-dependence in p7-transfer-guards

- **Stage:** DG7 (BUILDING); branch `claude/mobily-transformation-platform-dg6-regate`; base `HEAD` `6795deac7d9d14c7e4d61a4d72f9d7987e283ef1` (clean tree at start).
- **Invocation:** run `DG7-T-DG7-BE-R7-backend-workflow-engineer-20261115T171339Z-eded745f`, session `eded745f-7a82-4e59-a0c5-372c9cd7b6b7`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R7.md`, sha256 `d868954a1535e7e3bdc03da881eb597fcaba2d31350de3ff9dbab5ee98333abb` (verified).
- **Finding:** F-DG7-962 (Medium, non-mandatory). The finding stays OPEN until a non-author reviewer verifies it. I don't close it.
- **Time:** start 17:13:49Z. Handback first written at 18:02Z and finalized at about 18:37Z. The full integration run didn't complete (see §4).
- **Migrations added:** none. **API endpoints added:** none. **Product code changed:** none.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/test/integration/p7-transfer-guards.test.ts` | The file now runs in its own scratch database (`mth_p7guard_*`). A `beforeAll` creates it and migrates it with the real `migrate()`, and an `afterAll` drops it. The `mth_app` and `mth_owner` handles point at the scratch database instead of the shared run database. A new test, "F-DG7-962: this file is isolated…", checks that both roles really are connected to the scratch database and that it isn't the run database. The 21 existing guard tests are unchanged. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R7-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R7-evidence/*` | Logs `01`–`10` and the order-probe config (`probe-order.config.ts.txt`). |

**Why isolation and not cleanup.** The rows the file commits can't be deleted without weakening what the file tests:

- `migration_import`, `migration_reconciliation_delta` and `audit_event` are append-only, even for the owner. The file itself asserts this.
- The queued `migration_export` rows can't be deleted by `mth_app` (42501, also asserted).

Removing them from the shared database would need a superuser trigger bypass. The precedent is `transfer-export.test.ts`, which already works in its own migrated scratch database. Migrating the scratch database adds about 10 s to this file (13 s instead of 0.3 s).

**No product defect found.** The service refuses a second export while one is queued or running, which is the intended one-at-a-time rule.

**Observation, not acted on.** The QA reviewer also noted (outside the finding) that one owner-written import without a reconciliation makes the whole `listMigrationImports` answer 500. That's a product question. I didn't change it (see §5).

## 2. Behaviour per requirement

- **REQ-S19-001 / REQ-S19-002** (the P7 transfer tables' guards, which this file probes): the same 21 guard assertions still run on a real PostgreSQL, as `mth_app` and `mth_owner`, over all migrations applied to a fresh database. They now run against an isolated scratch database. All 22 tests pass (log 03).
- **Order independence (F-DG7-962, REQ-S20-031 / A23):** the guard file now leaves no rows in the shared run database. With a fixed-order sequencer and file parallelism off:
  - guard first, then contract and response-validation: 3 files and 252 tests pass, exit 0 (log 04);
  - contract and response-validation first, then guard: 252 tests pass, exit 0 (log 05).
- **Control:** the HEAD version of the guard file, run first in the same probe, reproduces the finding. Contract fails 4 tests and response-validation fails 5, all with 422 `migration.export_in_progress`; exit 1 (log 06). My version was restored straight after (`cmp` OK).

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, `MTH_PNPM_OFFLINE=1`. Each database check runs on its own disposable PostgreSQL 16.15 cluster through `tests/qa/support/with-pg.sh` (`QA_PG_PORT` 27461–27465).

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 01 | `pnpm -r typecheck` | 0 | `01-typecheck.log` |
| 02 | `pnpm lint` | 0 | `02-lint.log` |
| 03 | `QA_PG_PORT=27461 tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration/p7-transfer-guards.test.ts` | 0 | 1 file, 22/22 passed |
| 04 | `BE_ORDER="$G,$C,$R" QA_PG_PORT=27462 tests/qa/support/with-pg.sh npx vitest run --config <scratch>/order.config.ts --project integration $G $C $R` | 0 | guard → contract → response-validation: 3 files, 252/252 passed |
| 05 | same, `BE_ORDER="$C,$R,$G"`, port 27463 | 0 | contract → response-validation → guard: 252/252 passed |
| 06 | same as 04 with the HEAD guard file (control), port 27464 | 1 | 2 files failed, 9 tests failed (`migration.export_in_progress`): the finding reproduced |
| 07 | `QA_PG_PORT=27465 tests/qa/support/with-pg.sh npx vitest run --project integration` (full project) | **none (stopped)** | Stopped by the harness's 3600 s background-task limit after 410/474 files passed with 0 failures. Not completed (§4). `07-integration-full.log` |
| 08 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 965 operations |
| 09 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` |
| 10 | `pnpm test` | 0 | unit-node 207 files / 3042 tests; unit-web 131 / 2199; unit-formula-nocodegen 3 / 259 passed, 2 skipped (`fuzz.test.ts`, untouched by this task) |
| 11 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `11-prettier-check.log` (re-run after the final handback edit) |

In these commands:

- `$G` is `packages/db/test/integration/p7-transfer-guards.test.ts`.
- `$C` is `apps/api/test/integration/contract/contract.test.ts`.
- `$R` is `apps/api/test/integration/contract/response-validation.test.ts`.
- The probe config is outside the repository. A copy is kept as `T-DG7-BE-R7-evidence/probe-order.config.ts.txt`.

The contract test passed on a disposable PostgreSQL in runs 04 and 05.

## 4. Known gaps / not done

- **Full integration project (07): NOT COMPLETED. This is not a pass.**
  - I started it at about 17:33Z with a background-task limit of 3600 s. That limit was too short: the QA reviewer's full run took 5116 s. The harness stopped it at about 18:33Z.
  - Vitest never printed a summary or an exit code. The log ends with a note saying so.
  - By then **410 of 474 files had passed and none had failed** (`grep -c '^ ✓ |integration'` gives 410; `'^ ❯ |integration'` gives 0). `contract.test.ts` (111 tests) and `response-validation.test.ts` (119 tests) were among the 410.
  - `p7-transfer-guards.test.ts` was **not** among the 410, so the full run doesn't show the guard file running before the contract suites. Logs 04/05/06 cover that ordering deterministically.
  - **Remaining:** one complete `QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration` with a limit of at least 7200 s (about 85–90 minutes on this host). Its exit code is what needs recording. I didn't restart it because I was already about 80 minutes into a 60–75 minute budget.
- No pending entries in `apps/api/test/support/p7-pending*.ts` belong to this task, because it routes no operation. None were removed.

### Results appended after the handback was first written

- **11, prettier check:** exit 0 ("All matched files use Prettier code style!"; `11-prettier-check.log`). It was re-run after this final edit; see the last line of that log.
- **07, full integration:** stopped by the harness's time limit. See above.

## 5. Open questions

1. **Product, not in this scope:** should `listMigrationImports` skip or flag an import row that has no reconciliation run instead of answering 500? (This is the QA reviewer's observation on F-DG7-962.) The CLI writes an import and its reconciliation in one transaction, so the product can't produce that state on its own. Only a direct owner write can.
2. **Merge instructions:** none special. No migrations, no ordering constraints. One test file changed.

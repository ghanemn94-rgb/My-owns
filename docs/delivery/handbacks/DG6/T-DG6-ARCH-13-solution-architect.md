# Handback T-DG6-ARCH-13 (solution-architect): DG6 round-1 follow-up — ADR and data dictionary after BE-Y6

- **Stage / gate:** P6, DG6 (FIXING after review round 1). Branch `dg6/arch-13`, at the integrated `HEAD` `c7dda5121` ("DG6: assignment T-DG6-ARCH-13"). Changes are left **uncommitted**, as the assignment asks.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-13-solution-architect-20261102T025745Z-138c973c","session_id":"138c973c-9560-4778-9e22-1410fd863cd5"}`. Assignment file sha256 `335723a25bb9a4839880808fac206b75b473c6581f3677ff3133277b46598c6d`, checked with `sha256sum` (it matches).
- **Time:** started `2026-11-02T02:57:59Z` (`date -u`). The end time is at the bottom.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0**, at the start and again at the end (`T-DG6-ARCH-13-evidence/06-validate-DG5-historical.log`).
- **Documentation only.** No product code, test, migration, contract or i18n file changed. No migration id taken. No new dependency. No operation routed.
- This is an engineering design record. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and nothing implies a DG0–DG7 result. The probe database was disposable, and all data in it was synthetic.

## Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0046-p5-exporters-pdf-docx-xlsx-pptx-csv-fonts-rtl-injection-export-jobs.md` | R2, R4, R5 and R6 corrected in place, each with a dated note. New **amendment S** (S1 physical model `0125`, S2 definition check, S3 persisted attempt and session lock, with the lock-order analysis, S4 problem-text pin, S5 the code-vs-ADR proposal, S6 history table of amendment R). |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | Lock registry row 730264 `exportJob` names the export assembly watch and its **session** use. The §6 introduction now notes the two session-level uses. A new amendment records both changes (history). |
| `docs/architecture/adr/ADR-0058-p6-performance-load-dataset-workload-p95-index-plan-async-export.md` | New amendment **T4**: the start and its 2 s target are unchanged; each assembly gains one short committed transaction and an audit row; version 3; the proof driver never reads the version. |
| `docs/architecture/data-dictionary.md` | New section "P6 round-1 repair migration 0125" (column, CHECK, guard constraint names, function row, validation rules), from the migrated catalogue. Three statements of the 0124 section made untrue by 0125 are corrected with dated notes: the `export.assembly_failed` meaning, the guard row's "not checked", and the watch row's "per job, per process". The 0124 intro's free-id line moves to 0126. |
| `docs/architecture/erd.md` | New §1ab.2 (0125: no new table or relationship; new column, guard rules, writer register). The §1ab.1 register row is amended (the watch also counts attempts). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-13-solution-architect.md` (new) | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-13-evidence/*` (new) | Logs; the catalogue probe source (`01-catalog-probe.mts.txt`). |

## Behaviour delivered

The section assigns the BE-Y6 follow-up of **REQ-S13-005**, whose acceptance text is quoted here: *"A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria"* (automation: *"Long export -> async job with progress"*). ADR-0058 T4 touches **REQ-S20-030**: *"A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester"*. This task changes no export content and no behaviour. It makes the design records true to what BE-Y6 shipped. The `fee.test.tsx` problem-text test, which reads ADR-0046, still passes with the edited ADR (log `02`), so the edits added no row its parsers read.

The handback's "ADR-0046 text now untrue" list, item by item, each checked against the code or the catalogue:

| BE-Y6 item | Verified against | Where corrected |
|---|---|---|
| R4 "Bounded retry": in memory per process; bound per process lifetime | `assembly.ts` (`countAttempt`, `EXPORT_ASSEMBLY_MAX_ERRORS` check in step 0; no `errorCounts`); catalogue column | R4 bounded retry (in place), S3 |
| R4: the claim's lock is now a **session** lock across both transactions (class 730264, only tried) | `claimNext` `pg_try_advisory_lock`; `finally` `pg_advisory_unlock` | R4 step 0 and lead bullet, S3; ADR-0016 row 730264 |
| Data dictionary watch row "(per job, per process)" | as above | dictionary 0124 watch row (dated note) and the new "P6 validation rules (0125)" |
| R4 "One transaction per job": now one committed attempt transaction, then one per job | `assembleNextExport` (two `conn.transaction()` on one `db.connection()`) | R4 lead bullet, new steps 0 and 1, "Every failure", "At most once", "Cancel" |
| R4 "Pool use" unchanged | the same connection carries both transactions; `assembleReport(db, …)` its own; `main.ts` `max: 20` | R4 pool wording clarified; ADR-0058 T4 |
| R6 audit actions: add `export_job.assembly_attempt` | `countAttempt` `record(… "export_job.assembly_attempt" …)` with `ASSEMBLY_ACTOR` | R6 (in place), R4 attribution |
| R2 "The guard does not check … `definition_code`" | catalogue `prosrc`: `IF NEW.selection IS NOT NULL AND s.definition_code IS DISTINCT FROM NEW.selection ->> 'definitionCode'` → `export_job_snapshot_selection` | R2 (in place), S2; dictionary function rows |
| R5 parenthesis: pin 24, does not read this table | `fee.test.tsx` `JOB_ROW`, `expect(rows.size).toBe(26)`; the test run (log `02`) | R5 (in place), S4 |

Schema items from the handback's "Schema" section, checked in the catalogue (log `01`): `assembly_attempt_count` is `integer`, NOT NULL, default `0`, ordinal 27. `export_job_assembly_attempt_count_check` is `CHECK ((assembly_attempt_count >= 0))`. The guard's nine constraint names are as listed in S1. The insert rule now includes `assembly_attempt_count <> 0`. No new index. `mth_app` keeps INSERT/SELECT/UPDATE. The guard keeps `search_path=public, pg_temp` and is not `SECURITY DEFINER`.

Also checked and recorded, beyond the handback's list:

- **No lock-order deadlock (S3).** Cancel (`jobs.ts` `lockExportJob`, then `ownJob(…, true)` `FOR UPDATE`) and the worker (`export-runner.ts` `lockedJob`) take the advisory lock before the row. The watch only *tries* the advisory lock while holding the row lock.
- **ADR-0016** said its registry is "of the transaction-scoped advisory-lock classes", and its 730264 row named only the worker and cancel. Both are now untrue. I corrected them; the precedent is the `demoReset` session row.
- **Version 3** after assembly, or after a failure in the job transaction. Checked against `exports-assembly.test.ts` lines 213, 271 and 341.
- **ADR-0058:** the proof driver `deploy/load/export-proof.mjs` contains no `version` or `If-Match`, so T2's assertions are unaffected.

## Proposed findings (code that contradicts the ADRs; for its owner)

- **F-DG6-sa13-1 (proposed; Low; `mandatory_violation: false`; REQ-S13-005; owner backend-workflow-engineer).**
  - **Reproduction:** read the header comment of `apps/api/src/modules/reporting/exports/assembly.ts`, lines 25–28.
  - **Actual:** the comment lists step 4 as D-199 (`export.includes_restricted_records`) and step 5 as the access re-check on reloaded grants.
  - **Expected:** the comment follows the code's order. The code (`stillAllowed`, then `restrictedAmong`) and ADR-0046 R4 steps 4–5 do the access re-check first. So a requester who both lost access and has a restricted source gets `export.source_unavailable`.
  - **Scope:** behaviour matches the ADR; only the comment is wrong.

Observation (not a contradiction, not proposed as a finding): `assembleNextExport` swallows a failing `pg_advisory_unlock` (`.catch(() => undefined)`). If the unlock ever failed on a connection that stays in the pool, the session lock would stay held until that connection closed. Cancel and the worker would then wait on a blocking xact lock. The code comment assumes that only a broken connection fails there, and such a connection is discarded. I found no path that falsifies that assumption, and I did not test one. I'm recording it so a code-security reviewer can judge it.

## Checks (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL came from `tests/qa/support/with-pg.sh` (a disposable cluster, PostgreSQL 16.15) on ports 28650–28699 only. Empty `.claude/.cc-writes` directories in source folders: none found before the tests. Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-13-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | shown in session; repeated in 06 |
| 1 | `QA_PG_PORT=28650 MTH_PORT_POOL=28651-28699 tests/qa/support/with-pg.sh node --conditions=@mth/source <probe> $PWD` (catalogue probe, all 117 migrations) | 0 | migrate exit 0, 117 applied; `export_job` columns, constraints, indexes, triggers, grants, guard constraint names | `01-catalog-0125.log`, source `01-catalog-probe.mts.txt` |
| 2 | `npx vitest run src/pages/reports/fee.test.tsx -t "slice F problem texts"` (in `apps/web`, against the edited ADR-0046) | 0 | 2 passed, 17 skipped (pin 26, the two `job (assembly)` codes) | `02-fee-problem-texts.log` |
| 3 | `pnpm -r typecheck` | 0 | all packages done | `03-typecheck.log` |
| 4 | `pnpm -r build` | 0 | all packages done | `03-build.log` |
| 5 | `pnpm lint` | 0 | clean | `03-lint.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `03-openapi.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node 189 files / 2,851 passed; unit-web 120 / 2,020 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (pre-existing skips in that project; untouched) | `04a-test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts | `04b-test-c-utf8.log` |
| 9 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!` (run after this handback was final) | `05-prettier-check.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `06-validate-DG5-historical.log` |

In log 8, lines that contain "failed" are passing test titles such as "a failed read shows …", not failures. There was no failed, flaky or timed-out test.

Not run: `pnpm test:integration`. The assignment leaves it to the orchestrator, and no integration file changed here. The only database run was the read-only catalogue probe (row 1). No e2e spec was added or changed, so no e2e budget applies.

## Operations routed (pending-list delta)

None. No `p6-pending-*.ts` or `p6-exercises-*.ts` file changed.

## For the orchestrator: contract, schema and dependency needs

- **Contract:** none. `ExportJob` is unchanged, and `assembly_attempt_count` is not exposed (checked: S1).
- **Schema:** none new. The data dictionary and the ERD now describe `0125` as shipped. If the orchestrator renumbers `0125` at merge, the new dictionary section, ERD §1ab.2, ADR-0046 R2/R4/S and ADR-0058 T4 name `0125` and must move with it.
- **Dependency:** none.
- **Scope note:** ADR-0016 was not named in the assignment. I edited its 730264 row and the §6 introduction because 0125 made both untrue, and the architect owns that ADR. If the orchestrator prefers to keep ADR-0016 untouched in this task, both edits can be reverted together with its amendment section without affecting the other files. ADR-0046 S3 would then refer to a row that does not yet say so.
- **Proposed finding** F-DG6-sa13-1 (Low) above, for the orchestrator to allocate and route.

## User-facing texts made untrue

None. No en or ar string changed, and none is made untrue: the `export.assembly_failed` text ("…start a new export") stays true, as BE-Y6 noted.

## Merge instructions

Documentation only. Possible conflicts come only from another task that edited the same ADR sections, the end of `data-dictionary.md`, or ERD §1ab. Apply these edits after BE-Y6, which is already on this branch.

## What remains

- Nothing of this assignment's scope.
- F-DG6-sa12-1/2/3 stay open until a reviewer verifies them. The proposed F-DG6-sa13-1 is for its owner.

Nothing here grants a G1–G6 business, Finance or IT approval, or implies any DG0–DG7 gate result.

End time: see the first line of `06-validate-DG5-historical.log` (`date -u` at the final check).

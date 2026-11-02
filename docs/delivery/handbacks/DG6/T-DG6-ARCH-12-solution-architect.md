# Handback T-DG6-ARCH-12 (solution-architect): ADR reconciliation after BE-Y2 and BE-Y5

- **Stage:** P6 / DG6 (FIXING after review round 1). **Task:** T-DG6-ARCH-12. **Findings in scope:** F-DG6-120 (ADR-0052 edit by BE-Y2) and F-DG6-147 (D-207, shipped by BE-Y5).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-12-solution-architect-20261102T010006Z-37dcda02","session_id":"37dcda02-6b0d-4f0c-a247-0edf50c27dd4"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-12.md`. Its SHA-256 `b764449b…f31f` was verified before reading.
- **Tree:** worktree `/home/user/wt/dg6-arch-12`, branch `dg6/arch-12`, `HEAD` `a973b5673`. The changes are **uncommitted**, as the assignment requires.
- **Time:** started `Mon Nov 2 01:00:18 UTC 2026`. The end time is at the bottom.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** with `PASS gate DG5 (historical)` (`T-DG6-ARCH-12-evidence/00-validate-dg5-historical.log`).
- **Documentation only.** No product code, test, migration, contract or i18n file was changed. No migration id was taken.

## Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0052-…-secrets-audit-api-sweeps.md` | §5 "Namespace" bullet corrected to the shipped code: the `file` name pattern; the `ConfigError` raised at resolve time and naming only the variable; IT-registered providers own their namespace; the exact call sites. New amendment "2026-11-02, T-DG6-ARCH-12": the architect's confirmation, with the regexes, the call sites and pointers, the field error code `validation.secret_ref_namespace` and its exact English text (shared rule 17), the decision that the database stays at shape level, and what is unchanged. |
| `docs/architecture/adr/ADR-0046-…-export-jobs.md` | §5 Flow step 1: the stale `boss.send` sentence is corrected in place, with a dated note; the code uses the `export_job.requested` outbox event. ARCH-11's amendment intro and the H2–H5 headings now point to the reconciliation. New amendment **R1–R7** "2026-11-02, T-DG6-ARCH-12": the shipped names, the physical model as read from the catalogue, the start, the watch, the error codes and contract, the §5/§6 restatements, and the answers to Q1–Q4. |
| `docs/architecture/adr/ADR-0058-…-async-export.md` | New amendment **T3**: what the 2 s start contains as shipped. A requester restricted from some record still pays an in-request assembly, and the load dataset has none; completion includes queueing at the watch; BE-Y5's provisional figures; DO-Y2's run is the one cited. |
| `docs/architecture/data-dictionary.md` | The section "P6 round-1 repair migration 0124" is rewritten to the shipped file and catalogue: `selection`, `export_job_selection_pending`, the replaced `export_job_error_code_check`, the index, the triggers, the guard as shipped (including what it does **not** check) and the validation layers with the watch settings. |
| `docs/architecture/erd.md` | §1ab is rewritten to the shipped names (`selection`, `export_job_selection_pending`, the export assembly watch, the three failure codes, the composite FK keeping the transformation). The register row is updated. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-12-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-12-evidence/*` | Check logs and the catalogue probe (`01-catalog-probe.mts.txt`, which is the script, and `01-catalog-0124.log`, which is its output). |

## What was done, item by item

### 1. ADR-0052 (BE-Y2's edit for F-DG6-120): confirmed, with corrections

I checked BE-Y2's two edits (the example `MTH_SECRET_SMTP_PASSWORD` and the "Namespace" bullet) against `platform/secrets.ts`, `platform/secret-namespace.ts`, the five call sites, the worker twin and `openapi.yaml` `SecretRef`. They are **correct in substance**. Four corrections or clarifications were made:

- **The `file` name rule** was not stated. It is now: `/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/`, so no path, no `..` and no leading dot.
- **The platform-file `ConfigError`** is raised **when the `file` provider resolves a reference**, not at startup. It covers `<VARIABLE>_FILE` targets other than `MTH_SECRET_*_FILE`. The error names the variable only.
- **Providers that IT registers** own their namespace (`secretRefInNamespace` returns true for them).
- **The call sites, exactly:** webhooks on create and rotate; S3 on save and test; before any row is written.

The response is **400** with the generic code `validation` and a field error `validation.secret_ref_namespace` at the field's pointer, as the code does. The English text is in the amendment's code table. The confirmation is recorded in a dated amendment at the end of the ADR, which is ADR-0052's history.

**Decided there:** no database CHECK for the namespace. `p6_secret_ref_valid` stays at shape level, because an IT provider's namespace is open and resolve time is the enforcing boundary.

### 2. ADR-0046 / ADR-0058 / data dictionary / ERD vs the shipped BE-Y5

The physical model was read from a migrated catalogue, not from the SQL text alone: a disposable PostgreSQL 16.15, all **116** migrations applied by the real `mth-db migrate`, exit 0 (`01-catalog-0124.log`). Every item the assignment lists is recorded:

| Assignment item | Where |
| --- | --- |
| nullable `snapshot_id` | ADR-0046 R2; dictionary column row; ERD §1ab |
| `selection jsonb` | ADR-0046 R1, R2; dictionary; ERD |
| CHECK `export_job_selection_pending` (catalogue text) | ADR-0046 R2; dictionary |
| index `export_job_pending_assembly_idx` (catalogue text) | ADR-0046 R1; dictionary |
| replaced `export_job_guard()` | ADR-0046 R2; dictionary "P6 function (0124)" |
| error codes `export.includes_restricted_records`, `export.assembly_failed` | ADR-0046 R2, R5 (exact English texts = `en/problems.json`); dictionary (replaced `export_job_error_code_check`) |
| audit `export_job.assemble` / `export_job.fail`, service actor on behalf of the requester | ADR-0046 R4 ("Attribution"), R6 (§6 action list) |
| `EXPORT_ASSEMBLY_INTERVAL_MS` 1 s, concurrency 2, max errors 3 (and batch 50) | ADR-0046 R4 (they are code constants, not env vars); ADR-0058 T3; dictionary |
| the stale §5 `boss.send` sentence | ADR-0046 §5 Flow step 1, corrected in place with a dated note |

**Q1–Q4 answered from what BE-Y5 shipped (ADR-0046 R3–R7):**

- **Q1 (D-199's synchronous 403 without a snapshot).** `transformationHasRestricted` makes one indexed `record_sensitivity` query. If the requester is restricted from nothing in the transformation, nothing is assembled. Otherwise there is a discarded read-only assembly in the request, exactly as before D-207. Every 403 case is kept. The cost is in ADR-0058 T3.
- **Q2 (error code).** Access lost uses `export.source_unavailable`, as H3 said. A restricted source found at assembly uses **`export.includes_restricted_records`**, not `export.source_unavailable` as H3 said. So the closed set and the contract enum **do** change, and H5 ("enum unchanged") is superseded.
- **Q3 (repeated failure).** BE-Y5 uses **`export.assembly_failed`, not `export.render_failed`**, for a failed assembly. That covers a report refusal (any 4xx `HttpProblem`) at once, and 3 unexpected errors per job per process. `export.render_failed` stays the worker's renderer error.
- **Q4 (names).** BE-Y5's names differ from H4's. The documents now use the shipped names (R1 table), and Q4 is closed.

Other corrections to ARCH-11's H text, from the code:

- The claim is the row lock **plus** a `pg_try_advisory_xact_lock` on the existing class `exportJob` 730264. No new lock number is added.
- The assembly runs on its own read-only REPEATABLE READ connection, outside the claim transaction. Access is re-checked before and after it.
- The watch is started by `exports/routes.ts`, not `reporting/index.ts`.
- There is no database size bound on `selection`. That is accepted, with its rationale: zod plus `checkReportRequest` with ≤ 8,192 bytes, and a re-parse at use.
- The guard does not check that the snapshot's definition equals the selection's. This is proposed as a finding, below.
- Pool use: up to 4 of the API's 20 connections.

## Behaviour per requirement row (documents only)

These rows' behaviour is BE-Y2's and BE-Y5's. These documents describe it and satisfy no row on their own.

- **REQ-S16-029**, acceptance: *"A12;A22: a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot read records outside its scope"*. ADR-0052's confirmation records the namespace rule that keeps a SecretRef from reaching a platform secret. The log scan is not this task's, and it was not run.
- **REQ-S20-030**, acceptance: *"A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester"*. ADR-0058 T3 and ADR-0046 R3/R4 describe the shipped start and watch. The full-dataset proof is DO-Y2's.
- **REQ-S13-005**, acceptance: *"A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria"*. This is unchanged: an export still renders exactly one stored snapshot (H1, confirmed in R).
- **REQ-S10-004** (the export half), acceptance: *"A12: a user without access to transformation Y receives no Y records in search, export, evidence URL or AI retrieval; …"*. ADR-0046 R3/R4 record the two access checks and D-199 at the start and at assembly.

## Checks (real exit codes)

Environment: Node 24.21.0, offline, harness ports 28550–28599. Logs are in `docs/delivery/handbacks/DG6/T-DG6-ARCH-12-evidence/`.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` (`00-…`) |
| 1 | `QA_PG_PORT=28550 MTH_PORT_POOL=28551-28599 tests/qa/support/with-pg.sh node --conditions=@mth/source <catalog probe> $PWD` | **0** | 116 migrations applied; `export_job` constraints, index, columns, triggers and grants printed (`01-catalog-0124.log`; the script is `01-catalog-probe.mts.txt`) |
| 2 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`03-…`) |
| 3 | `pnpm lint` | **0** | (`04-…`) |
| 4 | `pnpm -r typecheck` | **0** | (`05-…`) |
| 5 | `pnpm -r build` | **0** | (`06-…`) |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node **2846 passed** (188 files); unit-web **2020 passed** (120 files); unit-formula-nocodegen **259 passed, 2 skipped** (3 files) (`07-…`) |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | the same counts: 2846 / 2020 / 259 + 2 skipped (`08-…`) |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" in every xargs batch; run last, after this handback was final (`09-…`) |

**Integration files:** none touched, so none were run (acceptance item 3). The full `pnpm test:integration` was not run, and that is not required here.

**The `fee.test.tsx` pin.** `apps/web/src/pages/reports/fee.test.tsx` parses ADR-0045 and ADR-0046 for 4xx table rows and `` `export.x` "text" `` pairs, and pins **24**. To keep `pnpm test` green without editing code, the two new job codes are written in ADR-0046 R5 as a table whose first column is `job (assembly)`, which the parser does not read. A local copy of the parser was run against the edited ADRs and still counts 24 (it lives in the run's `$TMPDIR` and is not kept). Binding these two texts by test is proposed below.

## Code that contradicts or under-delivers the ADRs (proposed findings for their owners)

I edited no code. The orchestrator allocates the ids.

| Proposed id | Severity | Mandatory | Owner | Requirement | What | Expected vs actual | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-DG6-sa12-1 | Low | false | backend-workflow-engineer | REQ-S13-005 | `export_job_guard()` (0124) does not check that an assigned snapshot's `definition_code` equals `selection ->> 'definitionCode'`. ARCH-11's H4 asked for it. | Expected: the database refuses a mismatched assignment (defence in depth). Actual: only the application guarantees it (`assembly.ts` inserts the snapshot from the stored selection in the same transaction). The transformation is enforced by the composite FK. To fix, add a check in the next migration, or accept it as an observation. | `packages/db/migrations/0124_p6_export_live_selection_pending.sql` (the `check_snapshot` block); ADR-0046 R2 |
| F-DG6-sa12-2 | Low | false | frontend owner of `apps/web/src/pages/reports/fee.test.tsx` | REQ-S13-005 | The "slice F problem texts" test does not bind the two new job codes' English texts to the ADR. | Expected: ADR-0046 R5's `job (assembly)` rows are read, and the en text equals the ADR (pin 26). Actual: the pin is 24, and no test binds the two codes' en text to the ADR. | `fee.test.tsx:799-813`; ADR-0046 R5 |
| F-DG6-sa12-3 | Low | false | backend-workflow-engineer | REQ-S13-005 | The assembly's bounded retry counts errors in memory per process (`errorCounts`). A job whose assembly *kills* the process, rather than throwing, is retried after every restart without bound. | Expected (H3): a pending job never loops silently. Actual: bounded per process lifetime only. Assembly limits (5,000 rows and 10 MiB per ADR-0045 §1) make a crash unlikely. A persisted attempt count would close it. Accept it as an observation, or fix it. | `apps/api/src/modules/reporting/exports/assembly.ts:176-247`; ADR-0046 R4 |

I found no contradiction between ADR-0052 and the shipped secrets code once the corrections above were made.

## Operations routed (pending-list delta)

None. This task changes no code and no `p6-pending-*.ts` or `p6-exercises-*.ts` file.

## For the orchestrator: contract, schema and dependency needs

- **Contract.** No new need. The `ExportJob` changes (`snapshotId` nullable; two more `errorCode` values) were shipped by BE-Y5 under D-207 (3). ARCH-11 and BE-Y5 have already raised them as breaking changes of a DG5 response. ADR-0046 R5 records that the enum **did** change, which corrects H5.
- **Schema.** None. No migration was written.
- **Dependency.** None.
- **For the web owner (optional):** `validation.secret_ref_namespace` has no Arabic text, because field-error messages are not i18n keys, as with `validation.credential_refs`. ADR-0052 does not require one. If a form renders the message, the web owner adds en and ar texts.

## User-facing texts made untrue

None. This task changes documents only. I checked the en/ar strings that the reconciled sections quote (`exports.preparing`, `exports.noSnapshot`, `export__assembly_failed`, `export__includes_restricted_records`, `export__source_unavailable`) against the ADR text. They agree.

## What remains

- F-DG6-sa12-1 to sa12-3: these are for the owners or the orchestrator to triage.
- F-DG6-120 and F-DG6-147 stay open. Only a reviewer verifies a fix.
- DO-Y2's full-dataset re-measurement is not this task's.

Nothing here grants a G1–G6 business, Finance or IT approval, or implies any DG0–DG7 gate result.

End time: see `09-prettier-check.log` (its first line is `date -u` at the final check).
